import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { query } from '../db.js';
import { gradePortfolio } from '../services/mlClient.js';
import {
  generateAiReportPdf,
  makeReportFilename,
  resolveReportPdfPath,
} from '../services/reportPdfService.js';
import { ensurePortfolioAccess, lecturerPortfolioJoin } from '../services/lecturerAccess.js';

const finalSchema = z.object({
  final_grade: z.coerce.number().min(0).max(100),
  status: z.enum(['DRAFT', 'PUBLISHED']).optional()
});

const gradeOptionsSchema = z.object({
  forceRegrade: z.boolean().optional()
});

const REQUIRED_REPORT_SECTIONS = [
  'Overall Evaluation',
  'Strengths of the Submission',
  'Areas That Need Improvement',
  'Suggestions for Improvement',
  'Overall Comment',
];

function resolveUploadPath(filePath) {
  if (!filePath) return null;
  return path.resolve(process.cwd(), filePath.replace(/^\/+/, '').replace(/\//g, path.sep));
}

function safeMessage(error) {
  return String(error?.message || error || 'Unknown grading error');
}

function isDatabaseError(error) {
  return Boolean(error?.sql || error?.sqlMessage || error?.sqlState || error?.errno);
}

function publicBackendError(message) {
  const error = new Error(message);
  error.publicMessage = message;
  return error;
}

function sendControllerError(res, fallback, error) {
  const message = error?.publicMessage || fallback;
  const body = { error: message };
  if (!error?.publicMessage) body.details = safeMessage(error);
  res.status(500).json(body);
}

function validateAiResult(result) {
  if (result?.status === 'failed') {
    throw new Error(result.error || 'AI grading failed');
  }

  const score = Number(result?.ai_grade);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error('ML service returned an invalid AI score');
  }

  const report = String(result?.ai_report_text || result?.ai_review_report || '').trim();
  if (!report) throw new Error('ML service returned an empty AI report');

  const missing = REQUIRED_REPORT_SECTIONS.filter((section) => !report.includes(section));
  if (missing.length) {
    throw new Error(`ML service report is missing required section(s): ${missing.join(', ')}`);
  }

  return { score, report };
}

function looksLikeRawJson(value) {
  return /^[\s\r\n]*[\[{]/.test(String(value || ''));
}

function formatReportDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 16).replace('T', ' ');
  return date.toISOString().slice(0, 16).replace('T', ' ');
}

function sendReportPdf(res, filePath, portfolioId) {
  return res.download(filePath, makeReportFilename(portfolioId), (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ error: 'Could not download AI report PDF' });
    }
  });
}

function finalPublishStatus(row) {
  if (row.publish_status) return row.publish_status;
  return row.status === 'PUBLISHED' ? 'published_to_student' : 'draft';
}

function shouldHideDraftFinalGrade(req, row) {
  const publishStatus = finalPublishStatus(row);
  const hasDraftData = row.final_grade != null
    || row.manual_score != null
    || Boolean(String(row.manual_remark || '').trim())
    || row.saved_by != null;

  return req.user?.role === 'admin'
    && publishStatus === 'draft'
    && hasDraftData
    && row.saved_by_role !== 'admin';
}

async function markProcessing(portfolioId, rubricId) {
  await query(
    `INSERT INTO ai_grading
      (portfolio_id, rubric_id, ai_status, ai_grade, ai_review_report, ai_report_text,
       ai_report_pdf_path, ai_grading_error, ai_grading_technical_error, grading_started_at, graded_at)
     VALUES (?, ?, 'processing', NULL, NULL, NULL, NULL, NULL, NULL, NOW(), NULL)
     ON DUPLICATE KEY UPDATE
       rubric_id=VALUES(rubric_id),
       ai_status='processing',
       ai_report_pdf_path=NULL,
       ai_grading_error=NULL,
       ai_grading_technical_error=NULL,
       grading_started_at=NOW(),
       graded_at=NULL`,
    [portfolioId, rubricId || null]
  );
}

