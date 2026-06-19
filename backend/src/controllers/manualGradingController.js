import { z } from 'zod';
import ExcelJS from 'exceljs';
import { query } from '../db.js';
import { ensurePortfolioAccess, lecturerPortfolioJoin } from '../services/lecturerAccess.js';
import {
  applySubmissionDisplayNames,
  sanitizeFilenameSegment,
} from '../services/submissionFileNameService.js';

const saveManualGradeSchema = z.object({
  manual_score: z.preprocess(
    (value) => {
      if (value === '' || value === null || value === undefined) return null;
      return Number(value);
    },
    z.number().min(0).max(100).nullable()
  ),
  manual_remark: z.string().max(5000).optional().nullable(),
  confirm_large_difference: z.boolean().optional(),
});

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function publicStatus(row) {
  if (row.publish_status) return row.publish_status;
  return row.status === 'PUBLISHED' ? 'published_to_student' : 'draft';
}

function legacyStatusFromPublishStatus(publishStatus) {
  return publishStatus === 'published_to_student' ? 'PUBLISHED' : 'DRAFT';
}

function hasManualDraftData(row) {
  return row.manual_score != null
    || row.final_grade != null
    || Boolean(String(row.manual_remark || '').trim())
    || row.saved_by != null;
}

function shouldHideDraftManualData(req, row, publishStatus) {
  return req.user?.role === 'admin'
    && publishStatus === 'draft'
    && hasManualDraftData(row)
    && row.saved_by_role !== 'admin';
}

function manualRow(row, req) {
  const publishStatus = publicStatus(row);
  const hideDraft = shouldHideDraftManualData(req, row, publishStatus);
  const visibleManualScore = hideDraft ? null : row.manual_score;
  const visibleFinalGrade = hideDraft ? null : row.final_grade;
  const visibleTeacherScore = hideDraft ? null : (row.manual_score ?? row.final_grade ?? null);
  const visibleRemark = hideDraft ? '' : (row.manual_remark || '');
  const notSubmittedMessage = 'Not submitted by lecturer yet';

  return {
    portfolio_id: row.portfolio_id,
    student_no: row.student_no,
    upload_date: row.upload_date,
    portfolio_link: row.portfolio_link,
    primary_file_id: row.primary_file_id,
    primary_file_name: row.primary_file_name,
    main_answer_document_name: row.main_answer_document_name,
    main_answer_uploaded_files: row.main_answer_uploaded_files,
    ai_grading_file_names: row.ai_grading_file_names,
    ai_status: row.ai_status || 'pending',
    ai_grade: row.ai_grade,
    ai_grading_error: row.ai_grading_error,
    ai_model: row.ai_model,
    teacher_score: visibleTeacherScore,
    manual_score: visibleManualScore,
    final_grade: visibleFinalGrade,
    manual_remark: visibleRemark,
    manual_score_display: visibleTeacherScore,
    manual_remark_display: hideDraft ? notSubmittedMessage : visibleRemark,
    manual_draft_hidden: hideDraft,
    head_visibility_status: hideDraft ? 'not_submitted' : publishStatus,
    saved_by: hideDraft ? null : row.saved_by,
    saved_by_role: hideDraft ? null : row.saved_by_role,
    saved_by_label: hideDraft ? null : (row.saved_by_full_name || row.saved_by_display_name || row.saved_by_email || null),
    saved_by_email: hideDraft ? null : (row.saved_by_email || null),
    saved_at: hideDraft ? null : row.saved_at,
    publish_status: publishStatus,
    status: legacyStatusFromPublishStatus(publishStatus),
    submitted_to_head_at: row.submitted_to_head_at,
    published_at: row.published_at,
    score_difference_warning: hideDraft ? false : Boolean(row.score_difference_warning),
    score_difference: hideDraft ? null : row.score_difference,
  };
}

function validateAssignmentId(req) {
  const assignmentId = Number(req.params.assignmentId);
  if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
    throw badRequest('Invalid assignment id');
  }
  return assignmentId;
}

