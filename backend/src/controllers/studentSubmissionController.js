import fs from 'fs';
import path from 'path';
import { pool, query } from '../db.js';
import { ensurePortfolioAccess } from '../services/lecturerAccess.js';
import { assertSubmissionOpen, getDeadlineInfo } from '../services/deadlineService.js';

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

function accessDenied(message = 'Access denied') {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
}

function safeMessage(error) {
  return String(error?.message || error || 'Unknown error');
}

function toDateOnly(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function safeAssignment(row) {
  if (!row) return null;
  return {
    assignment_id: row.assignment_id,
    assignment_name: row.assignment_name,
    batch: row.batch,
    course_name: row.course_name,
    department: row.department,
    start_date: toDateOnly(row.start_date),
    start_time: row.start_time || null,
    deadline_date: toDateOnly(row.deadline_date),
    deadline_time: row.deadline_time || null,
    remark: row.remark,
    guideline_file_original_name: row.guideline_file_original_name || null,
    guideline_file_mime: row.guideline_file_mime || null,
    guideline_file_size: row.guideline_file_size || null,
    has_guideline: Boolean(row.guideline_file_path),
    ...getDeadlineInfo(row),
  };
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
  return {
    file_id: row.file_id,
    portfolio_id: row.portfolio_id,
    assignment_id: row.assignment_id,
    required_document_id: row.required_document_id,
    required_document_name: row.document_name || null,
    allowed_file_type: row.allowed_file_type || null,
    is_mandatory: row.is_mandatory === null || row.is_mandatory === undefined ? null : Boolean(row.is_mandatory),
    is_ai_gradable: row.is_ai_gradable === null || row.is_ai_gradable === undefined ? false : Boolean(row.is_ai_gradable),
    original_name: row.original_name,
    mime_type: row.mime_type,
    file_size: row.file_size,
    uploaded_at: row.uploaded_at,
  };
}

function resolveStoredPath(filePath) {
  if (!filePath) return null;
  const root = path.resolve(process.cwd(), 'uploads');
  const absolute = path.resolve(process.cwd(), filePath.replace(/^\/+/, '').replace(/\//g, path.sep));
  if (!absolute.startsWith(root)) return null;
  return absolute;
}

function cleanupFiles(files = []) {
  for (const file of files) {
    if (!file?.path) continue;
    try {
      fs.unlinkSync(file.path);
    } catch {
      // Best-effort cleanup only.
    }
  }
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
  if (fieldname === 'files_general') return null;
  const match = /^files_(\d+)$/.exec(fieldname || '');
  if (!match) throw badRequest('Invalid upload field name.');
  return Number(match[1]);
}

async function getLoggedStudent(userId) {
  return (
    await query(
      `SELECT s.student_no, s.full_name, s.batch, s.course_name, s.department,
              u.email, u.display_name
       FROM students s
       JOIN users u ON u.user_id = s.user_id
       WHERE s.user_id = ?
       LIMIT 1`,
      [userId]
    )
  )[0];
}

function studentIdentifiers(student) {
  return [student.student_no, student.email].filter(Boolean);
}

function matchesStudentProfile(assignment, student) {
  if (!student) return false;
  if (student.batch && assignment.batch !== student.batch) return false;
  if (student.course_name && assignment.course_name !== student.course_name) return false;
  if (student.department && assignment.department && String(assignment.department).toLowerCase() !== String(student.department).toLowerCase()) {
    return false;
  }
  return true;
}

async function getStudentAndAssignment(req, assignmentId) {
  const userId = req.user?.user_id;
  if (!userId) throw accessDenied('Not authenticated');

  const student = await getLoggedStudent(userId);
  if (!student) throw notFound('Student profile not found for this account');

  const assignment = (
    await query('SELECT * FROM assignments WHERE assignment_id=? LIMIT 1', [assignmentId])
  )[0];
  if (!assignment) throw notFound('Assignment not found');
  if (!matchesStudentProfile(assignment, student)) throw accessDenied();

  return { student, assignment };
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

async function getLatestPortfolio(student, assignmentId) {
  const ids = studentIdentifiers(student);
  if (!ids.length) return null;
  const placeholders = ids.map(() => '?').join(',');
  return (
    await query(
      `SELECT *
       FROM portfolios
       WHERE assignment_id=?
         AND student_no IN (${placeholders})
       ORDER BY upload_date DESC, portfolio_id DESC
       LIMIT 1`,
      [assignmentId, ...ids]
    )
  )[0] || null;
}

async function getActiveFiles(student, assignmentId) {
  const ids = studentIdentifiers(student);
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = await query(
    `SELECT pf.file_id, pf.portfolio_id, pf.assignment_id, pf.student_no,
            pf.required_document_id, pf.file_path, pf.original_name, pf.mime_type,
            pf.file_size, pf.uploaded_at, ard.document_name, ard.allowed_file_type,
            ard.is_mandatory, ard.is_ai_gradable
     FROM portfolio_files pf
     LEFT JOIN assignment_required_documents ard ON ard.id = pf.required_document_id
     WHERE pf.assignment_id=?
       AND pf.student_no IN (${placeholders})
       AND pf.removed_at IS NULL
     ORDER BY COALESCE(ard.id, 0) ASC, pf.uploaded_at DESC, pf.file_id DESC`,
    [assignmentId, ...ids]
  );
  return rows;
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
  const activeFiles = files.filter(Boolean);
  if (requirements.length === 0) {
    return {
      is_complete: activeFiles.length > 0,
      missing_mandatory_documents: activeFiles.length > 0 ? [] : ['Assignment Submission'],
    };
  }

  const missing = requirements
    .filter((requirement) => requirement.is_mandatory)
    .filter((requirement) => !activeFiles.some((file) => Number(file.required_document_id) === Number(requirement.id)))
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
    if (requiredDocumentId && !requirement) {
      throw badRequest('Invalid required document selected for upload.');
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
  const aiGradableSupported = files.find((file) => file.is_ai_gradable && isAiSupportedPath(file.file_path));
  if (aiGradableSupported) return aiGradableSupported;
  const aiGradable = files.find((file) => file.is_ai_gradable);
  if (aiGradable) return aiGradable;
  const aiSupported = files.find((file) => isAiSupportedPath(file.file_path));
  return aiSupported || files[0];
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

async function buildSubmissionPayload(req, assignmentId) {
  const { student, assignment } = await getStudentAndAssignment(req, assignmentId);
  const [requirements, portfolio, activeFileRows] = await Promise.all([
    getRequiredDocuments(assignmentId),
    getLatestPortfolio(student, assignmentId),
    getActiveFiles(student, assignmentId),
  ]);

  const completion = submissionCompletion(requirements, activeFileRows);
  return {
    assignment: safeAssignment(assignment),
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
    files: activeFileRows.map(safeFile),
    groups: groupFiles(requirements, activeFileRows),
  };
}

export async function getAssignmentRequirements(req, res) {
  try {
    const assignmentId = Number(req.params.assignmentId);
    if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
      return res.status(400).json({ error: 'Invalid assignment id' });
    }

    const { assignment } = await getStudentAndAssignment(req, assignmentId);
    const requiredDocuments = await getRequiredDocuments(assignmentId);
    res.json({
      assignment: safeAssignment(assignment),
      required_documents: requiredDocuments,
    });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'Failed to load assignment requirements' });
  }
}

export async function getStudentSubmission(req, res) {
  try {
    const assignmentId = Number(req.params.assignmentId);
    if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
      return res.status(400).json({ error: 'Invalid assignment id' });
    }

    res.json(await buildSubmissionPayload(req, assignmentId));
  } catch (e) {
    console.error(e.statusCode ? null : e);
    res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'Failed to load submission' });
  }
}