async function markFailed(portfolioId, rubricId, error, technicalError = null) {
  const message = safeMessage(error);
  await query(
    `INSERT INTO ai_grading
      (portfolio_id, rubric_id, ai_status, ai_grading_error, ai_grading_technical_error, graded_at)
     VALUES (?, ?, 'failed', ?, ?, NULL)
     ON DUPLICATE KEY UPDATE
       rubric_id=VALUES(rubric_id),
       ai_status='failed',
       ai_grading_error=VALUES(ai_grading_error),
       ai_grading_technical_error=VALUES(ai_grading_technical_error),
       graded_at=NULL`,
    [portfolioId, rubricId || null, message, technicalError || message]
  );
  return message;
}

async function markGraded(portfolioId, rubricId, result) {
  const { score, report } = validateAiResult(result);

  await query(
    `INSERT INTO ai_grading
      (portfolio_id, rubric_id, ai_grade, ai_review_report, ai_status, ai_report_text,
       ai_report_pdf_path, ai_grading_error, ai_grading_technical_error, ai_model, graded_at)
     VALUES (?, ?, ?, ?, 'graded', ?, NULL, NULL, NULL, ?, NOW())
     ON DUPLICATE KEY UPDATE
       rubric_id=VALUES(rubric_id),
       ai_grade=VALUES(ai_grade),
       ai_review_report=VALUES(ai_review_report),
       ai_status='graded',
       ai_report_text=VALUES(ai_report_text),
       ai_report_pdf_path=NULL,
       ai_grading_error=NULL,
       ai_grading_technical_error=NULL,
       ai_model=VALUES(ai_model),
       graded_at=NOW()`,
    [
      portfolioId,
      rubricId || null,
      score,
      report,
      report,
      result.ai_model || result.model || null,
    ]
  );
}

async function getLatestRubric(assignmentId) {
  return (
    await query(
      `SELECT *
       FROM rubrics
       WHERE assignment_id=?
       ORDER BY create_date DESC, rubric_id DESC
       LIMIT 1`,
      [assignmentId]
    )
  )[0];
}

async function getPortfolioForGrading(portfolioId) {
  return (
    await query(
      `SELECT p.portfolio_id, p.student_no, p.portfolio_link, p.upload_date,
              a.assignment_id, a.assignment_name, a.course_name, a.batch, a.department,
              a.start_date, a.deadline_date, a.remark
       FROM portfolios p
       JOIN assignments a ON a.assignment_id = p.assignment_id
       WHERE p.portfolio_id=?`,
      [portfolioId]
    )
  )[0];
}

async function getActivePortfolioFiles(portfolioId) {
  const rows = await query(
    `SELECT pf.file_id, pf.file_path, pf.original_name, pf.mime_type,
            ard.document_name
     FROM portfolio_files pf
     LEFT JOIN assignment_required_documents ard ON ard.id = pf.required_document_id
     WHERE pf.portfolio_id=?
       AND pf.removed_at IS NULL
     ORDER BY CASE
       WHEN LOWER(pf.file_path) LIKE '%.pdf' OR LOWER(pf.file_path) LIKE '%.docx' THEN 0
       ELSE 1
     END, pf.uploaded_at DESC, pf.file_id DESC`,
    [portfolioId]
  );

  return rows
    .map((row) => {
      const absolutePath = resolveUploadPath(row.file_path);
      return { ...row, absolute_path: absolutePath };
    })
    .filter((row) => row.absolute_path && fs.existsSync(row.absolute_path));
}

