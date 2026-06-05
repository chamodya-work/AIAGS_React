import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { query } from '../db.js';
import { viewSubmissionFileForStaff } from './studentSubmissionController.js';

const createPortfolioSchema = z.object({
  student_no: z.string().min(1),
  assignment_id: z.coerce.number().int()
});

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
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const meta = createPortfolioSchema.parse(req.body);
    const studentNo = await resolveUploadStudentNo(req, meta.student_no);

    // ensure student exists (create on the fly if not present)
    const student = (await query('SELECT student_no FROM students WHERE student_no=?', [studentNo]))[0];
    if (!student) {
      await query('INSERT INTO students (student_no) VALUES (?)', [studentNo]);
    }

    const relativePath = path.posix.join('uploads', req.file.filename);

    const result = await query(
      'INSERT INTO portfolios (student_no, assignment_id, portfolio_link) VALUES (?,?,?)',
      [studentNo, meta.assignment_id, `/${relativePath}`]
    );

    const rows = await query('SELECT * FROM portfolios WHERE portfolio_id=?', [result.insertId]);
    res.status(201).json({ portfolio: rows[0] });
  } catch (e) {
    if (e?.issues) return res.status(400).json({ error: 'Validation error', details: e.issues });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function listPortfolios(req, res) {
  const { assignment_id, batch } = req.query;
  const params = [];
  let sql = `
    SELECT p.*, a.assignment_name, a.batch, a.course_name,
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
           ) AS primary_file_id
    FROM portfolios p
    JOIN assignments a ON a.assignment_id = p.assignment_id
    WHERE 1=1
  `;
  if (assignment_id) { sql += ' AND p.assignment_id=?'; params.push(Number(assignment_id)); }
  if (batch) { sql += ' AND a.batch=?'; params.push(String(batch)); }
  sql += ' ORDER BY p.upload_date DESC';
  const rows = await query(sql, params);
  res.json({ portfolios: rows });
}

export async function getPortfolio(req, res) {
  const portfolioId = Number(req.params.id);
  const rows = await query(
    `
    SELECT p.*, a.assignment_name, a.batch, a.course_name,
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
  const rows = await query('SELECT portfolio_link FROM portfolios WHERE portfolio_id=?', [portfolioId]);
  if (rows[0]) {
    const p = rows[0].portfolio_link;
    if (p && p.startsWith('/uploads/')) {
      const filePath = path.resolve(process.cwd(), p.replace(/^\//, ''));
      await fs.unlink(filePath).catch(() => {});
    }
  }
  await query('DELETE FROM portfolios WHERE portfolio_id=?', [portfolioId]);
  res.json({ ok: true });
}
