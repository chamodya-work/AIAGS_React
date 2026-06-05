import { z } from 'zod';
import { query } from '../db.js';
import { ensurePortfolioAccess, lecturerPortfolioJoin } from '../services/lecturerAccess.js';

const saveManualGradeSchema = z.object({
  manual_score: z.coerce.number().min(0).max(100),
  manual_remark: z.string().max(5000).optional().nullable(),
  confirm_large_difference: z.boolean().optional(),
});

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function publicStatus(row) {
  if (row.publish_status) return row.publish_status;
  return row.status === 'PUBLISHED' ? 'published_to_student' : 'draft';
}

function legacyStatusFromPublishStatus(publishStatus) {
  return publishStatus === 'published_to_student' ? 'PUBLISHED' : 'DRAFT';
}

function manualRow(row) {
  const publishStatus = publicStatus(row);
  return {
    portfolio_id: row.portfolio_id,
    student_no: row.student_no,
    upload_date: row.upload_date,
    portfolio_link: row.portfolio_link,
    primary_file_id: row.primary_file_id,
    ai_status: row.ai_status || 'pending',
    ai_grade: row.ai_grade,
    ai_grading_error: row.ai_grading_error,
    ai_model: row.ai_model,
    teacher_score: row.manual_score ?? row.final_grade ?? null,
    manual_score: row.manual_score,
    final_grade: row.final_grade,
    manual_remark: row.manual_remark || '',
    saved_by: row.saved_by,
    saved_by_role: row.saved_by_role,
    saved_at: row.saved_at,
    publish_status: publishStatus,
    status: legacyStatusFromPublishStatus(publishStatus),
    submitted_to_head_at: row.submitted_to_head_at,
    published_at: row.published_at,
    score_difference_warning: Boolean(row.score_difference_warning),
    score_difference: row.score_difference,
  };
}

function validateAssignmentId(req) {
  const assignmentId = Number(req.params.assignmentId);
  if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
    throw badRequest('Invalid assignment id');
  }
  return assignmentId;
}

async function getPortfolioGradeContext(portfolioId) {
  return (
    await query(
      `SELECT p.portfolio_id, p.student_no, p.assignment_id,
              ag.ai_grade,
              fg.status, fg.publish_status
       FROM portfolios p
       LEFT JOIN ai_grading ag ON ag.portfolio_id = p.portfolio_id
       LEFT JOIN final_grading fg ON fg.portfolio_id = p.portfolio_id AND fg.student_no = p.student_no
       WHERE p.portfolio_id=?
       LIMIT 1`,
      [portfolioId]
    )
  )[0];
}

export async function listManualResultsByAssignment(req, res) {
  try {
    const assignmentId = validateAssignmentId(req);
    const access = lecturerPortfolioJoin(req, 'p');

    const rows = await query(
      `SELECT p.portfolio_id, p.student_no, p.portfolio_link, p.upload_date,
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
              ) AS primary_file_id,
              ag.ai_status, ag.ai_grade, ag.ai_grading_error, ag.ai_model,
              fg.final_grade, fg.manual_score, fg.manual_remark, fg.saved_by,
              fg.saved_by_role, fg.saved_at, fg.status, fg.publish_status,
              fg.submitted_to_head_at, fg.published_at,
              fg.score_difference_warning, fg.score_difference
       FROM portfolios p
       ${access.join}
       LEFT JOIN ai_grading ag ON ag.portfolio_id = p.portfolio_id
       LEFT JOIN final_grading fg ON fg.portfolio_id = p.portfolio_id AND fg.student_no = p.student_no
       WHERE p.assignment_id=?
       ORDER BY p.upload_date DESC, p.portfolio_id DESC`,
      [...access.params, assignmentId]
    );

    res.json({
      assignment_id: assignmentId,
      results: rows.map(manualRow),
    });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Failed to load manual grading results' });
  }
}

