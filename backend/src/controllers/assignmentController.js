import { z } from 'zod';
import { query } from '../db.js';

const assignmentSchema = z.object({
  assignment_name: z.string().min(1),
  batch: z.string().min(1),
  course_name: z.string().min(1),
  department: z.string().optional().nullable(),
  start_date: z.string().optional().nullable(),
  deadline_date: z.string().optional().nullable(),
  remark: z.string().optional().nullable()
});



export async function listAssignments(req, res) {
  try {
    const { course_name, batch } = req.query;

    let sql = `
      SELECT assignment_id, assignment_name, batch, course_name, deadline_date
      FROM assignments
      WHERE 1=1
    `;
    const params = [];

    if (course_name) { sql += " AND course_name = ?"; params.push(course_name); }
    if (batch) { sql += " AND batch = ?"; params.push(batch); }

    sql += " ORDER BY deadline_date DESC, assignment_id DESC";

    const rows = await query(sql, params);   // query() returns rows
    res.json({ assignments: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load assignments" });
  }
}

export async function createAssignment(req, res) {
  try {
    const data = assignmentSchema.parse(req.body);
    const result = await query(
      'INSERT INTO assignments (assignment_name, batch, course_name, department, start_date, deadline_date, remark) VALUES (?,?,?,?,?,?,?)',
      [data.assignment_name, data.batch, data.course_name, data.department || null, data.start_date || null, data.deadline_date || null, data.remark || null]
    );
    const rows = await query('SELECT * FROM assignments WHERE assignment_id=?', [result.insertId]);
    res.status(201).json({ assignment: rows[0] });
  } catch (e) {
    if (e?.issues) return res.status(400).json({ error: 'Validation error', details: e.issues });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function updateAssignment(req, res) {
  try {
    const assignmentId = Number(req.params.id);
    const data = assignmentSchema.partial().parse(req.body);

    const current = (await query('SELECT * FROM assignments WHERE assignment_id=?', [assignmentId]))[0];
    if (!current) return res.status(404).json({ error: 'Not found' });

    const next = { ...current, ...data };
    await query(
      'UPDATE assignments SET assignment_name=?, batch=?, course_name=?, department=?, start_date=?, deadline_date=?, remark=? WHERE assignment_id=?',
      [next.assignment_name, next.batch, next.course_name, next.department, next.start_date, next.deadline_date, next.remark, assignmentId]
    );
    const rows = await query('SELECT * FROM assignments WHERE assignment_id=?', [assignmentId]);
    res.json({ assignment: rows[0] });
  } catch (e) {
    if (e?.issues) return res.status(400).json({ error: 'Validation error', details: e.issues });
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
    const rows = await query('SELECT * FROM assignments WHERE assignment_id=?', [assignmentId]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ assignment: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
}