function compareStudentNo(a, b) {
  return String(a.student_no || '').localeCompare(String(b.student_no || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function manualExportFilename(assignmentName) {
  const safeAssignment = sanitizeFilenameSegment(assignmentName, '');
  return safeAssignment
    ? `manual-grading-report_${safeAssignment}.xlsx`
    : 'manual-grading-report.xlsx';
}

async function getAssignmentContext(assignmentId) {
  return (
    await query(
      `SELECT assignment_id, assignment_name, course_name, department, batch
       FROM assignments
       WHERE assignment_id=?
       LIMIT 1`,
      [assignmentId]
    )
  )[0] || null;
}

async function getManualExportRows(req, assignmentId) {
  const access = lecturerPortfolioJoin(req, 'p');
  const rows = await query(
    `SELECT p.portfolio_id, p.student_no, p.upload_date,
            fg.final_grade, fg.manual_score, fg.manual_remark,
            fg.saved_by, fg.saved_by_role, fg.saved_at, fg.status,
            fg.publish_status, fg.submitted_to_head_at, fg.published_at,
            fg.score_difference_warning, fg.score_difference
     FROM portfolios p
     ${access.join}
     LEFT JOIN final_grading fg ON fg.portfolio_id = p.portfolio_id AND fg.student_no = p.student_no
     WHERE p.assignment_id=?
     ORDER BY p.student_no ASC`,
    [...access.params, assignmentId]
  );

  return rows.map((row) => manualRow(row, req)).sort(compareStudentNo);
}

async function getPortfolioGradeContext(portfolioId) {
  return (
    await query(
      `SELECT p.portfolio_id, p.student_no, p.assignment_id,
              ag.ai_grade,
              fg.status, fg.publish_status, fg.final_grade, fg.manual_score,
              fg.manual_remark, fg.saved_by, fg.saved_by_role
       FROM portfolios p
       LEFT JOIN ai_grading ag ON ag.portfolio_id = p.portfolio_id
       LEFT JOIN final_grading fg ON fg.portfolio_id = p.portfolio_id AND fg.student_no = p.student_no
       WHERE p.portfolio_id=?
       LIMIT 1`,
      [portfolioId]
    )
  )[0];
}

export async function listManualResultsByAssignment(req, res) {
  try {
    const assignmentId = validateAssignmentId(req);
    const access = lecturerPortfolioJoin(req, 'p');

    const rows = await query(
      `SELECT p.portfolio_id, p.student_no, p.portfolio_link, p.upload_date,
              (
                SELECT pf.file_id
                FROM portfolio_files pf
                LEFT JOIN assignment_required_documents ard_primary ON ard_primary.id = pf.required_document_id
                WHERE pf.portfolio_id = p.portfolio_id
                  AND pf.removed_at IS NULL
                  AND (
                    NOT EXISTS (
                      SELECT 1
                      FROM assignment_required_documents ard_main
                      WHERE ard_main.assignment_id = p.assignment_id
                        AND ard_main.is_ai_gradable = 1
                    )
                    OR pf.required_document_id IN (
                      SELECT ard_main.id
                      FROM assignment_required_documents ard_main
                      WHERE ard_main.assignment_id = p.assignment_id
                        AND ard_main.is_ai_gradable = 1
                    )
                  )
                ORDER BY CASE
                  WHEN COALESCE(ard_primary.is_ai_gradable, 0) = 1
                       AND (LOWER(pf.file_path) LIKE '%.pdf' OR LOWER(pf.file_path) LIKE '%.docx') THEN 0
                  WHEN COALESCE(ard_primary.is_ai_gradable, 0) = 1 THEN 1
                  WHEN LOWER(pf.file_path) LIKE '%.pdf' OR LOWER(pf.file_path) LIKE '%.docx' THEN 2
                  ELSE 3
                END, pf.uploaded_at DESC, pf.file_id DESC
                LIMIT 1
              ) AS primary_file_id,
              (
                SELECT pf.original_name
                FROM portfolio_files pf
                LEFT JOIN assignment_required_documents ard_primary ON ard_primary.id = pf.required_document_id
                WHERE pf.portfolio_id = p.portfolio_id
                  AND pf.removed_at IS NULL
                  AND (
                    NOT EXISTS (
                      SELECT 1
                      FROM assignment_required_documents ard_main
                      WHERE ard_main.assignment_id = p.assignment_id
                        AND ard_main.is_ai_gradable = 1
                    )
                    OR pf.required_document_id IN (
                      SELECT ard_main.id
                      FROM assignment_required_documents ard_main
                      WHERE ard_main.assignment_id = p.assignment_id
                        AND ard_main.is_ai_gradable = 1
                    )
                  )
                ORDER BY CASE
                  WHEN COALESCE(ard_primary.is_ai_gradable, 0) = 1
                       AND (LOWER(pf.file_path) LIKE '%.pdf' OR LOWER(pf.file_path) LIKE '%.docx') THEN 0
                  WHEN COALESCE(ard_primary.is_ai_gradable, 0) = 1 THEN 1
                  WHEN LOWER(pf.file_path) LIKE '%.pdf' OR LOWER(pf.file_path) LIKE '%.docx' THEN 2
                  ELSE 3
                END, pf.uploaded_at DESC, pf.file_id DESC
                LIMIT 1
              ) AS primary_file_name,
              (
                SELECT ard.document_name
                FROM assignment_required_documents ard
                WHERE ard.assignment_id = p.assignment_id
                  AND ard.is_ai_gradable = 1
                ORDER BY ard.id ASC
                LIMIT 1
              ) AS main_answer_document_name,
              (
                SELECT GROUP_CONCAT(pf.original_name ORDER BY pf.uploaded_at DESC, pf.file_id DESC SEPARATOR ', ')
                FROM portfolio_files pf
                JOIN assignment_required_documents ard ON ard.id = pf.required_document_id
                WHERE pf.portfolio_id = p.portfolio_id
                  AND pf.removed_at IS NULL
                  AND ard.is_ai_gradable = 1
              ) AS main_answer_uploaded_files,
              (
                SELECT GROUP_CONCAT(pf.original_name ORDER BY pf.uploaded_at DESC, pf.file_id DESC SEPARATOR ', ')
                FROM portfolio_files pf
                JOIN assignment_required_documents ard ON ard.id = pf.required_document_id
                WHERE pf.portfolio_id = p.portfolio_id
                  AND pf.removed_at IS NULL
                  AND ard.is_ai_gradable = 1
                  AND (LOWER(pf.file_path) LIKE '%.pdf' OR LOWER(pf.file_path) LIKE '%.docx')
              ) AS ai_grading_file_names,
              ag.ai_status, ag.ai_grade, ag.ai_grading_error, ag.ai_model,
              fg.final_grade, fg.manual_score, fg.manual_remark, fg.saved_by,
              fg.saved_by_role, fg.saved_at, fg.status, fg.publish_status,
              fg.submitted_to_head_at, fg.published_at,
              fg.score_difference_warning, fg.score_difference,
              saved_u.email AS saved_by_email,
              saved_u.display_name AS saved_by_display_name,
              saved_t.full_name AS saved_by_full_name
       FROM portfolios p
       ${access.join}
       LEFT JOIN ai_grading ag ON ag.portfolio_id = p.portfolio_id
       LEFT JOIN final_grading fg ON fg.portfolio_id = p.portfolio_id AND fg.student_no = p.student_no
       LEFT JOIN users saved_u ON saved_u.user_id = fg.saved_by
       LEFT JOIN teachers saved_t ON saved_t.user_id = saved_u.user_id
       WHERE p.assignment_id=?
       ORDER BY p.upload_date DESC, p.portfolio_id DESC`,
      [...access.params, assignmentId]
    );

    const portfolioIds = rows.map((row) => row.portfolio_id).filter(Boolean);
    let displayRows = rows;
    if (portfolioIds.length) {
      const placeholders = portfolioIds.map(() => '?').join(',');
      const files = await query(
        `SELECT pf.file_id, pf.portfolio_id, pf.student_no, pf.file_path, pf.original_name,
                ard.document_name, COALESCE(ard.is_ai_gradable, 0) AS is_ai_gradable
         FROM portfolio_files pf
         LEFT JOIN assignment_required_documents ard ON ard.id = pf.required_document_id
         WHERE pf.portfolio_id IN (${placeholders})
           AND pf.removed_at IS NULL
         ORDER BY pf.uploaded_at DESC, pf.file_id DESC`,
        portfolioIds
      );
      displayRows = applySubmissionDisplayNames(rows, files);
    }

    res.json({
      assignment_id: assignmentId,
      results: displayRows.map((row) => manualRow(row, req)),
    });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Failed to load manual grading results' });
  }
}

export async function exportManualGradingExcel(req, res) {
  try {
    const assignmentId = validateAssignmentId(req);
    const assignment = await getAssignmentContext(assignmentId);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    const rows = await getManualExportRows(req, assignmentId);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'AIAGS';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Manual Grading', {
      views: [{ state: 'frozen', ySplit: 8 }],
    });

    worksheet.columns = [
      { key: 'student_no', width: 22 },
      { key: 'manual_score', width: 22 },
      { key: 'lecturer_remark', width: 55 },
    ];

    worksheet.addRow(['AIAGS Manual Grading Report']);
    worksheet.mergeCells('A1:C1');
    worksheet.getCell('A1').font = { bold: true, size: 16 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    worksheet.addRow(['Assignment', assignment.assignment_name || '']);
    worksheet.addRow(['Course', assignment.course_name || '']);
    worksheet.addRow(['Department', assignment.department || '']);
    worksheet.addRow(['Batch', assignment.batch || '']);
    worksheet.addRow(['Generated', new Date().toLocaleString()]);
    worksheet.addRow([]);

    const header = worksheet.addRow(['Student No', 'Manual/Teacher Score', 'Lecturer Remark']);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E78' },
    };
    header.alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.autoFilter = {
      from: { row: header.number, column: 1 },
      to: { row: header.number, column: 3 },
    };

    for (const row of rows) {
      const score = row.teacher_score ?? row.manual_score ?? '';
      const remark = row.manual_remark || '';
      const excelRow = worksheet.addRow([row.student_no || '', score, remark]);
      excelRow.getCell(2).alignment = { horizontal: 'center' };
      excelRow.getCell(3).alignment = { wrapText: true, vertical: 'top' };
    }

    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD9E2EC' } },
          left: { style: 'thin', color: { argb: 'FFD9E2EC' } },
          bottom: { style: 'thin', color: { argb: 'FFD9E2EC' } },
          right: { style: 'thin', color: { argb: 'FFD9E2EC' } },
        };
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${manualExportFilename(assignment.assignment_name)}"`);
    res.send(Buffer.from(buffer));
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Failed to export manual grading report' });
  }
}