function buildMlPayload(portfolio, rubric, portfolioFilePath, rubricFilePath, submissionFiles = []) {
  return {
    portfolio_id: portfolio.portfolio_id,
    assignment: {
      assignment_id: portfolio.assignment_id,
      assignment_name: portfolio.assignment_name,
      course_name: portfolio.course_name,
      batch: portfolio.batch,
      department: portfolio.department,
      start_date: portfolio.start_date,
      deadline_date: portfolio.deadline_date,
      remark: portfolio.remark,
    },
    student: {
      student_no: portfolio.student_no,
    },
    rubric: {
      rubric_id: rubric.rubric_id,
      rubric_name: rubric.rubric_name,
      rubric_text: rubric.rubric_text || rubric.rubric_extracted_text || null,
      file_path: rubricFilePath,
      file_mime: rubric.rubric_file_mime || null,
      file_original_name: rubric.rubric_file_original_name || null,
    },
    submission: {
      portfolio_id: portfolio.portfolio_id,
      file_path: portfolioFilePath,
      portfolio_link: portfolio.portfolio_link,
      uploaded_at: portfolio.upload_date,
      files: submissionFiles.map((file) => ({
        file_id: file.file_id,
        file_path: file.absolute_path,
        file_original_name: file.original_name,
        file_mime: file.mime_type || null,
        required_document_name: file.document_name || null,
      })),
    },
  };
}

async function runAiGradingForPortfolio(portfolioId, { forceRegrade = false } = {}) {
  const portfolio = await getPortfolioForGrading(portfolioId);
  if (!portfolio) return { portfolio_id: portfolioId, ok: false, status: 'failed', error: 'Portfolio not found' };

  const existing = (
    await query('SELECT * FROM ai_grading WHERE portfolio_id=?', [portfolioId])
  )[0];

  if (existing?.ai_status === 'processing') {
    return { portfolio_id: portfolioId, ok: false, status: 'processing', skipped: true, error: 'AI grading is already processing' };
  }

  if (existing?.ai_status === 'graded' && !forceRegrade) {
    return { portfolio_id: portfolioId, ok: true, status: 'graded', skipped: true, message: 'Already graded' };
  }

  const rubric = await getLatestRubric(portfolio.assignment_id);

  try {
    if (!rubric) {
      await markFailed(portfolioId, null, 'No rubric is attached to this assignment');
      return { portfolio_id: portfolioId, ok: false, status: 'failed', error: 'No rubric is attached to this assignment' };
    }

    const activeFiles = await getActivePortfolioFiles(portfolioId);
    const supportedActiveFiles = activeFiles.filter((file) => /\.(pdf|docx)$/i.test(file.file_path || ''));
    const representativeFile = supportedActiveFiles[0] || activeFiles[0] || null;
    const portfolioFilePath = representativeFile?.absolute_path || resolveUploadPath(portfolio.portfolio_link);

    if (!portfolioFilePath || !fs.existsSync(portfolioFilePath)) {
      const message = 'Student submission file is missing on disk';
      await markFailed(portfolioId, rubric.rubric_id, message);
      return { portfolio_id: portfolioId, ok: false, status: 'failed', error: message };
    }

    const rubricFilePath = rubric.rubric_file_path ? resolveUploadPath(rubric.rubric_file_path) : null;
    if (!rubric.rubric_text && (!rubricFilePath || !fs.existsSync(rubricFilePath))) {
      const message = 'Rubric content or rubric file is missing';
      await markFailed(portfolioId, rubric.rubric_id, message);
      return { portfolio_id: portfolioId, ok: false, status: 'failed', error: message };
    }

    await markProcessing(portfolioId, rubric.rubric_id);

    const mlResult = await gradePortfolio(
      buildMlPayload(portfolio, rubric, portfolioFilePath, rubricFilePath, supportedActiveFiles)
    );

    await markGraded(portfolioId, rubric.rubric_id, mlResult);
    return { portfolio_id: portfolioId, ok: true, status: 'graded' };
  } catch (e) {
    if (isDatabaseError(e)) {
      console.error('AI grading database write failed:', safeMessage(e));
      throw publicBackendError('Could not save AI grading status. Please run database migrations and try again.');
    }

    try {
      const error = await markFailed(portfolioId, rubric?.rubric_id || null, e);
      return { portfolio_id: portfolioId, ok: false, status: 'failed', error };
    } catch (saveError) {
      if (isDatabaseError(saveError)) {
        console.error('Could not save AI grading failure status:', safeMessage(saveError));
        throw publicBackendError('AI grading failed, but the failure status could not be saved. Please run database migrations and try again.');
      }
      throw saveError;
    }
  }
}

