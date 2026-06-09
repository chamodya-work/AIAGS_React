import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { pool, query } from '../db.js';
import { requestStudentFeedback } from '../services/mlClient.js';

const feedbackRequestSchema = z.object({
  assignment_id: z.coerce.number().int().positive(),
});

function feedbackMaxAttempts() {
  const raw = String(process.env.AI_FEEDBACK_MAX_ATTEMPTS || '3');
  const parsed = Number(raw.split('#', 1)[0].trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 3;
}

function resolveUploadPath(filePath) {
  if (!filePath) return null;
  return path.resolve(process.cwd(), filePath.replace(/^\/+/, '').replace(/\//g, path.sep));
}

function safeMessage(error) {
  return String(error?.message || error || 'Unknown feedback error');
}

function studentSafeFeedbackError(error) {
  const message = safeMessage(error);

  if (/no rubric|rubric content|rubric file|excel rubric|csv rubric|assignment rubric/i.test(message)) {
    return 'No readable rubric is available for this assignment yet. Please contact your lecturer.';
  }
  if (/no submission|submission file is missing|student submission file|file was not found/i.test(message)) {
    return 'No submission was found for this assignment. Please upload your PDF or DOCX submission first.';
  }
  if (/doc files are not supported/i.test(message)) {
    return 'DOC files are not supported. Please convert the document to DOCX or PDF and upload again.';
  }
  if (/unsupported file type/i.test(message)) {
    return 'Unsupported submission file type. Please upload your assignment submission as PDF or DOCX.';
  }
  if (/pdf text could not be extracted|image-based|scanned/i.test(message)) {
    return 'PDF text could not be extracted. The file may be scanned or image-based. Please upload a text-based PDF or DOCX.';
  }
  if (/docx/i.test(message)) {
    return 'DOCX text could not be extracted. Please check the file and upload a readable DOCX or PDF.';
  }
  if (/restricted|unsafe|score|grade|marks|rubric language/i.test(message)) {
    return 'AI feedback could not be generated safely. Please try again later.';
  }
  if (/ml request failed|ml service|ollama|timeout|econnrefused|connect/i.test(message)) {
    return 'AI feedback service is unavailable. Please try again later.';
  }

  return 'AI feedback could not be generated. Please try again later.';
}

async function getLoggedStudent(userId) {
  return (
    await query(
      `SELECT s.student_no, s.full_name, s.batch, s.course_name, s.department,
              u.email, u.display_name
       FROM students s
       JOIN users u ON u.user_id = s.user_id
       WHERE s.user_id = ?
       LIMIT 1`,
      [userId]
    )
  )[0];
}

async function getFeedbackAttempts(studentNo, assignmentId) {
  const maxAttempts = feedbackMaxAttempts();
  const row = (
    await query(
      `SELECT COUNT(*) AS used_attempts
       FROM student_feedback
       WHERE student_no=? AND assignment_id=?`,
      [studentNo, assignmentId]
    )
  )[0] || { used_attempts: 0 };

  const usedAttempts = Number(row.used_attempts || 0);
  return {
    assignment_id: assignmentId,
    max_attempts: maxAttempts,
    used_attempts: usedAttempts,
    remaining_attempts: Math.max(maxAttempts - usedAttempts, 0),
    can_request: usedAttempts < maxAttempts,
  };
}

function safeFeedbackRow(row) {
  return {
    feedback_id: row.feedback_id,
    assignment_id: row.assignment_id,
    portfolio_id: row.portfolio_id,
    attempt_no: row.attempt_no,
    feedback_text: row.feedback_text,
    feedback_status: row.feedback_status,
    feedback_error: row.feedback_error,
    created_at: row.created_at,
  };
}

async function getFeedbackHistoryRows(studentNo, assignmentId) {
  const rows = await query(
    `SELECT feedback_id, assignment_id, portfolio_id, attempt_no, feedback_text,
            feedback_status, feedback_error, created_at
     FROM student_feedback
     WHERE student_no=? AND assignment_id=?
     ORDER BY attempt_no DESC, created_at DESC`,
    [studentNo, assignmentId]
  );

  return rows.map(safeFeedbackRow);
}

async function getAssignment(assignmentId) {
  return (
    await query(
      `SELECT assignment_id, assignment_name, course_name, batch, department,
              start_date, deadline_date, remark
       FROM assignments
       WHERE assignment_id=?
       LIMIT 1`,
      [assignmentId]
    )
  )[0];
}

async function getLatestStudentPortfolio(student, assignmentId) {
  return (
    await query(
      `SELECT p.portfolio_id, p.student_no, p.portfolio_link, p.upload_date,
              a.assignment_id, a.assignment_name, a.course_name, a.batch, a.department,
              a.start_date, a.deadline_date, a.remark
       FROM portfolios p
       JOIN assignments a ON a.assignment_id = p.assignment_id
       WHERE p.assignment_id=?
         AND p.student_no IN (?, ?)
       ORDER BY p.upload_date DESC, p.portfolio_id DESC
       LIMIT 1`,
      [assignmentId, student.student_no, student.email]
    )
  )[0];
}

async function getLatestRubric(assignmentId) {
  return (
    await query(
      `SELECT *
       FROM rubrics
       WHERE assignment_id=?
       ORDER BY create_date DESC, rubric_id DESC
       LIMIT 1`,
      [assignmentId]
    )
  )[0];
}

function buildFeedbackPayload(portfolio, rubric, portfolioFilePath, rubricFilePath) {
  return {
    portfolio_id: portfolio.portfolio_id,
    assignment: {
      assignment_id: portfolio.assignment_id,
      assignment_name: portfolio.assignment_name,
      course_name: portfolio.course_name,
      batch: portfolio.batch,
      department: portfolio.department,
      start_date: portfolio.start_date,
      deadline_date: portfolio.deadline_date,
      remark: portfolio.remark,
    },
    student: {
      student_no: portfolio.student_no,
    },
    rubric: {
      rubric_id: rubric.rubric_id,
      rubric_name: rubric.rubric_name,
      rubric_text: rubric.rubric_text || rubric.rubric_extracted_text || null,
      file_path: rubricFilePath,
      file_mime: rubric.rubric_file_mime || null,
      file_original_name: rubric.rubric_file_original_name || null,
    },
    submission: {
      portfolio_id: portfolio.portfolio_id,
      file_path: portfolioFilePath,
      portfolio_link: portfolio.portfolio_link,
      uploaded_at: portfolio.upload_date,
    },
  };
}

async function reserveFeedbackAttempt(studentNo, assignmentId, portfolioId) {
  const maxAttempts = feedbackMaxAttempts();
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      `SELECT attempt_no
       FROM student_feedback
       WHERE student_no=? AND assignment_id=?
       ORDER BY attempt_no ASC
       FOR UPDATE`,
      [studentNo, assignmentId]
    );

    const usedAttempts = rows.length;
    const maxAttempt = rows.reduce((max, row) => Math.max(max, Number(row.attempt_no || 0)), 0);

    if (usedAttempts >= maxAttempts) {
      await conn.rollback();
      return {
        blocked: true,
        attempts: {
          assignment_id: assignmentId,
          max_attempts: maxAttempts,
          used_attempts: usedAttempts,
          remaining_attempts: 0,
          can_request: false,
        },
      };
    }

    const attemptNo = maxAttempt + 1;
    const [result] = await conn.execute(
      `INSERT INTO student_feedback
        (student_no, assignment_id, portfolio_id, attempt_no, feedback_status)
       VALUES (?, ?, ?, ?, 'processing')`,
      [studentNo, assignmentId, portfolioId || null, attemptNo]
    );

    await conn.commit();
    return {
      blocked: false,
      feedback_id: result.insertId,
      attempt_no: attemptNo,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function getFeedbackAttemptsForAssignment(req, res) {
  try {
    const assignmentId = Number(req.params.assignmentId);
    if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
      return res.status(400).json({ error: 'Invalid assignment id' });
    }

    const student = await getLoggedStudent(req.user?.user_id);
    if (!student) return res.status(404).json({ error: 'Student profile not found for this account' });

    const attempts = await getFeedbackAttempts(student.student_no, assignmentId);
    return res.json({ attempts });
  } catch (error) {
    console.error('Failed to load student feedback attempts:', safeMessage(error));
    return res.status(500).json({ error: 'Failed to load feedback attempts' });
  }
}

export async function getFeedbackHistoryForAssignment(req, res) {
  try {
    const assignmentId = Number(req.params.assignmentId);
    if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
      return res.status(400).json({ error: 'Invalid assignment id' });
    }

    const student = await getLoggedStudent(req.user?.user_id);
    if (!student) return res.status(404).json({ error: 'Student profile not found for this account' });

    const [attempts, history] = await Promise.all([
      getFeedbackAttempts(student.student_no, assignmentId),
      getFeedbackHistoryRows(student.student_no, assignmentId),
    ]);

    return res.json({ attempts, history });
  } catch (error) {
    console.error('Failed to load student feedback history:', safeMessage(error));
    return res.status(500).json({ error: 'Failed to load feedback history' });
  }
}

export async function requestFeedbackForAssignment(req, res) {
  try {
    const data = feedbackRequestSchema.parse(req.body || {});
    const assignmentId = data.assignment_id;

    const student = await getLoggedStudent(req.user?.user_id);
    if (!student) return res.status(404).json({ error: 'Student profile not found for this account' });

    const assignment = await getAssignment(assignmentId);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    const portfolio = await getLatestStudentPortfolio(student, assignmentId);
    if (!portfolio) {
      return res.status(404).json({
        error: 'No submission was found for this assignment. Please upload your PDF or DOCX submission first.',
      });
    }

    const portfolioFilePath = resolveUploadPath(portfolio.portfolio_link);
    if (!portfolioFilePath || !fs.existsSync(portfolioFilePath)) {
      return res.status(404).json({
        error: 'No submission was found for this assignment. Please upload your PDF or DOCX submission first.',
      });
    }

    const rubric = await getLatestRubric(assignmentId);
    if (!rubric) {
      return res.status(404).json({
        error: 'No rubric is available for this assignment yet. Please contact your lecturer.',
      });
    }

    const rubricFilePath = rubric.rubric_file_path ? resolveUploadPath(rubric.rubric_file_path) : null;
    if (!rubric.rubric_text && (!rubricFilePath || !fs.existsSync(rubricFilePath))) {
      return res.status(404).json({
        error: 'No readable rubric is available for this assignment yet. Please contact your lecturer.',
      });
    }

    const reserved = await reserveFeedbackAttempt(student.student_no, assignmentId, portfolio.portfolio_id);
    if (reserved.blocked) {
      return res.status(429).json({
        error: `You have used all ${reserved.attempts.max_attempts} AI feedback attempts for this assignment.`,
        attempts: reserved.attempts,
      });
    }

    let feedbackRow;
    try {
      const mlResult = await requestStudentFeedback(
        buildFeedbackPayload(portfolio, rubric, portfolioFilePath, rubricFilePath)
      );

      if (mlResult?.status === 'failed' || !String(mlResult?.feedback_text || '').trim()) {
        throw new Error(mlResult?.error || 'AI feedback could not be generated');
      }

      await query(
        `UPDATE student_feedback
         SET feedback_status='completed', feedback_text=?, feedback_error=NULL
         WHERE feedback_id=? AND student_no=?`,
        [mlResult.feedback_text, reserved.feedback_id, student.student_no]
      );
    } catch (error) {
      const friendlyError = studentSafeFeedbackError(error);
      await query(
        `UPDATE student_feedback
         SET feedback_status='failed', feedback_text=NULL, feedback_error=?
         WHERE feedback_id=? AND student_no=?`,
        [friendlyError, reserved.feedback_id, student.student_no]
      );
    }

    feedbackRow = (
      await query(
        `SELECT feedback_id, assignment_id, portfolio_id, attempt_no, feedback_text,
                feedback_status, feedback_error, created_at
         FROM student_feedback
         WHERE feedback_id=? AND student_no=?
         LIMIT 1`,
        [reserved.feedback_id, student.student_no]
      )
    )[0];

    const [attempts, history] = await Promise.all([
      getFeedbackAttempts(student.student_no, assignmentId),
      getFeedbackHistoryRows(student.student_no, assignmentId),
    ]);

    return res.json({
      attempts,
      feedback: safeFeedbackRow(feedbackRow),
      history,
    });
  } catch (error) {
    if (error?.issues) return res.status(400).json({ error: 'Validation error', details: error.issues });
    console.error('Student AI feedback failed:', safeMessage(error));
    return res.status(500).json({ error: 'Failed to generate AI feedback' });
  }
}
