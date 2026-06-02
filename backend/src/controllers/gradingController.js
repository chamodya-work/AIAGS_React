import path from 'path';
import { query } from '../db.js';
import { gradePortfolio } from '../services/mlClient.js';
import { z } from 'zod';
import fs from "fs";


const finalSchema = z.object({
  final_grade: z.coerce.number().min(0).max(100),
  status: z.enum(['DRAFT', 'PUBLISHED']).optional()
});

export async function gradeOne(req, res) {
  try {
    const portfolioId = Number(req.params.id);
    const pRows = await query('SELECT p.portfolio_id, p.portfolio_link, p.assignment_id FROM portfolios p WHERE p.portfolio_id=?', [portfolioId]);
    const portfolio = pRows[0];
    if (!portfolio) return res.status(404).json({ error: 'Portfolio not found' });

    const rubricRows = await query('SELECT rubric_text FROM rubrics WHERE assignment_id=? ORDER BY create_date DESC LIMIT 1', [portfolio.assignment_id]);
    const rubricText = rubricRows[0]?.rubric_text || null;

    const absFilePath = path.resolve(process.cwd(), portfolio.portfolio_link.replace(/^\//, ''));

    // ✅ FILE CHECK
    if (!fs.existsSync(absFilePath)) {
      throw new Error(`Portfolio file not found at: ${absFilePath}`);
    }

    const result = await gradePortfolio({
      portfolioId,
      filePath: absFilePath,
      rubricText
    });

    await query(
      'INSERT INTO ai_grading (portfolio_id, ai_grade, ai_review_report) VALUES (?,?,?) ON DUPLICATE KEY UPDATE ai_grade=VALUES(ai_grade), ai_review_report=VALUES(ai_review_report), graded_at=CURRENT_TIMESTAMP',
      [portfolioId, result.ai_grade ?? null, result.ai_review_report ?? null]
    );

    const out = (await query('SELECT * FROM ai_grading WHERE portfolio_id=?', [portfolioId]))[0];
    res.json({ ai: out });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Grading failed', details: String(e?.message || e) });
  }
}

export async function gradeAssignment(req, res) {
  const assignmentId = Number(req.params.assignmentId);
  const portfolios = await query('SELECT portfolio_id FROM portfolios WHERE assignment_id=?', [assignmentId]);
  const results = [];
  for (const p of portfolios) {
    // grade sequentially to keep it simple and avoid overloading the ML service
    // (you can parallelize later)
    try {
      const fakeReq = { params: { id: p.portfolio_id } };
      // reuse gradeOne logic by calling directly is messy; do simple call
      const pRows = await query('SELECT portfolio_id, portfolio_link, assignment_id FROM portfolios WHERE portfolio_id=?', [p.portfolio_id]);
      const portfolio = pRows[0];
      if (!portfolio) continue;

      const rubricRows = await query('SELECT rubric_text FROM rubrics WHERE assignment_id=? ORDER BY create_date DESC LIMIT 1', [portfolio.assignment_id]);
      const rubricText = rubricRows[0]?.rubric_text || null;
      const absFilePath = path.resolve(process.cwd(), portfolio.portfolio_link.replace(/^\//, ''));

      // ✅ FILE CHECK
      if (!fs.existsSync(absFilePath)) {
        throw new Error(`Portfolio file not found at: ${absFilePath}`);
      }

      const result = await gradePortfolio({
        portfolioId: portfolio.portfolio_id,
        filePath: absFilePath,
        rubricText
      });

      await query(
        'INSERT INTO ai_grading (portfolio_id, ai_grade, ai_review_report) VALUES (?,?,?) ON DUPLICATE KEY UPDATE ai_grade=VALUES(ai_grade), ai_review_report=VALUES(ai_review_report), graded_at=CURRENT_TIMESTAMP',
        [portfolio.portfolio_id, result.ai_grade ?? null, result.ai_review_report ?? null]
      );

      results.push({ portfolio_id: portfolio.portfolio_id, ok: true });
    } catch (e) {
      results.push({ portfolio_id: p.portfolio_id, ok: false, error: String(e?.message || e) });
    }
  }
  res.json({ assignment_id: assignmentId, results });
}

export async function setFinalGrade(req, res) {
  try {
    const portfolioId = Number(req.params.id);
    const data = finalSchema.parse(req.body);

    const p = (await query('SELECT portfolio_id, student_no FROM portfolios WHERE portfolio_id=?', [portfolioId]))[0];
    if (!p) return res.status(404).json({ error: 'Portfolio not found' });

    await query(
      'INSERT INTO final_grading (student_no, portfolio_id, status, final_grade) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status), final_grade=VALUES(final_grade)',
      [p.student_no, portfolioId, data.status || 'DRAFT', data.final_grade]
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
  const rows = await query(
    `
    SELECT p.portfolio_id, p.student_no, p.portfolio_link, p.upload_date,
           ag.ai_grade, ag.ai_review_report,
           fg.final_grade, fg.status
    FROM portfolios p
    LEFT JOIN ai_grading ag ON ag.portfolio_id = p.portfolio_id
    LEFT JOIN final_grading fg ON fg.portfolio_id = p.portfolio_id AND fg.student_no = p.student_no
    WHERE p.assignment_id=?
    ORDER BY p.upload_date DESC
    `,
    [assignmentId]
  );
  res.json({ results: rows });
}

export async function publishAssignmentGrades(req, res) {
  const assignmentId = Number(req.params.assignmentId);
  await query(
    `
    UPDATE final_grading fg
    JOIN portfolios p ON p.portfolio_id = fg.portfolio_id
    SET fg.status='PUBLISHED'
    WHERE p.assignment_id=?
    `,
    [assignmentId]
  );
  res.json({ ok: true });
}