export async function gradeOne(req, res) {
  try {
    const portfolioId = Number(req.params.id);
    if (!(await ensurePortfolioAccess(req, res, portfolioId))) return;
    const options = gradeOptionsSchema.parse(req.body || {});

    const result = await runAiGradingForPortfolio(portfolioId, options);
    const out = (await query('SELECT * FROM ai_grading WHERE portfolio_id=?', [portfolioId]))[0] || null;

    res.json({ result, ai: out });
  } catch (e) {
    if (e?.issues) return res.status(400).json({ error: 'Validation error', details: e.issues });
    console.error(e);
    sendControllerError(res, 'Grading failed', e);
  }
}

export async function gradeAssignment(req, res) {
  try {
    const assignmentId = Number(req.params.assignmentId);
    const options = gradeOptionsSchema.parse(req.body || {});
    const access = lecturerPortfolioJoin(req, 'p');

    const portfolios = await query(
      `SELECT p.portfolio_id
       FROM portfolios p
       ${access.join}
       LEFT JOIN ai_grading ag ON ag.portfolio_id = p.portfolio_id
       WHERE p.assignment_id=?
         AND (
           ? = TRUE
           OR ag.portfolio_id IS NULL
           OR ag.ai_status IN ('pending','failed')
         )
       ORDER BY p.upload_date ASC`,
      [...access.params, assignmentId, options.forceRegrade === true]
    );

    const results = [];
    for (const p of portfolios) {
      const result = await runAiGradingForPortfolio(p.portfolio_id, options);
      results.push(result);
    }

    res.json({ assignment_id: assignmentId, results });
  } catch (e) {
    if (e?.issues) return res.status(400).json({ error: 'Validation error', details: e.issues });
    console.error(e);
    sendControllerError(res, 'Assignment grading failed', e);
  }
}

export async function getAssignmentGradingStatus(req, res) {
  const assignmentId = Number(req.params.assignmentId);
  const access = lecturerPortfolioJoin(req, 'p');
  const rows = await query(
    `SELECT p.portfolio_id, p.student_no, ag.ai_status, ag.ai_grade,
            ag.ai_grading_error, ag.ai_model, ag.grading_started_at, ag.graded_at
     FROM portfolios p
     ${access.join}
     LEFT JOIN ai_grading ag ON ag.portfolio_id = p.portfolio_id
     WHERE p.assignment_id=?
     ORDER BY p.upload_date DESC`,
    [...access.params, assignmentId]
  );

  res.json({
    assignment_id: assignmentId,
    statuses: rows.map((row) => ({
      ...row,
      ai_status: row.ai_status || 'pending',
    })),
  });
}

export async function getAiReport(req, res) {
  const portfolioId = Number(req.params.id);
  if (!(await ensurePortfolioAccess(req, res, portfolioId))) return;
  const row = (
    await query(
      `SELECT ag.portfolio_id, ag.ai_status, ag.ai_grade, ag.ai_report_text, ag.ai_review_report,
              ag.ai_grading_error, ag.ai_model, ag.graded_at,
              p.student_no, a.assignment_name, a.course_name
       FROM ai_grading ag
       JOIN portfolios p ON p.portfolio_id = ag.portfolio_id
       JOIN assignments a ON a.assignment_id = p.assignment_id
       WHERE ag.portfolio_id=?`,
      [portfolioId]
    )
  )[0];

  if (!row) return res.status(404).json({ error: 'AI report not found' });
  if (row.ai_status !== 'graded') {
    return res.status(409).json({ error: row.ai_grading_error || 'AI grading is not complete', ai_status: row.ai_status });
  }

  const reportText = row.ai_report_text || row.ai_review_report;
  if (looksLikeRawJson(reportText)) {
    return res.status(409).json({
      error: 'This is a legacy AI report format. Please force regrade this submission to generate the professional report.',
      ai_status: row.ai_status,
    });
  }

  res.json({
    report: {
      portfolio_id: row.portfolio_id,
      student_no: row.student_no,
      assignment_name: row.assignment_name,
      course_name: row.course_name,
      ai_grade: row.ai_grade,
      ai_status: row.ai_status,
      ai_model: row.ai_model,
      graded_at: row.graded_at,
      ai_report_text: reportText,
    },
  });
}

