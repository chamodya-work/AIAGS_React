import { z } from 'zod';
import { pool, query } from '../db.js';

const assignSchema = z.object({
  assignment_id: z.coerce.number().int().positive(),
  lecturer_user_id: z.coerce.number().int().positive(),
  portfolio_ids: z.array(z.coerce.number().int().positive()).min(1),
});

const unassignSchema = z.object({
  assignment_id: z.coerce.number().int().positive(),
  portfolio_ids: z.array(z.coerce.number().int().positive()).min(1),
});

function naturalStudentCompare(a, b) {
  const left = String(a.student_no || '');
  const right = String(b.student_no || '');
  const leftParts = left.split(/(\d+)/).filter(Boolean);
  const rightParts = right.split(/(\d+)/).filter(Boolean);
  const max = Math.max(leftParts.length, rightParts.length);

  for (let i = 0; i < max; i += 1) {
    const lp = leftParts[i] || '';
    const rp = rightParts[i] || '';
    const ln = /^\d+$/.test(lp) ? Number(lp) : null;
    const rn = /^\d+$/.test(rp) ? Number(rp) : null;

    if (ln !== null && rn !== null && ln !== rn) return ln - rn;
    if (lp !== rp) return lp.localeCompare(rp);
  }

  return left.localeCompare(right);
}

function submissionStatus(row) {
  const activeFiles = Number(row.active_file_count || 0);
  const missing = Number(row.missing_mandatory_count || 0);
  if (activeFiles === 0) return 'NO FILES';
  return missing > 0 ? 'INCOMPLETE' : 'SUBMITTED';
}

async function ensureLecturer(userId) {
  return (
    await query(
      `SELECT u.user_id, u.role, u.email, u.display_name,
              t.teacher_id, t.full_name, t.department
       FROM users u
       LEFT JOIN teachers t ON t.user_id = u.user_id
       WHERE u.user_id=? AND u.role='teacher'
       LIMIT 1`,
      [userId]
    )
  )[0];
}

async function ensureAssignmentPortfolios(assignmentId, portfolioIds) {
  const uniqueIds = [...new Set(portfolioIds.map(Number))];
  const placeholders = uniqueIds.map(() => '?').join(',');
  const rows = await query(
    `SELECT portfolio_id
     FROM portfolios
     WHERE assignment_id=? AND portfolio_id IN (${placeholders})`,
    [assignmentId, ...uniqueIds]
  );
  const found = new Set(rows.map((row) => Number(row.portfolio_id)));
  const missing = uniqueIds.filter((id) => !found.has(id));
  return { uniqueIds, missing };
}