export async function saveStudentSubmission(req, res) {
  let conn;
  try {
    const assignmentId = Number(req.params.assignmentId);
    if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
      throw badRequest('Invalid assignment id');
    }

    const files = req.files || [];
    const { student, assignment } = await getStudentAndAssignment(req, assignmentId);
    assertSubmissionOpen(assignment);
    const requirements = await getRequiredDocuments(assignmentId);
    const existingPortfolio = await getLatestPortfolio(student, assignmentId);
    const existingFiles = await getActiveFiles(student, assignmentId);
    const pendingFiles = validateUploadedFiles(files, requirements);

    if (!pendingFiles.length && !existingFiles.length) {
      throw badRequest('Choose at least one file to upload.');
    }

    checkMandatoryRequirements(requirements, existingFiles, pendingFiles);

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

      const [portfolioResult] = await conn.execute(
        'INSERT INTO portfolios (student_no, assignment_id, portfolio_link) VALUES (?,?,?)',
        [student.student_no, assignment.assignment_id, representative.file_path]
      );
      portfolio = {
        portfolio_id: portfolioResult.insertId,
        student_no: student.student_no,
        assignment_id: assignment.assignment_id,
      };
    }

    const ownerStudentNo = portfolio.student_no || student.student_no;
    for (const pending of pendingFiles) {
      await conn.execute(
        `INSERT INTO portfolio_files
          (portfolio_id, assignment_id, student_no, required_document_id, file_path,
           original_name, mime_type, file_size)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          portfolio.portfolio_id,
          assignment.assignment_id,
          ownerStudentNo,
          pending.requiredDocumentId,
          storedSubmissionPath(pending.file),
          pending.file.originalname,
          pending.file.mimetype || null,
          pending.file.size || null,
        ]
      );
    }

    await refreshPortfolioRepresentative(conn, portfolio.portfolio_id);
    await conn.commit();

    res.status(201).json(await buildSubmissionPayload(req, assignmentId));
  } catch (e) {
    if (conn) await conn.rollback().catch(() => {});
    cleanupFiles(req.files || []);
    if (!e.statusCode) console.error(e);
    res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'Failed to save submission' });
  } finally {
    if (conn) conn.release();
  }
}

export async function removeStudentSubmissionFile(req, res) {
  let conn;
  try {
    const fileId = Number(req.params.fileId);
    if (!Number.isInteger(fileId) || fileId <= 0) throw badRequest('Invalid file id');

    const student = await getLoggedStudent(req.user?.user_id);
    if (!student) throw notFound('Student profile not found for this account');
    const ids = studentIdentifiers(student);
    const placeholders = ids.map(() => '?').join(',');

    const file = (
      await query(
        `SELECT *
         FROM portfolio_files
         WHERE file_id=?
           AND student_no IN (${placeholders})
           AND removed_at IS NULL
         LIMIT 1`,
        [fileId, ...ids]
      )
    )[0];
    if (!file) throw notFound('Submission file not found');

    const { assignment } = await getStudentAndAssignment(req, file.assignment_id);
    assertSubmissionOpen(assignment);

    conn = await pool.getConnection();
    await conn.beginTransaction();
    await conn.execute('UPDATE portfolio_files SET removed_at=NOW() WHERE file_id=?', [fileId]);
    if (file.portfolio_id) await refreshPortfolioRepresentative(conn, file.portfolio_id);
    await conn.commit();

    res.json({ ok: true, submission: await buildSubmissionPayload(req, file.assignment_id) });
  } catch (e) {
    if (conn) await conn.rollback().catch(() => {});
    if (!e.statusCode) console.error(e);
    res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'Failed to remove submission file' });
  } finally {
    if (conn) conn.release();
  }
}

export async function viewStudentSubmissionFile(req, res) {
  try {
    const fileId = Number(req.params.fileId);
    if (!Number.isInteger(fileId) || fileId <= 0) throw badRequest('Invalid file id');

    const student = await getLoggedStudent(req.user?.user_id);
    if (!student) throw notFound('Student profile not found for this account');
    const ids = studentIdentifiers(student);
    const placeholders = ids.map(() => '?').join(',');

    const file = (
      await query(
        `SELECT file_id, file_path, original_name, mime_type
         FROM portfolio_files
         WHERE file_id=?
           AND student_no IN (${placeholders})
           AND removed_at IS NULL
         LIMIT 1`,
        [fileId, ...ids]
      )
    )[0];
    if (!file) throw notFound('Submission file not found');

    const absolutePath = resolveStoredPath(file.file_path);
    if (!absolutePath || !fs.existsSync(absolutePath)) throw notFound('Submission file not found on disk');

    res.type(file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${String(file.original_name || path.basename(absolutePath)).replace(/"/g, '')}"`);
    res.sendFile(absolutePath);
  } catch (e) {
    if (!e.statusCode) console.error(e);
    res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'Failed to view submission file' });
  }
}

export async function viewSubmissionFileForStaff(req, res) {
  try {
    const fileId = Number(req.params.fileId);
    if (!Number.isInteger(fileId) || fileId <= 0) throw badRequest('Invalid file id');

    const file = (
      await query(
        `SELECT file_id, portfolio_id, file_path, original_name, mime_type
         FROM portfolio_files
         WHERE file_id=?
           AND removed_at IS NULL
         LIMIT 1`,
        [fileId]
      )
    )[0];
    if (!file) throw notFound('Submission file not found');
    if (!file.portfolio_id) {
      if (req.user?.role !== 'admin') throw accessDenied();
    } else if (!(await ensurePortfolioAccess(req, res, Number(file.portfolio_id)))) return;

    const absolutePath = resolveStoredPath(file.file_path);
    if (!absolutePath || !fs.existsSync(absolutePath)) throw notFound('Submission file not found on disk');

    res.type(file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${String(file.original_name || path.basename(absolutePath)).replace(/"/g, '')}"`);
    res.sendFile(absolutePath);
  } catch (e) {
    if (!e.statusCode) console.error(e);
    res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'Failed to view submission file' });
  }
}