export async function getAiReportPdf(req, res) {
  const portfolioId = Number(req.params.id);
  if (!(await ensurePortfolioAccess(req, res, portfolioId))) return;
  const row = (
    await query(
      `SELECT ag.portfolio_id, ag.ai_status, ag.ai_grade, ag.ai_report_text, ag.ai_review_report,
              ag.ai_report_pdf_path, ag.ai_grading_error, ag.ai_model, ag.graded_at,
              p.student_no, a.assignment_name, a.course_name
       FROM ai_grading ag
       JOIN portfolios p ON p.portfolio_id = ag.portfolio_id
       JOIN assignments a ON a.assignment_id = p.assignment_id
       WHERE ag.portfolio_id=?`,
      [portfolioId]
    )
  )[0];

  if (!row) return res.status(404).json({ error: 'AI report not found' });
  if (row.ai_status !== 'graded') {
    return res.status(409).json({ error: row.ai_grading_error || 'AI grading is not complete', ai_status: row.ai_status });
  }

  const reportText = row.ai_report_text || row.ai_review_report;
  if (!reportText) return res.status(404).json({ error: 'AI report text is not available' });
  if (looksLikeRawJson(reportText)) {
    return res.status(409).json({
      error: 'This is a legacy AI report format. Please force regrade this submission to generate the professional report.',
      ai_status: row.ai_status,
    });
  }

  try {
    const existingPath = resolveReportPdfPath(row.ai_report_pdf_path);
    if (existingPath && fs.existsSync(existingPath)) {
      return sendReportPdf(res, existingPath, portfolioId);
    }

    const pdf = await generateAiReportPdf({
      portfolioId,
      studentNo: row.student_no,
      assignmentName: row.assignment_name,
      courseName: row.course_name,
      generatedDate: formatReportDate(row.graded_at),
      aiScore: row.ai_grade,
      reportText,
    });

    await query('UPDATE ai_grading SET ai_report_pdf_path=? WHERE portfolio_id=?', [pdf.storedPath, portfolioId]);
    return sendReportPdf(res, pdf.absolutePath, portfolioId);
  } catch (e) {
    console.error('AI report PDF generation failed:', safeMessage(e));
    return res.status(500).json({
      error: 'PDF generation failed. AI report text is still available.',
      details: safeMessage(e),
    });
  }
}

