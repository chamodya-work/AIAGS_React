import fs from 'fs';
import path from 'path';
import { pool, query } from '../db.js';

const REQUIRED_DOC_TYPES = new Set([
  'pdf',
  'docx',
  'pdf_or_docx',
  'image',
  'excel',
  'any_supported_document',
]);

const EDITABLE_FIELDS = new Set([
  'assignment_name',
  'remark',
  'start_date',
  'start_time',
  'deadline_date',
  'deadline_time',
  'due_time',
]);

const FORBIDDEN_EDIT_FIELDS = [
  'course_name',
  'department',
  'batch',
  'required_documents',
  'rubric_file',
  'rubric_id',
  'rubric_name',
  'guideline_file',
  'guideline_file_path',
  'guideline_file_original_name',
];

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function text(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function nullableText(value) {
  const valueText = text(value);
  return valueText || null;
}

function normalizeDate(value, label) {
  const valueText = nullableText(value);
  if (!valueText) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valueText)) {
    throw badRequest(`${label} must be a valid date.`);
  }
  return valueText;
}

function normalizeTime(value, label) {
  const valueText = nullableText(value);
  if (!valueText) return null;
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(valueText)) {
    throw badRequest(`${label} must be a valid time.`);
  }
  return valueText.length === 5 ? `${valueText}:00` : valueText;
}

function normalizeRequiredDocType(value) {
  const raw = text(value);
  if (!raw) return 'pdf_or_docx';

  const normalized = raw
    .toLowerCase()
    .replace(/\s+or\s+/g, '_or_')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!REQUIRED_DOC_TYPES.has(normalized)) {
    throw badRequest('Invalid allowed file type in required document table.');
  }

  return normalized;
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  const valueText = text(value).toLowerCase();
  return !['false', '0', 'optional', 'no'].includes(valueText);
}

function parseRequiredDocuments(input) {
  if (!input) return [];

  let rows = input;
  if (typeof input === 'string') {
    try {
      rows = JSON.parse(input);
    } catch {
      throw badRequest('Required document table data is invalid.');
    }
  }

  if (!Array.isArray(rows)) {
    throw badRequest('Required document table must be an array.');
  }

  return rows
    .map((row) => ({
      document_name: text(row?.document_name),
      allowed_file_type: normalizeRequiredDocType(row?.allowed_file_type),
      is_mandatory: normalizeBoolean(row?.is_mandatory),
    }))
    .filter((row) => row.document_name)
    .map((row) => {
      if (row.document_name.length > 255) {
        throw badRequest('Required document name must be 255 characters or fewer.');
      }
      return row;
    });
}

function parseCreatePayload(body) {
  const data = {
    assignment_name: text(body.assignment_name),
    batch: text(body.batch),
    course_name: text(body.course_name),
    department: nullableText(body.department),
    start_date: normalizeDate(body.start_date, 'Start date'),
    start_time: normalizeTime(body.start_time, 'Start time'),
    deadline_date: normalizeDate(body.deadline_date, 'Due date'),
    deadline_time: normalizeTime(body.deadline_time ?? body.due_time, 'Due time'),
    remark: nullableText(body.remark),
  };

  if (!data.course_name) throw badRequest('Course is required.');
  if (!data.batch) throw badRequest('Batch is required.');
  if (!data.assignment_name) throw badRequest('Assignment name is required.');

  return data;
}

function parseUpdatePayload(body) {
  const forbidden = FORBIDDEN_EDIT_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(body, field));
  if (forbidden.length) {
    throw badRequest('Only assignment name, remark, start date/time, and due date/time can be edited.');
  }

  const data = {};
  for (const field of Object.keys(body)) {
    if (!EDITABLE_FIELDS.has(field)) {
      throw badRequest(`Field "${field}" cannot be edited for an existing assignment.`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'assignment_name')) {
    data.assignment_name = text(body.assignment_name);
    if (!data.assignment_name) throw badRequest('Assignment name is required.');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'remark')) data.remark = nullableText(body.remark);
  if (Object.prototype.hasOwnProperty.call(body, 'start_date')) data.start_date = normalizeDate(body.start_date, 'Start date');
  if (Object.prototype.hasOwnProperty.call(body, 'start_time')) data.start_time = normalizeTime(body.start_time, 'Start time');
  if (Object.prototype.hasOwnProperty.call(body, 'deadline_date')) data.deadline_date = normalizeDate(body.deadline_date, 'Due date');
  if (Object.prototype.hasOwnProperty.call(body, 'deadline_time') || Object.prototype.hasOwnProperty.call(body, 'due_time')) {
    data.deadline_time = normalizeTime(body.deadline_time ?? body.due_time, 'Due time');
  }

  return data;
}