export async function listLecturers(req, res) {
  try {
    const rows = await query(
      `SELECT u.user_id, u.email, u.display_name,
              t.teacher_id, t.full_name, t.department
       FROM users u
       LEFT JOIN teachers t ON t.user_id = u.user_id
       WHERE u.role='teacher'
       ORDER BY COALESCE(t.full_name, u.display_name, u.email), u.email`
    );

    res.json({
      lecturers: rows.map((row) => ({
        user_id: row.user_id,
        email: row.email,
        display_name: row.display_name,
        teacher_id: row.teacher_id,
        full_name: row.full_name,
        department: row.department,
        label: row.full_name || row.display_name || row.email,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load lecturers' });
  }
}

export async function listAssignmentSubmissions(req, res) {
  try {
    const assignmentId = Number(req.params.assignmentId);
    if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
      return res.status(400).json({ error: 'Invalid assignment id' });
    }

    const rows = await query(
      `SELECT p.portfolio_id, p.student_no, p.upload_date,
              (
                SELECT COUNT(*)
                FROM portfolio_files pf
                WHERE pf.portfolio_id=p.portfolio_id
                  AND pf.removed_at IS NULL
              ) AS active_file_count,
              (
                SELECT COUNT(*)
                FROM assignment_required_documents ard
                WHERE ard.assignment_id=p.assignment_id
                  AND ard.is_mandatory=1
                  AND NOT EXISTS (
                    SELECT 1
                    FROM portfolio_files pf
                    WHERE pf.portfolio_id=p.portfolio_id
                      AND pf.required_document_id=ard.id
                      AND pf.removed_at IS NULL
                  )
              ) AS missing_mandatory_count,
              (
                SELECT pf.file_id
                FROM portfolio_files pf
                WHERE pf.portfolio_id=p.portfolio_id
                  AND pf.removed_at IS NULL
                ORDER BY CASE
                  WHEN LOWER(pf.file_path) LIKE '%.pdf' OR LOWER(pf.file_path) LIKE '%.docx' THEN 0
                  ELSE 1
                END, pf.uploaded_at DESC, pf.file_id DESC
                LIMIT 1
              ) AS primary_file_id,
              lpa.lecturer_user_id, lpa.assigned_at,
              u.email AS lecturer_email, u.display_name AS lecturer_display_name,
              t.teacher_id, t.full_name AS lecturer_full_name
       FROM portfolios p
       LEFT JOIN lecturer_portfolio_assignments lpa ON lpa.portfolio_id = p.portfolio_id
       LEFT JOIN users u ON u.user_id = lpa.lecturer_user_id
       LEFT JOIN teachers t ON t.user_id = u.user_id
       WHERE p.assignment_id=?
       ORDER BY p.upload_date DESC, p.portfolio_id DESC`,
      [assignmentId]
    );

    const submissions = rows
      .map((row) => ({
        portfolio_id: row.portfolio_id,
        student_no: row.student_no,
        upload_date: row.upload_date,
        active_file_count: Number(row.active_file_count || 0),
        missing_mandatory_count: Number(row.missing_mandatory_count || 0),
        submission_status: submissionStatus(row),
        primary_file_id: row.primary_file_id,
        lecturer_user_id: row.lecturer_user_id,
        assigned_at: row.assigned_at,
        assigned_lecturer: row.lecturer_user_id
          ? {
              user_id: row.lecturer_user_id,
              email: row.lecturer_email,
              display_name: row.lecturer_display_name,
              teacher_id: row.teacher_id,
              full_name: row.lecturer_full_name,
              label: row.lecturer_full_name || row.lecturer_display_name || row.lecturer_email,
            }
          : null,
      }))
      .sort(naturalStudentCompare);

    res.json({ assignment_id: assignmentId, submissions });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load assignment submissions' });
  }
}

export async function assignPortfolios(req, res) {
  const conn = await pool.getConnection();
  try {
    const data = assignSchema.parse(req.body);
    const lecturer = await ensureLecturer(data.lecturer_user_id);
    if (!lecturer) return res.status(400).json({ error: 'Selected lecturer was not found' });

    const { uniqueIds, missing } = await ensureAssignmentPortfolios(data.assignment_id, data.portfolio_ids);
    if (missing.length) {
      return res.status(400).json({ error: `Invalid portfolio(s) for this assignment: ${missing.join(', ')}` });
    }

    await conn.beginTransaction();
    for (const portfolioId of uniqueIds) {
      await conn.execute(
        `INSERT INTO lecturer_portfolio_assignments
          (assignment_id, portfolio_id, lecturer_user_id, assigned_by)
         VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE
          assignment_id=VALUES(assignment_id),
          lecturer_user_id=VALUES(lecturer_user_id),
          assigned_by=VALUES(assigned_by),
          assigned_at=CURRENT_TIMESTAMP`,
        [data.assignment_id, portfolioId, data.lecturer_user_id, req.user.user_id]
      );
    }
    await conn.commit();

    res.json({ ok: true, assigned_count: uniqueIds.length });
  } catch (e) {
    await conn.rollback().catch(() => {});
    if (e?.issues) return res.status(400).json({ error: 'Validation error', details: e.issues });
    console.error(e);
    res.status(500).json({ error: 'Failed to assign portfolios' });
  } finally {
    conn.release();
  }
}

export async function unassignPortfolios(req, res) {
  try {
    const data = unassignSchema.parse(req.body);
    const { uniqueIds, missing } = await ensureAssignmentPortfolios(data.assignment_id, data.portfolio_ids);
    if (missing.length) {
      return res.status(400).json({ error: `Invalid portfolio(s) for this assignment: ${missing.join(', ')}` });
    }

    const placeholders = uniqueIds.map(() => '?').join(',');
    const result = await query(
      `DELETE FROM lecturer_portfolio_assignments
       WHERE assignment_id=? AND portfolio_id IN (${placeholders})`,
      [data.assignment_id, ...uniqueIds]
    );

    res.json({ ok: true, unassigned_count: result.affectedRows || 0 });
  } catch (e) {
    if (e?.issues) return res.status(400).json({ error: 'Validation error', details: e.issues });
    console.error(e);
    res.status(500).json({ error: 'Failed to unassign portfolios' });
  }
}

export async function getAssignmentGroups(req, res) {
  try {
    const assignmentId = Number(req.params.assignmentId);
    if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
      return res.status(400).json({ error: 'Invalid assignment id' });
    }

    const rows = await query(
      `SELECT lpa.lecturer_user_id, u.email, u.display_name,
              t.teacher_id, t.full_name, p.portfolio_id, p.student_no
       FROM lecturer_portfolio_assignments lpa
       JOIN portfolios p ON p.portfolio_id = lpa.portfolio_id
       JOIN users u ON u.user_id = lpa.lecturer_user_id
       LEFT JOIN teachers t ON t.user_id = u.user_id
       WHERE lpa.assignment_id=?
       ORDER BY COALESCE(t.full_name, u.display_name, u.email), p.student_no`,
      [assignmentId]
    );

    const groupMap = new Map();
    for (const row of rows) {
      const key = String(row.lecturer_user_id);
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          lecturer: {
            user_id: row.lecturer_user_id,
            email: row.email,
            display_name: row.display_name,
            teacher_id: row.teacher_id,
            full_name: row.full_name,
            label: row.full_name || row.display_name || row.email,
          },
          submissions: [],
        });
      }
      groupMap.get(key).submissions.push({
        portfolio_id: row.portfolio_id,
        student_no: row.student_no,
      });
    }

    const groups = [...groupMap.values()].map((group) => ({
      ...group,
      submissions: group.submissions.sort(naturalStudentCompare),
    }));

    res.json({ assignment_id: assignmentId, groups });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load assignment groups' });
  }
}