export async function setFinalGrade(req, res) {
  try {
    const portfolioId = Number(req.params.id);
    if (!(await ensurePortfolioAccess(req, res, portfolioId))) return;
    const data = finalSchema.parse(req.body);
    if (data.status === 'PUBLISHED' && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Only admin/head can publish grades to students' });
    }

    const p = (await query('SELECT portfolio_id, student_no FROM portfolios WHERE portfolio_id=?', [portfolioId]))[0];
    if (!p) return res.status(404).json({ error: 'Portfolio not found' });

    const existing = (
      await query(
        `SELECT status, publish_status, published_by, published_at
         FROM final_grading
         WHERE portfolio_id=? AND student_no=?
         LIMIT 1`,
        [portfolioId, p.student_no]
      )
    )[0];
    const alreadyPublished = existing?.publish_status === 'published_to_student' || existing?.status === 'PUBLISHED';
    if (alreadyPublished && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Published grades can only be changed by admin/head' });
    }

    const shouldPublish = data.status === 'PUBLISHED' || alreadyPublished;
    const publishStatus = shouldPublish ? 'published_to_student' : 'draft';
    const legacyStatus = shouldPublish ? 'PUBLISHED' : 'DRAFT';
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const publishedBy = data.status === 'PUBLISHED' ? req.user.user_id : (shouldPublish ? existing?.published_by || req.user.user_id : null);
    const publishedAt = data.status === 'PUBLISHED' ? now : (shouldPublish ? existing?.published_at || now : null);

    await query(
      `INSERT INTO final_grading
        (student_no, portfolio_id, status, final_grade, manual_score,
         saved_by, saved_by_role, saved_at, publish_status, published_by, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         status=VALUES(status),
         final_grade=VALUES(final_grade),
         manual_score=VALUES(manual_score),
         saved_by=VALUES(saved_by),
         saved_by_role=VALUES(saved_by_role),
         saved_at=NOW(),
         publish_status=VALUES(publish_status),
         published_by=VALUES(published_by),
         published_at=VALUES(published_at)`,
      [
        p.student_no,
        portfolioId,
        legacyStatus,
        data.final_grade,
        data.final_grade,
        req.user.user_id,
        req.user.role,
        publishStatus,
        publishedBy,
        publishedAt,
      ]
    );

    const out = (await query('SELECT * FROM final_grading WHERE student_no=? AND portfolio_id=?', [p.student_no, portfolioId]))[0];
    res.json({ final: out });
  } catch (e) {
    if (e?.issues) return res.status(400).json({ error: 'Validation error', details: e.issues });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function listResultsByAssignment(req, res) {
  const assignmentId = Number(req.params.assignmentId);
  const access = lecturerPortfolioJoin(req, 'p');
  const rows = await query(
    `
    SELECT p.portfolio_id, p.student_no, p.portfolio_link, p.upload_date,
           (
             SELECT pf.file_id
             FROM portfolio_files pf
             WHERE pf.portfolio_id = p.portfolio_id
               AND pf.removed_at IS NULL
             ORDER BY CASE
               WHEN LOWER(pf.file_path) LIKE '%.pdf' OR LOWER(pf.file_path) LIKE '%.docx' THEN 0
               ELSE 1
             END, pf.uploaded_at DESC, pf.file_id DESC
             LIMIT 1
           ) AS primary_file_id,
           ag.rubric_id, ag.ai_grade, ag.ai_review_report, ag.ai_status,
           ag.ai_report_text, ag.ai_grading_error, ag.ai_model,
           ag.grading_started_at, ag.graded_at,
           fg.final_grade, fg.manual_score, fg.manual_remark,
           fg.status, fg.publish_status, fg.saved_by, fg.saved_by_role
    FROM portfolios p
    ${access.join}
    LEFT JOIN ai_grading ag ON ag.portfolio_id = p.portfolio_id
    LEFT JOIN final_grading fg ON fg.portfolio_id = p.portfolio_id AND fg.student_no = p.student_no
    WHERE p.assignment_id=?
    ORDER BY p.upload_date DESC
    `,
    [...access.params, assignmentId]
  );

  res.json({
    results: rows.map((row) => ({
      ...row,
      final_grade: shouldHideDraftFinalGrade(req, row) ? null : row.final_grade,
      ai_status: row.ai_status || 'pending',
      ai_review_report: row.ai_report_text || row.ai_review_report,
    })),
  });
}

export async function publishAssignmentGrades(req, res) {
  const assignmentId = Number(req.params.assignmentId);
  await query(
    `
    UPDATE final_grading fg
    JOIN portfolios p ON p.portfolio_id = fg.portfolio_id
    SET fg.status='PUBLISHED',
        fg.publish_status='published_to_student',
        fg.published_by=?,
        fg.published_at=NOW()
    WHERE p.assignment_id=?
      AND fg.final_grade IS NOT NULL
      AND (
        fg.publish_status IN ('submitted_to_head', 'published_to_student')
        OR fg.saved_by_role = 'admin'
      )
    `,
    [req.user.user_id, assignmentId]
  );
  res.json({ ok: true });
}