export async function saveManualGrade(req, res) {
  try {
    const portfolioId = Number(req.params.portfolioId);
    if (!(await ensurePortfolioAccess(req, res, portfolioId))) return;

    const data = saveManualGradeSchema.parse(req.body || {});
    const context = await getPortfolioGradeContext(portfolioId);
    if (!context) return res.status(404).json({ error: 'Portfolio not found' });
    if (publicStatus(context) === 'published_to_student' && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Published grades can only be changed by admin/head' });
    }
    if (shouldHideDraftManualData(req, context, publicStatus(context))) {
      return res.status(403).json({ error: 'Lecturer draft grading has not been submitted to head yet' });
    }

    const manualScore = data.manual_score == null ? null : Number(data.manual_score);
    const aiScore = context.ai_grade == null ? null : Number(context.ai_grade);
    const difference = aiScore == null || manualScore == null ? null : Math.abs(manualScore - aiScore);
    const hasLargeDifference = difference != null && difference > 20;

    if (hasLargeDifference && !data.confirm_large_difference) {
      return res.status(409).json({
        error: 'The teacher score differs from the AI score by more than 20 marks. Please confirm before saving.',
        requires_confirmation: true,
        ai_score: aiScore,
        teacher_score: manualScore,
        difference,
      });
    }

    const publishStatus = publicStatus(context);
    const legacyStatus = legacyStatusFromPublishStatus(publishStatus);
    const remark = String(data.manual_remark || '').trim() || null;

    await query(
      `INSERT INTO final_grading
        (student_no, portfolio_id, status, final_grade, manual_score, manual_remark,
         saved_by, saved_by_role, saved_at, publish_status, ai_score_at_save,
         score_difference, score_difference_warning)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         status=VALUES(status),
         final_grade=VALUES(final_grade),
         manual_score=VALUES(manual_score),
         manual_remark=VALUES(manual_remark),
         saved_by=VALUES(saved_by),
         saved_by_role=VALUES(saved_by_role),
         saved_at=NOW(),
         publish_status=VALUES(publish_status),
         ai_score_at_save=VALUES(ai_score_at_save),
         score_difference=VALUES(score_difference),
         score_difference_warning=VALUES(score_difference_warning)`,
      [
        context.student_no,
        portfolioId,
        legacyStatus,
        manualScore,
        manualScore,
        remark,
        req.user.user_id,
        req.user.role,
        publishStatus,
        aiScore,
        difference,
        hasLargeDifference ? 1 : 0,
      ]
    );

    const saved = (
      await query(
        `SELECT fg.*, ag.ai_grade
         FROM final_grading fg
         LEFT JOIN ai_grading ag ON ag.portfolio_id = fg.portfolio_id
         WHERE fg.portfolio_id=? AND fg.student_no=?`,
        [portfolioId, context.student_no]
      )
    )[0];

    res.json({
      ok: true,
      grade: {
        portfolio_id: portfolioId,
        teacher_score: saved.manual_score ?? saved.final_grade,
        manual_remark: saved.manual_remark || '',
        publish_status: publicStatus(saved),
        score_difference_warning: Boolean(saved.score_difference_warning),
        score_difference: saved.score_difference,
      },
    });
  } catch (e) {
    if (e?.issues) return res.status(400).json({ error: 'Validation error', details: e.issues });
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Failed to save manual grade' });
  }
}

