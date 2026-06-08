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

const distributeSchema = z.object({
  assignment_id: z.coerce.number().int().positive(),
  mode: z.enum(['random', 'equal']),
  lecturer_user_ids: z.array(z.coerce.number().int().positive()).min(1),
  portfolio_ids: z.array(z.coerce.number().int().positive()).optional().default([]),
  use_all_filtered: z.coerce.boolean().optional().default(false),
  include_assigned: z.coerce.boolean().optional().default(false),
}).superRefine((data, ctx) => {
  if (data.mode === 'equal' && data.lecturer_user_ids.length < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['lecturer_user_ids'],
      message: 'Equal distribution requires at least two lecturers.',
    });
  }

  if (!data.use_all_filtered && data.portfolio_ids.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['portfolio_ids'],
      message: 'Select at least one student submission or use all unassigned students.',
    });
  }
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

async function ensureAssignment(assignmentId) {
  return (
    await query(
      'SELECT assignment_id FROM assignments WHERE assignment_id=? LIMIT 1',
      [assignmentId]
    )
  )[0];
}

async function ensureLecturers(userIds) {
  const uniqueIds = [...new Set(userIds.map(Number))];
  const placeholders = uniqueIds.map(() => '?').join(',');
  const rows = await query(
    `SELECT u.user_id, u.email, u.display_name,
            t.teacher_id, t.full_name, t.department
     FROM users u
     LEFT JOIN teachers t ON t.user_id = u.user_id
     WHERE u.role='teacher' AND u.user_id IN (${placeholders})`,
    uniqueIds
  );

  const found = new Set(rows.map((row) => Number(row.user_id)));
  return {
    uniqueIds,
    lecturers: rows.map((row) => ({
      user_id: row.user_id,
      email: row.email,
      display_name: row.display_name,
      teacher_id: row.teacher_id,
      full_name: row.full_name,
      department: row.department,
      label: row.full_name || row.display_name || row.email,
    })),
    missing: uniqueIds.filter((id) => !found.has(id)),
  };
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

async function loadDistributionPortfolios({ assignmentId, portfolioIds, useAllFiltered }) {
  const params = [assignmentId];
  let idClause = '';

  if (!useAllFiltered) {
    const uniqueIds = [...new Set(portfolioIds.map(Number))];
    const placeholders = uniqueIds.map(() => '?').join(',');
    idClause = `AND p.portfolio_id IN (${placeholders})`;
    params.push(...uniqueIds);
  }

  return query(
    `SELECT p.portfolio_id, p.student_no, p.upload_date, lpa.lecturer_user_id
     FROM portfolios p
     LEFT JOIN lecturer_portfolio_assignments lpa ON lpa.portfolio_id = p.portfolio_id
     WHERE p.assignment_id=?
       ${idClause}
     ORDER BY p.student_no ASC, p.portfolio_id ASC`,
    params
  );
}

function shuffleRows(rows) {
  const next = [...rows];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function distributeRandom(rows, lecturers) {
  const shuffled = shuffleRows(rows);
  return shuffled.map((row, index) => ({
    portfolio: row,
    lecturer: lecturers[index % lecturers.length],
  }));
}

function distributeEqual(rows, lecturers) {
  const sortedRows = [...rows].sort(naturalStudentCompare);
  const assignments = [];
  const base = Math.floor(sortedRows.length / lecturers.length);
  const remainder = sortedRows.length % lecturers.length;
  let cursor = 0;

  lecturers.forEach((lecturer, index) => {
    const count = base + (index < remainder ? 1 : 0);
    const chunk = sortedRows.slice(cursor, cursor + count);
    chunk.forEach((row) => assignments.push({ portfolio: row, lecturer }));
    cursor += count;
  });

  return assignments;
}

function buildDistributionGroups(assignments, lecturers) {
  const map = new Map();
  lecturers.forEach((lecturer) => {
    map.set(Number(lecturer.user_id), {
      lecturer,
      assigned_count: 0,
      submissions: [],
    });
  });

  assignments.forEach(({ portfolio, lecturer }) => {
    const group = map.get(Number(lecturer.user_id));
    if (!group) return;
    group.assigned_count += 1;
    group.submissions.push({
      portfolio_id: portfolio.portfolio_id,
      student_no: portfolio.student_no,
    });
  });

  return [...map.values()].map((group) => ({
    ...group,
    submissions: group.submissions.sort(naturalStudentCompare),
  }));
}

async function countUnassignedForAssignment(assignmentId) {
  const rows = await query(
    `SELECT COUNT(*) AS total
     FROM portfolios p
     LEFT JOIN lecturer_portfolio_assignments lpa ON lpa.portfolio_id = p.portfolio_id
     WHERE p.assignment_id=? AND lpa.portfolio_id IS NULL`,
    [assignmentId]
  );
  return Number(rows[0]?.total || 0);
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

export async function distributePortfolios(req, res) {
  const conn = await pool.getConnection();
  try {
    const data = distributeSchema.parse(req.body);
    const assignment = await ensureAssignment(data.assignment_id);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    const lecturerData = await ensureLecturers(data.lecturer_user_ids);
    if (lecturerData.missing.length) {
      return res.status(400).json({ error: `Invalid lecturer(s): ${lecturerData.missing.join(', ')}` });
    }

    if (!data.use_all_filtered) {
      const { missing } = await ensureAssignmentPortfolios(data.assignment_id, data.portfolio_ids);
      if (missing.length) {
        return res.status(400).json({ error: `Invalid portfolio(s) for this assignment: ${missing.join(', ')}` });
      }
    }

    const requestedPortfolios = await loadDistributionPortfolios({
      assignmentId: data.assignment_id,
      portfolioIds: data.portfolio_ids,
      useAllFiltered: data.use_all_filtered,
    });

    const targetPortfolios = data.include_assigned
      ? requestedPortfolios
      : requestedPortfolios.filter((row) => !row.lecturer_user_id);
    const skippedAssignedCount = requestedPortfolios.length - targetPortfolios.length;

    const plannedAssignments = data.mode === 'random'
      ? distributeRandom(targetPortfolios, lecturerData.lecturers)
      : distributeEqual(targetPortfolios, lecturerData.lecturers);

    await conn.beginTransaction();
    for (const item of plannedAssignments) {
      await conn.execute(
        `INSERT INTO lecturer_portfolio_assignments
          (assignment_id, portfolio_id, lecturer_user_id, assigned_by)
         VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE
          assignment_id=VALUES(assignment_id),
          lecturer_user_id=VALUES(lecturer_user_id),
          assigned_by=VALUES(assigned_by),
          assigned_at=CURRENT_TIMESTAMP`,
        [
          data.assignment_id,
          item.portfolio.portfolio_id,
          item.lecturer.user_id,
          req.user.user_id,
        ]
      );
    }
    await conn.commit();

    const unassignedRemaining = await countUnassignedForAssignment(data.assignment_id);

    res.json({
      ok: true,
      mode: data.mode,
      assignment_id: data.assignment_id,
      requested_count: requestedPortfolios.length,
      assigned_count: plannedAssignments.length,
      skipped_count: skippedAssignedCount,
      skipped_assigned_count: skippedAssignedCount,
      unassigned_remaining: unassignedRemaining,
      groups: buildDistributionGroups(plannedAssignments, lecturerData.lecturers),
    });
  } catch (e) {
    await conn.rollback().catch(() => {});
    if (e?.issues) return res.status(400).json({ error: 'Validation error', details: e.issues });
    console.error(e);
    res.status(500).json({ error: 'Failed to distribute portfolios' });
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
      assigned_count: group.submissions.length,
      submissions: group.submissions.sort(naturalStudentCompare),
    }));

    const unassigned_remaining = await countUnassignedForAssignment(assignmentId);
    res.json({ assignment_id: assignmentId, groups, unassigned_remaining });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load assignment groups' });
  }
}
