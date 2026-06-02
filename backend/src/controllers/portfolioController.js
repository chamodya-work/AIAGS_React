import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { query } from '../db.js';

const createPortfolioSchema = z.object({
  student_no: z.string().min(1),
  assignment_id: z.coerce.number().int()
});

export async function uploadPortfolio(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const meta = createPortfolioSchema.parse(req.body);

    // ensure student exists (create on the fly if not present)
    const student = (await query('SELECT student_no FROM students WHERE student_no=?', [meta.student_no]))[0];
    if (!student) {
      await query('INSERT INTO students (student_no) VALUES (?)', [meta.student_no]);
    }

    const relativePath = path.posix.join('uploads', req.file.filename);

    const result = await query(
      'INSERT INTO portfolios (student_no, assignment_id, portfolio_link) VALUES (?,?,?)',
      [meta.student_no, meta.assignment_id, `/${relativePath}`]
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
    SELECT p.*, a.assignment_name, a.batch, a.course_name
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
    SELECT p.*, a.assignment_name, a.batch, a.course_name
    FROM portfolios p
    JOIN assignments a ON a.assignment_id = p.assignment_id
    WHERE p.portfolio_id=?
    `,
    [portfolioId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json({ portfolio: rows[0] });
}

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
