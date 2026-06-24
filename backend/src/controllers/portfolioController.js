import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { pool, query } from '../db.js';
import { viewSubmissionFileForStaff } from './studentSubmissionController.js';
import { ensurePortfolioAccess, lecturerPortfolioJoin } from '../services/lecturerAccess.js';
import { getDeadlineInfo } from '../services/deadlineService.js';
import {
  applySubmissionDisplayNames,
  formatSubmissionDisplayName,
  submissionDisplayName,
} from '../services/submissionFileNameService.js';

const createPortfolioSchema = z.object({
  student_no: z.string().min(1),
  assignment_id: z.coerce.number().int()
});

const ALLOWED_EXTENSIONS_BY_TYPE = {
  pdf: ['.pdf'],
  docx: ['.docx'],
  pdf_or_docx: ['.pdf', '.docx'],
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
  excel: ['.xlsx', '.xls', '.csv'],
  any_supported_document: ['.pdf', '.docx', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.xlsx', '.xls', '.csv'],
};

const AI_SUPPORTED_EXTENSIONS = new Set(['.pdf', '.docx']);

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function getExtension(filename) {
  return path.extname(filename || '').toLowerCase();
}

function isAiSupportedPath(filePath) {
  return AI_SUPPORTED_EXTENSIONS.has(getExtension(filePath));
}

function storedSubmissionPath(file) {
  return `/uploads/submissions/${file.filename}`;
}

function parseRequiredDocumentId(fieldname) {
  if (fieldname === 'files_general' || fieldname === 'file' || fieldname === 'files') return null;
  const match = /^files_(\d+)$/.exec(fieldname || '');
  if (!match) throw badRequest('Invalid upload field name.');
  return Number(match[1]);
}

function safeRequirement(row) {
  return {
    id: row.id,
    assignment_id: row.assignment_id,
    document_name: row.document_name,
    allowed_file_type: row.allowed_file_type,
    is_mandatory: Boolean(row.is_mandatory),
    is_ai_gradable: Boolean(row.is_ai_gradable),
  };
}

function safeFile(row) {
  const displayName = submissionDisplayName(row);
  return {
    file_id: row.file_id,
    portfolio_id: row.portfolio_id,
    assignment_id: row.assignment_id,
    required_document_id: row.required_document_id,
    required_document_name: row.document_name || null,
    allowed_file_type: row.allowed_file_type || null,
    is_mandatory: row.is_mandatory == null ? null : Boolean(row.is_mandatory),
    is_ai_gradable: Boolean(row.is_ai_gradable),
    original_name: displayName,
    display_name: displayName,
    mime_type: row.mime_type,
    file_size: row.file_size,
    uploaded_at: row.uploaded_at,
  };
}

function safeAssignment(row) {
  if (!row) return null;
  return {
    assignment_id: row.assignment_id,
    assignment_name: row.assignment_name,
    batch: row.batch,
    course_name: row.course_name,
    department: row.department,
    start_date: row.start_date,
    start_time: row.start_time,
    deadline_date: row.deadline_date,
    deadline_time: row.deadline_time,
    remark: row.remark,
    guideline_file_original_name: row.guideline_file_original_name || null,
    has_guideline: Boolean(row.guideline_file_path),
    ...getDeadlineInfo(row),
  };
}

function groupFiles(requirements, files) {
  const groups = requirements.map((requirement) => ({
    requirement,
    files: files
      .filter((file) => Number(file.required_document_id) === Number(requirement.id))
      .map(safeFile),
  }));

  const uncategorized = files
    .filter((file) => !file.required_document_id)
    .map(safeFile);

  if (uncategorized.length || requirements.length === 0) {
    groups.push({
      requirement: {
        id: null,
        assignment_id: null,
        document_name: requirements.length === 0 ? 'Assignment Submission' : 'Uncategorized Files',
        allowed_file_type: 'pdf_or_docx',
        is_mandatory: requirements.length === 0,
        is_ai_gradable: false,
      },
      files: uncategorized,
    });
  }

  return groups;
}

function submissionCompletion(requirements, files) {
  if (requirements.length === 0) {
    return {
      is_complete: files.length > 0,
      missing_mandatory_documents: files.length > 0 ? [] : ['Assignment Submission'],
    };
  }

  const missing = requirements
    .filter((requirement) => requirement.is_mandatory)
    .filter((requirement) => !files.some((file) => Number(file.required_document_id) === Number(requirement.id)))
    .map((requirement) => requirement.document_name);

  return {
    is_complete: missing.length === 0,
    missing_mandatory_documents: missing,
  };
}

function validateFileForRequirement(file, requirement) {
  const ext = getExtension(file.originalname);
  if (ext === '.doc') {
    throw badRequest('DOC files are not supported. Please convert the document to DOCX or PDF and upload again.');
  }

  const allowedType = requirement?.allowed_file_type || 'pdf_or_docx';
  const allowedExtensions = ALLOWED_EXTENSIONS_BY_TYPE[allowedType] || ALLOWED_EXTENSIONS_BY_TYPE.pdf_or_docx;
  if (!allowedExtensions.includes(ext)) {
    throw badRequest(`Unsupported file type for "${requirement?.document_name || 'Assignment Submission'}". Please upload ${allowedType.replaceAll('_', ' ')} file(s).`);
  }
}

function validateUploadedFiles(files, requirements) {
  const requirementMap = new Map(requirements.map((requirement) => [Number(requirement.id), requirement]));

  return files.map((file) => {
    const requiredDocumentId = parseRequiredDocumentId(file.fieldname);
    const requirement = requiredDocumentId ? requirementMap.get(requiredDocumentId) : null;
    if (requiredDocumentId && !requirement) throw badRequest('Invalid required document selected for upload.');
    if (requirements.length && !requiredDocumentId) {
      throw badRequest('Select the required document section before uploading files.');
    }
    if (!requirements.length && requiredDocumentId) {
      throw badRequest('This assignment does not have required document definitions.');
    }
    validateFileForRequirement(file, requirement);
    return { file, requiredDocumentId, requirement };
  });
}

function checkMandatoryRequirements(requirements, existingFiles, pendingFiles) {
  const combined = [
    ...existingFiles,
    ...pendingFiles.map((pending) => ({ required_document_id: pending.requiredDocumentId })),
  ];
  const completion = submissionCompletion(requirements, combined);
  if (!completion.is_complete) {
    throw badRequest(`Missing mandatory document(s): ${completion.missing_mandatory_documents.join(', ')}`);
  }
}

function chooseRepresentativeFile(files) {
  if (!files.length) return null;
  return files.find((file) => file.is_ai_gradable && isAiSupportedPath(file.file_path))
    || files.find((file) => file.is_ai_gradable)
    || files.find((file) => isAiSupportedPath(file.file_path))
    || files[0];
}

function cleanupUploadedFiles(files = []) {
  for (const file of files) {
    if (file?.path) fs.unlink(file.path).catch(() => {});
  }
}

async function getAssignment(assignmentId) {
  return (
    await query('SELECT * FROM assignments WHERE assignment_id=? LIMIT 1', [assignmentId])
  )[0] || null;
}

async function getRequiredDocuments(assignmentId) {
  const rows = await query(
    `SELECT id, assignment_id, document_name, allowed_file_type, is_mandatory, is_ai_gradable
     FROM assignment_required_documents
     WHERE assignment_id=?
     ORDER BY id ASC`,
    [assignmentId]
  );
  return rows.map(safeRequirement);
}

async function getLatestPortfolio(studentNo, assignmentId) {
  if (!studentNo) return null;
  return (
    await query(
      `SELECT *
       FROM portfolios
       WHERE assignment_id=? AND student_no=?
       ORDER BY upload_date DESC, portfolio_id DESC
       LIMIT 1`,
      [assignmentId, studentNo]
    )
  )[0] || null;
}

async function getActiveFiles(studentNo, assignmentId) {
  if (!studentNo) return [];
  const rows = await query(
    `SELECT pf.file_id, pf.portfolio_id, pf.assignment_id, pf.student_no,
            pf.required_document_id, pf.file_path, pf.original_name, pf.mime_type,
            pf.file_size, pf.uploaded_at, ard.document_name, ard.allowed_file_type,
            ard.is_mandatory, ard.is_ai_gradable
     FROM portfolio_files pf
     LEFT JOIN assignment_required_documents ard ON ard.id = pf.required_document_id
     WHERE pf.assignment_id=? AND pf.student_no=? AND pf.removed_at IS NULL
     ORDER BY COALESCE(ard.id, 0) ASC, pf.uploaded_at DESC, pf.file_id DESC`,
    [assignmentId, studentNo]
  );
  return rows;
}

async function refreshPortfolioRepresentative(conn, portfolioId) {
  const [rows] = await conn.execute(
    `SELECT pf.file_id, pf.file_path, COALESCE(ard.is_ai_gradable, 0) AS is_ai_gradable
     FROM portfolio_files pf
     LEFT JOIN assignment_required_documents ard ON ard.id = pf.required_document_id
     WHERE pf.portfolio_id=? AND pf.removed_at IS NULL
     ORDER BY CASE
       WHEN COALESCE(ard.is_ai_gradable, 0) = 1
            AND (LOWER(pf.file_path) LIKE '%.pdf' OR LOWER(pf.file_path) LIKE '%.docx') THEN 0
       WHEN COALESCE(ard.is_ai_gradable, 0) = 1 THEN 1
       WHEN LOWER(pf.file_path) LIKE '%.pdf' OR LOWER(pf.file_path) LIKE '%.docx' THEN 2
       ELSE 3
     END, pf.uploaded_at DESC, pf.file_id DESC`,
    [portfolioId]
  );

  const representative = rows[0] || null;
  await conn.execute(
    'UPDATE portfolios SET portfolio_link=?, upload_date=NOW() WHERE portfolio_id=?',
    [representative?.file_path || '', portfolioId]
  );
}

async function buildAdminSubmissionPayload(assignmentId, studentNo) {
  const [assignment, requirements, portfolio, activeFiles] = await Promise.all([
    getAssignment(assignmentId),
    getRequiredDocuments(assignmentId),
    getLatestPortfolio(studentNo, assignmentId),
    getActiveFiles(studentNo, assignmentId),
  ]);
  if (!assignment) throw notFound('Assignment not found');

  const completion = submissionCompletion(requirements, activeFiles);
  return {
    assignment: safeAssignment(assignment),
    student_no: studentNo || null,
    required_documents: requirements,
    portfolio: portfolio
      ? {
          portfolio_id: portfolio.portfolio_id,
          upload_date: portfolio.upload_date,
          is_complete: completion.is_complete,
          missing_mandatory_documents: completion.missing_mandatory_documents,
        }
      : {
          portfolio_id: null,
          upload_date: null,
          is_complete: false,
          missing_mandatory_documents: completion.missing_mandatory_documents,
        },
    files: activeFiles.map(safeFile),
    groups: groupFiles(requirements, activeFiles),
  };
}

async function buildPortfolioSubmissionPackage(portfolioId) {
  const row = (
    await query(
      `SELECT p.portfolio_id, p.student_no, p.assignment_id, p.portfolio_link, p.upload_date,
              a.assignment_name, a.batch, a.course_name, a.department,
              a.start_date, a.start_time, a.deadline_date, a.deadline_time, a.remark,
              a.guideline_file_path, a.guideline_file_original_name,
              a.guideline_file_mime, a.guideline_file_size
       FROM portfolios p
       JOIN assignments a ON a.assignment_id = p.assignment_id
       WHERE p.portfolio_id=?
       LIMIT 1`,
      [portfolioId]
    )
  )[0];

  if (!row) throw notFound('Portfolio not found');

  const [requirements, activeFiles] = await Promise.all([
    getRequiredDocuments(row.assignment_id),
    query(
      `SELECT pf.file_id, pf.portfolio_id, pf.assignment_id, pf.student_no,
              pf.required_document_id, pf.file_path, pf.original_name, pf.mime_type,
              pf.file_size, pf.uploaded_at, ard.document_name, ard.allowed_file_type,
              ard.is_mandatory, ard.is_ai_gradable
       FROM portfolio_files pf
       LEFT JOIN assignment_required_documents ard ON ard.id = pf.required_document_id
       WHERE pf.portfolio_id=? AND pf.removed_at IS NULL
       ORDER BY COALESCE(ard.id, 0) ASC, pf.uploaded_at DESC, pf.file_id DESC`,
      [portfolioId]
    ),
  ]);

  const completion = submissionCompletion(requirements, activeFiles);
  return {
    assignment: safeAssignment(row),
    student_no: row.student_no,
    portfolio: {
      portfolio_id: row.portfolio_id,
      student_no: row.student_no,
      upload_date: row.upload_date,
      submission_status: completion.is_complete
        ? 'SUBMITTED'
        : activeFiles.length > 0
          ? 'INCOMPLETE'
          : 'NO FILES',
      is_complete: completion.is_complete,
      missing_mandatory_documents: completion.missing_mandatory_documents,
    },
    required_documents: requirements,
    files: activeFiles.map(safeFile),
    groups: groupFiles(requirements, activeFiles),
  };
}

function publishStatus(row) {
  if (row.publish_status) return row.publish_status;
  return row.status === 'PUBLISHED' ? 'published_to_student' : 'draft';
}

function submissionStatus(row) {
  const activeFiles = Number(row.active_file_count || 0) || (row.portfolio_link ? 1 : 0);
  const missingMandatory = Number(row.missing_mandatory_count || 0);
  if (activeFiles === 0) return 'NO FILES';
  return missingMandatory > 0 ? 'INCOMPLETE' : 'SUBMITTED';
}

function hasManualDraftData(row) {
  return row.manual_score != null
    || row.final_grade != null
    || Boolean(String(row.manual_remark || '').trim())
    || row.saved_by != null;
}

function shouldHideDraftManualData(req, row, rowPublishStatus) {
  return req.user?.role === 'admin'
    && rowPublishStatus === 'draft'
    && hasManualDraftData(row)
    && row.saved_by_role !== 'admin';
}

function portfolioRow(row, req) {
  const rowPublishStatus = publishStatus(row);
  const hideDraft = shouldHideDraftManualData(req, row, rowPublishStatus);
  const visibleManualScore = hideDraft ? null : row.manual_score;
  const visibleFinalGrade = hideDraft ? null : row.final_grade;
  const visibleTeacherScore = hideDraft ? null : (row.manual_score ?? row.final_grade ?? null);
  const visibleRemark = hideDraft ? '' : (row.manual_remark || '');
  const notSubmittedMessage = 'Not submitted by lecturer yet';

  return {
    ...row,
    active_file_count: Number(row.active_file_count || 0) || (row.portfolio_link ? 1 : 0),
    missing_mandatory_count: Number(row.missing_mandatory_count || 0),
    submission_status: submissionStatus(row),
    ai_status: row.ai_status || 'pending',
    final_grade: visibleFinalGrade,
    manual_score: visibleManualScore,
    manual_remark: visibleRemark,
    teacher_score: visibleTeacherScore,
    lecturer_remark: visibleRemark,
    manual_score_display: visibleTeacherScore,
    manual_remark_display: hideDraft ? notSubmittedMessage : visibleRemark,
    manual_draft_hidden: hideDraft,
    head_visibility_status: hideDraft ? 'not_submitted' : rowPublishStatus,
    saved_by: hideDraft ? null : row.saved_by,
    saved_by_role: hideDraft ? null : row.saved_by_role,
    final_published_score: rowPublishStatus === 'published_to_student' ? row.final_grade : null,
    publish_status: rowPublishStatus,
    publish_status_label: rowPublishStatus === 'published_to_student'
      ? 'Published to Student'
      : rowPublishStatus === 'submitted_to_head'
        ? 'Submitted to Head'
        : 'Draft',
    assigned_lecturer: row.lecturer_user_id
      ? {
          user_id: row.lecturer_user_id,
          email: row.lecturer_email,
          display_name: row.lecturer_display_name,
          teacher_id: row.lecturer_teacher_id,
          full_name: row.lecturer_full_name,
          label: row.lecturer_full_name || row.lecturer_display_name || row.lecturer_email,
        }
      : null,
  };
}

async function resolveUploadStudentNo(req, submittedStudentNo) {
  if (req.user?.role !== 'student') return submittedStudentNo;

  const student = (
    await query(
      'SELECT student_no FROM students WHERE user_id=? LIMIT 1',
      [req.user.user_id]
    )
  )[0];

  return student?.student_no || submittedStudentNo;
}

export async function uploadPortfolio(req, res) {
  let conn;
  try {
    const uploadedFiles = req.files?.length ? req.files : (req.file ? [req.file] : []);
    if (!uploadedFiles.length) return res.status(400).json({ error: 'No file uploaded' });

    const meta = createPortfolioSchema.parse(req.body);
    const studentNo = await resolveUploadStudentNo(req, meta.student_no);
    const assignment = await getAssignment(meta.assignment_id);
    if (!assignment) throw notFound('Assignment not found');
    const requirements = await getRequiredDocuments(meta.assignment_id);
    const existingPortfolio = await getLatestPortfolio(studentNo, meta.assignment_id);
    const existingFiles = await getActiveFiles(studentNo, meta.assignment_id);
    const pendingFiles = validateUploadedFiles(uploadedFiles, requirements);
    checkMandatoryRequirements(requirements, existingFiles, pendingFiles);

    // ensure student exists (create on the fly if not present)
    const student = (await query('SELECT student_no FROM students WHERE student_no=?', [studentNo]))[0];
    if (!student) {
      await query(
        'INSERT INTO students (student_no, batch, original_batch, course_name) VALUES (?,?,?,?)',
        [studentNo, assignment.batch || null, assignment.batch || null, assignment.course_name || null]
      );
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    let portfolio = existingPortfolio;
    if (!portfolio) {
      const representative = chooseRepresentativeFile(
        pendingFiles.map((pending) => ({
          file_path: storedSubmissionPath(pending.file),
          is_ai_gradable: Boolean(pending.requirement?.is_ai_gradable),
        }))
      );
      if (!representative) throw badRequest('Choose at least one file to upload.');

      const [result] = await conn.execute(
        'INSERT INTO portfolios (student_no, assignment_id, portfolio_link) VALUES (?,?,?)',
        [studentNo, meta.assignment_id, representative.file_path]
      );
      portfolio = {
        portfolio_id: result.insertId,
        student_no: studentNo,
        assignment_id: meta.assignment_id,
      };
    }

    for (const pending of pendingFiles) {
      await conn.execute(
        `INSERT INTO portfolio_files
          (portfolio_id, assignment_id, student_no, required_document_id,
           file_path, original_name, mime_type, file_size)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          portfolio.portfolio_id,
          meta.assignment_id,
          studentNo,
          pending.requiredDocumentId,
          storedSubmissionPath(pending.file),
          formatSubmissionDisplayName(
            studentNo,
            pending.requirement?.document_name || 'Assignment Submission',
            pending.file.originalname,
            storedSubmissionPath(pending.file)
          ),
          pending.file.mimetype || null,
          pending.file.size || null,
        ]
      );
    }

    await refreshPortfolioRepresentative(conn, portfolio.portfolio_id);
    await conn.commit();

    const rows = await query('SELECT * FROM portfolios WHERE portfolio_id=?', [portfolio.portfolio_id]);
    res.status(201).json({
      portfolio: rows[0],
      submission: await buildAdminSubmissionPayload(meta.assignment_id, studentNo),
    });
  } catch (e) {
    if (conn) await conn.rollback().catch(() => {});
    cleanupUploadedFiles(req.files || []);
    if (e?.issues) return res.status(400).json({ error: 'Validation error', details: e.issues });
    if (e?.statusCode) return res.status(e.statusCode).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (conn) conn.release();
  }
}

export async function getAdminSubmission(req, res) {
  try {
    const assignmentId = Number(req.params.assignmentId || req.query.assignment_id);
    const studentNo = String(req.params.studentNo || req.query.student_no || '').trim();
    if (!Number.isInteger(assignmentId) || assignmentId <= 0) throw badRequest('Invalid assignment id');

    res.json(await buildAdminSubmissionPayload(assignmentId, studentNo));
  } catch (e) {
    if (e?.statusCode) return res.status(e.statusCode).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Failed to load portfolio submission' });
  }
}

export async function removeAdminSubmissionFile(req, res) {
  let conn;
  try {
    const fileId = Number(req.params.fileId);
    if (!Number.isInteger(fileId) || fileId <= 0) throw badRequest('Invalid file id');

    const file = (
      await query(
        `SELECT file_id, portfolio_id, assignment_id, student_no
         FROM portfolio_files
         WHERE file_id=? AND removed_at IS NULL
         LIMIT 1`,
        [fileId]
      )
    )[0];
    if (!file) throw notFound('Submission file not found');

    conn = await pool.getConnection();
    await conn.beginTransaction();
    await conn.execute('UPDATE portfolio_files SET removed_at=NOW() WHERE file_id=?', [fileId]);
    if (file.portfolio_id) await refreshPortfolioRepresentative(conn, file.portfolio_id);
    await conn.commit();

    res.json({
      ok: true,
      submission: await buildAdminSubmissionPayload(file.assignment_id, file.student_no),
    });
  } catch (e) {
    if (conn) await conn.rollback().catch(() => {});
    if (e?.statusCode) return res.status(e.statusCode).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Failed to remove submission file' });
  } finally {
    if (conn) conn.release();
  }
}

export async function listPortfolios(req, res) {
  const { assignment_id, batch } = req.query;
  const params = [];
  const access = lecturerPortfolioJoin(req, 'p');
  let sql = `
    SELECT p.*, a.assignment_name, a.batch, a.course_name, a.department,
           (
             SELECT COUNT(*)
             FROM portfolio_files pf
             WHERE pf.portfolio_id = p.portfolio_id
               AND pf.removed_at IS NULL
           ) AS active_file_count,
           (
             SELECT COUNT(*)
             FROM assignment_required_documents ard
             WHERE ard.assignment_id = p.assignment_id
               AND ard.is_mandatory = 1
               AND NOT EXISTS (
                 SELECT 1
                 FROM portfolio_files pf
                 WHERE pf.portfolio_id = p.portfolio_id
                   AND pf.required_document_id = ard.id
                   AND pf.removed_at IS NULL
               )
           ) AS missing_mandatory_count,
           (
             SELECT pf.file_id
             FROM portfolio_files pf
             LEFT JOIN assignment_required_documents ard_primary ON ard_primary.id = pf.required_document_id
             WHERE pf.portfolio_id = p.portfolio_id
               AND pf.removed_at IS NULL
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
           ag.ai_status, ag.ai_grade, ag.ai_grading_error,
           fg.final_grade, fg.manual_score, fg.manual_remark, fg.status, fg.publish_status,
           fg.saved_by, fg.saved_by_role,
           lpa.lecturer_user_id,
           u.email AS lecturer_email,
           u.display_name AS lecturer_display_name,
           t.teacher_id AS lecturer_teacher_id,
           t.full_name AS lecturer_full_name
    FROM portfolios p
    ${access.join}
    JOIN assignments a ON a.assignment_id = p.assignment_id
    LEFT JOIN ai_grading ag ON ag.portfolio_id = p.portfolio_id
    LEFT JOIN final_grading fg ON fg.portfolio_id = p.portfolio_id AND fg.student_no = p.student_no
    LEFT JOIN lecturer_portfolio_assignments lpa ON lpa.portfolio_id = p.portfolio_id
    LEFT JOIN users u ON u.user_id = lpa.lecturer_user_id
    LEFT JOIN teachers t ON t.user_id = u.user_id
    WHERE 1=1
  `;
  params.push(...access.params);
  if (assignment_id) { sql += ' AND p.assignment_id=?'; params.push(Number(assignment_id)); }
  if (batch) { sql += ' AND a.batch=?'; params.push(String(batch)); }
  sql += ' ORDER BY p.upload_date DESC';
  const rows = await query(sql, params);
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
  res.json({ portfolios: displayRows.map((row) => portfolioRow(row, req)) });
}

export async function getPortfolioSubmissionPackage(req, res) {
  try {
    const portfolioId = Number(req.params.id);
    if (!(await ensurePortfolioAccess(req, res, portfolioId))) return;

    res.json(await buildPortfolioSubmissionPackage(portfolioId));
  } catch (e) {
    if (e?.statusCode) return res.status(e.statusCode).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Failed to load portfolio submission' });
  }
}

export async function getPortfolio(req, res) {
  const portfolioId = Number(req.params.id);
  if (!(await ensurePortfolioAccess(req, res, portfolioId))) return;

  const rows = await query(
    `
    SELECT p.*, a.assignment_name, a.batch, a.course_name,
           (
             SELECT pf.file_id
             FROM portfolio_files pf
             LEFT JOIN assignment_required_documents ard_primary ON ard_primary.id = pf.required_document_id
             WHERE pf.portfolio_id = p.portfolio_id
               AND pf.removed_at IS NULL
             ORDER BY CASE
               WHEN COALESCE(ard_primary.is_ai_gradable, 0) = 1
                    AND (LOWER(pf.file_path) LIKE '%.pdf' OR LOWER(pf.file_path) LIKE '%.docx') THEN 0
               WHEN COALESCE(ard_primary.is_ai_gradable, 0) = 1 THEN 1
               WHEN LOWER(pf.file_path) LIKE '%.pdf' OR LOWER(pf.file_path) LIKE '%.docx' THEN 2
               ELSE 3
             END, pf.uploaded_at DESC, pf.file_id DESC
             LIMIT 1
           ) AS primary_file_id
    FROM portfolios p
    JOIN assignments a ON a.assignment_id = p.assignment_id
    WHERE p.portfolio_id=?
    `,
    [portfolioId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json({ portfolio: rows[0] });
}

export { viewSubmissionFileForStaff };

export async function deletePortfolio(req, res) {
  const portfolioId = Number(req.params.id);
  const files = await query(
    'SELECT file_path FROM portfolio_files WHERE portfolio_id=? AND removed_at IS NULL',
    [portfolioId]
  );
  for (const file of files) {
    const filePath = file.file_path?.startsWith('/uploads/')
      ? path.resolve(process.cwd(), file.file_path.replace(/^\//, ''))
      : null;
    if (filePath) await fs.unlink(filePath).catch(() => {});
  }
  await query('UPDATE portfolio_files SET removed_at=NOW() WHERE portfolio_id=? AND removed_at IS NULL', [portfolioId]);
  await query('DELETE FROM portfolios WHERE portfolio_id=?', [portfolioId]);
  res.json({ ok: true });
}
