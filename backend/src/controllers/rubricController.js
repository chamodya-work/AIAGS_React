import { z } from 'zod';
import { query } from '../db.js';
import fs from 'fs';
import path from 'path';
import { normalizeCourseName } from '../services/courseBatchService.js';

const rubricSchema = z.object({
  rubric_name: z.string().min(1),
  assignment_id: z.number().int(),
  rubric_text: z.string().optional().nullable()
});

const rubricUploadSchema = z.object({
  rubric_name: z.string().optional().nullable(),
  assignment_id: z.number().int(),
});

function canAccessRubricRow(req, rubric) {
  if (req.user?.role === 'admin') return true;
  if (req.user?.role !== 'teacher') return false;
  return Number(rubric.created_by || 0) === Number(req.user.user_id || 0)
    || Number(rubric.lecturer_assignment_access || 0) > 0;
}

function canDeleteRubricRow(req, rubric) {
  if (req.user?.role === 'admin') return true;
  if (req.user?.role !== 'teacher') return false;
  return Number(rubric.created_by || 0) === Number(req.user.user_id || 0);
}

function safeRubric(row, req) {
  const originalName = row.rubric_file_original_name || row.rubric_name || '';
  const extension = path.extname(originalName).replace('.', '').toUpperCase();

  return {
    rubric_id: row.rubric_id,
    rubric_name: row.rubric_name,
    rubric_file_original_name: row.rubric_file_original_name,
    rubric_file_mime: row.rubric_file_mime,
    file_type: extension || row.rubric_file_mime || (row.rubric_file_path ? 'File' : 'Text'),
    create_date: row.create_date,
    assignment_id: row.assignment_id,
    assignment_name: row.assignment_name,
    course_name: row.course_name,
    department: row.department,
    batch: row.batch,
    has_file: Boolean(row.rubric_file_path),
    created_by: row.created_by,
    can_delete: canDeleteRubricRow(req, row),
  };
}

function rubricListSql(req, extraWhere = '') {
  const params = [];
  let accessWhere = '';

  if (req.user?.role === 'teacher') {
    accessWhere = `
      AND (
        r.created_by = ?
        OR EXISTS (
          SELECT 1
          FROM lecturer_portfolio_assignments lpa
          WHERE lpa.assignment_id = r.assignment_id
            AND lpa.lecturer_user_id = ?
        )
      )
    `;
    params.push(req.user.user_id, req.user.user_id);
  }

  return {
    sql: `
      SELECT r.*, a.assignment_name, a.course_name, a.department, a.batch,
             CASE WHEN EXISTS (
               SELECT 1
               FROM lecturer_portfolio_assignments lpa
               WHERE lpa.assignment_id = r.assignment_id
                 AND lpa.lecturer_user_id = ?
             ) THEN 1 ELSE 0 END AS lecturer_assignment_access
      FROM rubrics r
      JOIN assignments a ON a.assignment_id = r.assignment_id
      WHERE 1=1
      ${accessWhere}
      ${extraWhere}
    `,
    params: [req.user?.user_id || 0, ...params],
  };
}