function uploadPath(folder, file) {
  return file ? `/uploads/${folder}/${file.filename}` : null;
}

function getUploadedFile(req, fieldName) {
  return req.files?.[fieldName]?.[0] || null;
}

function cleanupUploadedFiles(req) {
  const files = [
    getUploadedFile(req, 'guideline_file'),
    getUploadedFile(req, 'rubric_file'),
  ].filter(Boolean);

  for (const file of files) {
    if (file.path) {
      try {
        fs.unlinkSync(file.path);
      } catch {
        // Best-effort cleanup only; the original error is more useful to return.
      }
    }
  }
}

function resolveUploadPath(filePath) {
  if (!filePath) return null;
  return path.resolve(process.cwd(), filePath.replace(/^\/+/, '').replace(/\//g, path.sep));
}

function safeAssignment(row) {
  if (!row) return row;
  const { guideline_file_path, ...safe } = row;
  return {
    ...safe,
    has_guideline: Boolean(row.guideline_file_path || row.has_guideline),
  };
}

async function getRequiredDocuments(assignmentId) {
  return query(
    `SELECT id, assignment_id, document_name, allowed_file_type, is_mandatory, created_at, updated_at
     FROM assignment_required_documents
     WHERE assignment_id=?
     ORDER BY id ASC`,
    [assignmentId]
  );
}

async function getStudentProfile(userId) {
  return (
    await query(
      'SELECT student_no, batch, course_name, department FROM students WHERE user_id=? LIMIT 1',
      [userId]
    )
  )[0];
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

export async function listAssignments(req, res) {
  try {
    const { course_name, batch } = req.query;

    let sql = `
      SELECT assignment_id, assignment_name, batch, course_name, department,
             start_date, start_time, deadline_date, deadline_time, remark,
             guideline_file_original_name, guideline_file_mime, guideline_file_size,
             CASE WHEN guideline_file_path IS NULL THEN 0 ELSE 1 END AS has_guideline
      FROM assignments
      WHERE 1=1
    `;
    const params = [];

    if (course_name) { sql += ' AND course_name = ?'; params.push(course_name); }
    if (batch) { sql += ' AND batch = ?'; params.push(batch); }

    if (req.user?.role === 'student') {
      const student = await getStudentProfile(req.user.user_id);
      if (!student) return res.status(404).json({ error: 'Student profile not found' });

      if (student.batch) { sql += ' AND batch = ?'; params.push(student.batch); }
      if (student.course_name) { sql += ' AND course_name = ?'; params.push(student.course_name); }
      if (student.department) {
        sql += ' AND (department IS NULL OR LOWER(department) = LOWER(?))';
        params.push(student.department);
      }
    }

    sql += ' ORDER BY deadline_date DESC, deadline_time DESC, assignment_id DESC';

    const rows = await query(sql, params);
    res.json({ assignments: rows.map(safeAssignment) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load assignments' });
  }
}

export async function createAssignment(req, res) {
  let conn;
  try {
    const data = parseCreatePayload(req.body);
    const requiredDocuments = parseRequiredDocuments(req.body.required_documents);
    const guidelineFile = getUploadedFile(req, 'guideline_file');
    const rubricFile = getUploadedFile(req, 'rubric_file');

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [result] = await conn.execute(
      `INSERT INTO assignments
        (assignment_name, batch, course_name, department, start_date, start_time,
         deadline_date, deadline_time, guideline_file_path, guideline_file_original_name,
         guideline_file_mime, guideline_file_size, remark)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        data.assignment_name,
        data.batch,
        data.course_name,
        data.department,
        data.start_date,
        data.start_time,
        data.deadline_date,
        data.deadline_time,
        uploadPath('guidelines', guidelineFile),
        guidelineFile?.originalname || null,
        guidelineFile?.mimetype || null,
        guidelineFile?.size || null,
        data.remark,
      ]
    );

    const assignmentId = result.insertId;

    for (const doc of requiredDocuments) {
      await conn.execute(
        `INSERT INTO assignment_required_documents
          (assignment_id, document_name, allowed_file_type, is_mandatory)
         VALUES (?,?,?,?)`,
        [assignmentId, doc.document_name, doc.allowed_file_type, doc.is_mandatory ? 1 : 0]
      );
    }

    if (rubricFile) {
      await conn.execute(
        `INSERT INTO rubrics
          (rubric_name, assignment_id, rubric_text, rubric_file_path, rubric_file_original_name,
           rubric_file_mime, created_by)
         VALUES (?,?,?,?,?,?,?)`,
        [
          rubricFile.originalname || `${data.assignment_name} rubric`,
          assignmentId,
          null,
          uploadPath('rubrics', rubricFile),
          rubricFile.originalname || null,
          rubricFile.mimetype || null,
          req.user?.user_id || null,
        ]
      );
    }

    await conn.commit();
    const rows = await query('SELECT * FROM assignments WHERE assignment_id=?', [assignmentId]);
    const savedRequiredDocuments = await getRequiredDocuments(assignmentId);

    res.status(201).json({
      assignment: {
        ...safeAssignment(rows[0]),
        required_documents: savedRequiredDocuments,
      },
    });
  } catch (e) {
    if (conn) await conn.rollback().catch(() => {});
    cleanupUploadedFiles(req);

    if (e?.statusCode === 400) return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (conn) conn.release();
  }
}

export async function updateAssignment(req, res) {
  try {
    const assignmentId = Number(req.params.id);
    if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
      return res.status(400).json({ error: 'Invalid assignment id' });
    }

    const data = parseUpdatePayload(req.body);
    const current = (await query('SELECT * FROM assignments WHERE assignment_id=?', [assignmentId]))[0];
    if (!current) return res.status(404).json({ error: 'Not found' });

    const next = {
      assignment_name: data.assignment_name ?? current.assignment_name,
      remark: Object.prototype.hasOwnProperty.call(data, 'remark') ? data.remark : current.remark,
      start_date: Object.prototype.hasOwnProperty.call(data, 'start_date') ? data.start_date : current.start_date,
      start_time: Object.prototype.hasOwnProperty.call(data, 'start_time') ? data.start_time : current.start_time,
      deadline_date: Object.prototype.hasOwnProperty.call(data, 'deadline_date') ? data.deadline_date : current.deadline_date,
      deadline_time: Object.prototype.hasOwnProperty.call(data, 'deadline_time') ? data.deadline_time : current.deadline_time,
    };

    await query(
      `UPDATE assignments
       SET assignment_name=?, remark=?, start_date=?, start_time=?, deadline_date=?, deadline_time=?
       WHERE assignment_id=?`,
      [
        next.assignment_name,
        next.remark,
        next.start_date,
        next.start_time,
        next.deadline_date,
        next.deadline_time,
        assignmentId,
      ]
    );

    const rows = await query('SELECT * FROM assignments WHERE assignment_id=?', [assignmentId]);
    const requiredDocuments = await getRequiredDocuments(assignmentId);
    res.json({ assignment: { ...safeAssignment(rows[0]), required_documents: requiredDocuments } });
  } catch (e) {
    if (e?.statusCode === 400) return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function deleteAssignment(req, res) {
  const assignmentId = Number(req.params.id);
  await query('DELETE FROM assignments WHERE assignment_id=?', [assignmentId]);
  res.json({ ok: true });
}

export async function getAssignment(req, res) {
  try {
    const assignmentId = Number(req.params.id);
    if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
      return res.status(400).json({ error: 'Invalid assignment id' });
    }

    const rows = await query('SELECT * FROM assignments WHERE assignment_id=?', [assignmentId]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });

    if (req.user?.role === 'student') {
      const student = await getStudentProfile(req.user.user_id);
      if (!matchesStudentProfile(rows[0], student)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const requiredDocuments = await getRequiredDocuments(assignmentId);
    res.json({ assignment: { ...safeAssignment(rows[0]), required_documents: requiredDocuments } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function getAssignmentGuideline(req, res) {
  try {
    const assignmentId = Number(req.params.id);
    if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
      return res.status(400).json({ error: 'Invalid assignment id' });
    }

    const assignment = (await query('SELECT * FROM assignments WHERE assignment_id=?', [assignmentId]))[0];
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    if (req.user?.role === 'student') {
      const student = await getStudentProfile(req.user.user_id);
      if (!matchesStudentProfile(assignment, student)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } else if (!['admin', 'teacher'].includes(req.user?.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!assignment.guideline_file_path) {
      return res.status(404).json({ error: 'Guideline document not found' });
    }

    const absolutePath = resolveUploadPath(assignment.guideline_file_path);
    const guidelineRoot = path.resolve(process.cwd(), 'uploads', 'guidelines');
    if (!absolutePath || !absolutePath.startsWith(guidelineRoot) || !fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: 'Guideline document not found on disk' });
    }

    const filename = (assignment.guideline_file_original_name || path.basename(absolutePath)).replace(/"/g, '');
    res.type(assignment.guideline_file_mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.sendFile(absolutePath);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
}