export async function submitAssignmentToHead(req, res) {
  try {
    const assignmentId = validateAssignmentId(req);

    const result = await query(
      `UPDATE final_grading fg
       JOIN portfolios p ON p.portfolio_id = fg.portfolio_id
       JOIN lecturer_portfolio_assignments lpa
         ON lpa.portfolio_id = p.portfolio_id
        AND lpa.lecturer_user_id = ?
       SET fg.status='DRAFT',
           fg.publish_status='submitted_to_head',
           fg.submitted_to_head_at=NOW()
       WHERE p.assignment_id=?
         AND (
           fg.final_grade IS NOT NULL
           OR (fg.manual_remark IS NOT NULL AND TRIM(fg.manual_remark) <> '')
         )
         AND fg.publish_status <> 'published_to_student'`,
      [req.user.user_id, assignmentId]
    );

    res.json({
      ok: true,
      submitted_count: result.affectedRows || 0,
    });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Failed to submit grades to head' });
  }
}

export async function publishAssignmentToStudents(req, res) {
  try {
    const assignmentId = validateAssignmentId(req);

    const result = await query(
      `UPDATE final_grading fg
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
         )`,
      [req.user.user_id, assignmentId]
    );

    res.json({
      ok: true,
      published_count: result.affectedRows || 0,
    });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Failed to publish grades to students' });
  }
}