export async function saveManualGrade(req, res) {
  try {
    const portfolioId = Number(req.params.portfolioId);
    if (!(await ensurePortfolioAccess(req, res, portfolioId))) return;

    const data = saveManualGradeSchema.parse(req.body || {});
    const context = await getPortfolioGradeContext(portfolioId);
    if (!context) return res.status(404).json({ error: 'Portfolio not found' });
    if (publicStatus(context) === 'published_to_student' && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Published grades can only be changed by admin/head' });
    }

    const aiScore = context.ai_grade == null ? null : Number(context.ai_grade);
    const difference = aiScore == null ? null : Math.abs(Number(data.manual_score) - aiScore);
    const hasLargeDifference = difference != null && difference > 20;

    if (hasLargeDifference && !data.confirm_large_difference) {
      return res.status(409).json({
        error: 'The teacher score differs from the AI score by more than 20 marks. Please confirm before saving.',
        requires_confirmation: true,
        ai_score: aiScore,
        teacher_score: data.manual_score,
        difference,
      });
    }

    const publishStatus = publicStatus(context);
    const legacyStatus = legacyStatusFromPublishStatus(publishStatus);
    const remark = String(data.manual_remark || '').trim() || null;

    await query(
      `INSERT INTO final_grading
        (student_no, portfolio_id, status, final_grade, manual_score, manual_remark,
         saved_by, saved_by_role, saved_at, publish_status, ai_score_at_save,
         score_difference, score_difference_warning)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         status=VALUES(status),
         final_grade=VALUES(final_grade),
         manual_score=VALUES(manual_score),
         manual_remark=VALUES(manual_remark),
         saved_by=VALUES(saved_by),
         saved_by_role=VALUES(saved_by_role),
         saved_at=NOW(),
         publish_status=VALUES(publish_status),
         ai_score_at_save=VALUES(ai_score_at_save),
         score_difference=VALUES(score_difference),
         score_difference_warning=VALUES(score_difference_warning)`,
      [
        context.student_no,
        portfolioId,
        legacyStatus,
        data.manual_score,
        data.manual_score,
        remark,
        req.user.user_id,
        req.user.role,
        publishStatus,
        aiScore,
        difference,
        hasLargeDifference ? 1 : 0,
      ]
    );

    const saved = (
      await query(
        `SELECT fg.*, ag.ai_grade
         FROM final_grading fg
         LEFT JOIN ai_grading ag ON ag.portfolio_id = fg.portfolio_id
         WHERE fg.portfolio_id=? AND fg.student_no=?`,
        [portfolioId, context.student_no]
      )
    )[0];

    res.json({
      ok: true,
      grade: {
        portfolio_id: portfolioId,
        teacher_score: saved.manual_score ?? saved.final_grade,
        manual_remark: saved.manual_remark || '',
        publish_status: publicStatus(saved),
        score_difference_warning: Boolean(saved.score_difference_warning),
        score_difference: saved.score_difference,
      },
    });
  } catch (e) {
    if (e?.issues) return res.status(400).json({ error: 'Validation error', details: e.issues });
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Failed to save manual grade' });
  }
}

export async function submitAssignmentToHead(req, res) {
  try {
    const assignmentId = validateAssignmentId(req);

    const result = await query(
      `UPDATE final_grading fg
       JOIN portfolios p ON p.portfolio_id = fg.portfolio_id
       JOIN lecturer_portfolio_assignments lpa
         ON lpa.portfolio_id = p.portfolio_id
        AND lpa.lecturer_user_id = ?
       SET fg.status='DRAFT',
           fg.publish_status='submitted_to_head',
           fg.submitted_to_head_at=NOW()
       WHERE p.assignment_id=?
         AND fg.final_grade IS NOT NULL
         AND fg.publish_status <> 'published_to_student'`,
      [req.user.user_id, assignmentId]
    );

    res.json({
      ok: true,
      submitted_count: result.affectedRows || 0,
    });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Failed to submit grades to head' });
  }
}

export async function publishAssignmentToStudents(req, res) {
  try {
    const assignmentId = validateAssignmentId(req);

    const result = await query(
      `UPDATE final_grading fg
       JOIN portfolios p ON p.portfolio_id = fg.portfolio_id
       SET fg.status='PUBLISHED',
           fg.publish_status='published_to_student',
           fg.published_by=?,
           fg.published_at=NOW()
       WHERE p.assignment_id=?
         AND fg.final_grade IS NOT NULL`,
      [req.user.user_id, assignmentId]
    );

    res.json({
      ok: true,
      published_count: result.affectedRows || 0,
    });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Failed to publish grades to students' });
  }
}