export async function listRubrics(req, res) {
  try {
    const { assignment_id, course_name, batch } = req.query;
    const where = [];
    const filterParams = [];

    if (assignment_id) {
      where.push('AND r.assignment_id = ?');
      filterParams.push(Number(assignment_id));
    }
    if (course_name) {
      where.push('AND UPPER(a.course_name) = ?');
      filterParams.push(normalizeCourseName(course_name));
    }
    if (batch) {
      where.push('AND a.batch = ?');
      filterParams.push(String(batch));
    }

    const base = rubricListSql(req, where.join('\n'));
    const rows = await query(
      `${base.sql} ORDER BY r.create_date DESC, r.rubric_id DESC`,
      [...base.params, ...filterParams]
    );

    res.json({ rubrics: rows.map((row) => safeRubric(row, req)) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load rubrics' });
  }
}

export async function getRubricByAssignment(req, res) {
  const assignmentId = Number(req.params.assignmentId);

  const base = rubricListSql(req, 'AND r.assignment_id = ?');
  const rows = await query(
    `${base.sql} ORDER BY r.rubric_id DESC`,
    [...base.params, assignmentId]
  );

  res.json({ rubrics: rows.map((row) => safeRubric(row, req)) });
}


export async function createRubric(req, res) {
  try {
    const body = { ...req.body, assignment_id: Number(req.body.assignment_id) };
    const data = rubricSchema.parse(body);

    const result = await query(
      'INSERT INTO rubrics (rubric_name, assignment_id, rubric_text, created_by) VALUES (?,?,?,?)',
      [data.rubric_name, data.assignment_id, data.rubric_text || null, req.user?.user_id || null]
    );

    const rows = await query('SELECT * FROM rubrics WHERE rubric_id=?', [result.insertId]);
    res.status(201).json({ rubric: rows[0] });
  } catch (e) {
    if (e?.issues) return res.status(400).json({ error: 'Validation error', details: e.issues });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
}

// ✅ NEW: Upload rubric file + insert record
export async function uploadRubric(req, res) {
  try {
    const assignment_id = Number(req.body.assignment_id);
    const rubric_name = req.body.rubric_name;

    const data = rubricUploadSchema.parse({
      assignment_id,
      rubric_name: rubric_name ?? null,
    });

    if (!req.file) {
      return res.status(400).json({ error: 'file is required (field name: file)' });
    }

    const filePath = `/uploads/rubrics/${req.file.filename}`;

    const finalRubricName = (data.rubric_name && data.rubric_name.trim())
      ? data.rubric_name.trim()
      : req.file.originalname;

    const result = await query(
      `INSERT INTO rubrics
        (rubric_name, assignment_id, rubric_text, rubric_file_path, rubric_file_original_name, rubric_file_mime, created_by)
       VALUES (?,?,?,?,?,?,?)`,
      [
        finalRubricName,
        data.assignment_id,
        null,
        filePath,
        req.file.originalname,
        req.file.mimetype,
        req.user?.user_id || null,
      ]
    );

    const rows = await query('SELECT * FROM rubrics WHERE rubric_id=?', [result.insertId]);
    res.status(201).json({ rubric: rows[0] });
  } catch (e) {
    if (e?.issues) return res.status(400).json({ error: 'Validation error', details: e.issues });
    console.error(e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
}

export async function deleteRubric(req, res) {
  try {
    const rubricId = Number(req.params.rubricId);
    if (!Number.isInteger(rubricId) || rubricId <= 0) {
      return res.status(400).json({ error: 'Invalid rubric id' });
    }

    const rows = await query(
      `SELECT r.*, a.assignment_name, a.course_name, a.department, a.batch,
              CASE WHEN EXISTS (
                SELECT 1
                FROM lecturer_portfolio_assignments lpa
                WHERE lpa.assignment_id = r.assignment_id
                  AND lpa.lecturer_user_id = ?
              ) THEN 1 ELSE 0 END AS lecturer_assignment_access
       FROM rubrics r
       JOIN assignments a ON a.assignment_id = r.assignment_id
       WHERE r.rubric_id=?`,
      [req.user?.user_id || 0, rubricId]
    );
    const rubric = rows[0];
    if (!rubric) return res.status(404).json({ error: 'Rubric not found' });
    if (!canDeleteRubricRow(req, rubric)) return res.status(403).json({ error: 'Access denied' });

    await query('DELETE FROM rubrics WHERE rubric_id=?', [rubricId]);

    if (rubric.rubric_file_path) {
      const relativePath = rubric.rubric_file_path.replace(/^\/+/, '').replace(/\//g, path.sep);
      const absolutePath = path.join(process.cwd(), relativePath);

      if (fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath);
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function getRubricFile(req, res) {
  try {
    const rubricId = Number(req.params.rubricId);
    if (!Number.isInteger(rubricId) || rubricId <= 0) {
      return res.status(400).json({ error: 'Invalid rubric id' });
    }

    const rows = await query(
      `SELECT r.*, a.assignment_name, a.course_name, a.department, a.batch,
              CASE WHEN EXISTS (
                SELECT 1
                FROM lecturer_portfolio_assignments lpa
                WHERE lpa.assignment_id = r.assignment_id
                  AND lpa.lecturer_user_id = ?
              ) THEN 1 ELSE 0 END AS lecturer_assignment_access
       FROM rubrics r
       JOIN assignments a ON a.assignment_id = r.assignment_id
       WHERE r.rubric_id=?`,
      [req.user?.user_id || 0, rubricId]
    );
    const rubric = rows[0];
    if (!rubric?.rubric_file_path) return res.status(404).json({ error: 'Rubric file not found' });
    if (!canAccessRubricRow(req, rubric)) return res.status(403).json({ error: 'Access denied' });

    const relativePath = rubric.rubric_file_path.replace(/^\/+/, '').replace(/\//g, path.sep);
    const absolutePath = path.join(process.cwd(), relativePath);

    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: 'Rubric file not found on disk' });
    }

    res.type(rubric.rubric_file_mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${String(rubric.rubric_file_original_name || path.basename(absolutePath)).replace(/"/g, '')}"`);
    res.sendFile(absolutePath);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
}
