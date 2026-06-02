import { z } from 'zod';
import { query } from '../db.js';

const rubricSchema = z.object({
  rubric_name: z.string().min(1),
  assignment_id: z.number().int(),
  rubric_text: z.string().optional().nullable()
});

const rubricUploadSchema = z.object({
  rubric_name: z.string().optional().nullable(),
  assignment_id: z.number().int(),
});

export async function getRubricByAssignment(req, res) {
  const assignmentId = Number(req.params.assignmentId);

  const rows = await query(
    'SELECT * FROM rubrics WHERE assignment_id=? ORDER BY rubric_id DESC',
    [assignmentId]
  );

  res.json({ rubrics: rows });
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
