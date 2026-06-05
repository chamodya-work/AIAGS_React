import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { query } from '../db.js';
import { viewSubmissionFileForStaff } from './studentSubmissionController.js';
import { ensurePortfolioAccess, lecturerPortfolioJoin } from '../services/lecturerAccess.js';

const createPortfolioSchema = z.object({
  student_no: z.string().min(1),
  assignment_id: z.coerce.number().int()
});

function publishStatus(row) {
  if (row.publish_status) return row.publish_status;
  return row.status === 'PUBLISHED' ? 'published_to_student' : 'draft';
}

function submissionStatus(row) {
  const activeFiles = Number(row.active_file_count || 0) || (row.portfolio_link ? 1 : 0);
  const missingMandatory = Number(row.missing_mandatory_count || 0);
  if (activeFiles === 0) return 'NO FILES';
  return missingMandatory > 0 ? 'INCOMPLETE' : 'SUBMITTED';
}

function hasManualDraftData(row) {
  return row.manual_score != null
    || row.final_grade != null
    || Boolean(String(row.manual_remark || '').trim())
    || row.saved_by != null;
}

function shouldHideDraftManualData(req, row, rowPublishStatus) {
  return req.user?.role === 'admin'
    && rowPublishStatus === 'draft'
    && hasManualDraftData(row)
    && row.saved_by_role !== 'admin';
}

function portfolioRow(row, req) {
  const rowPublishStatus = publishStatus(row);
  const hideDraft = shouldHideDraftManualData(req, row, rowPublishStatus);
  const visibleManualScore = hideDraft ? null : row.manual_score;
  const visibleFinalGrade = hideDraft ? null : row.final_grade;
  const visibleTeacherScore = hideDraft ? null : (row.manual_score ?? row.final_grade ?? null);
  const visibleRemark = hideDraft ? '' : (row.manual_remark || '');
  const notSubmittedMessage = 'Not submitted by lecturer yet';

  return {
    ...row,
    active_file_count: Number(row.active_file_count || 0) || (row.portfolio_link ? 1 : 0),
    missing_mandatory_count: Number(row.missing_mandatory_count || 0),
    submission_status: submissionStatus(row),
    ai_status: row.ai_status || 'pending',
    final_grade: visibleFinalGrade,
    manual_score: visibleManualScore,
    manual_remark: visibleRemark,
    teacher_score: visibleTeacherScore,
    lecturer_remark: visibleRemark,
    manual_score_display: visibleTeacherScore,
    manual_remark_display: hideDraft ? notSubmittedMessage : visibleRemark,
    manual_draft_hidden: hideDraft,
    head_visibility_status: hideDraft ? 'not_submitted' : rowPublishStatus,
    saved_by: hideDraft ? null : row.saved_by,
    saved_by_role: hideDraft ? null : row.saved_by_role,
    final_published_score: rowPublishStatus === 'published_to_student' ? row.final_grade : null,
    publish_status: rowPublishStatus,
    publish_status_label: rowPublishStatus === 'published_to_student'
      ? 'Published to Student'
      : rowPublishStatus === 'submitted_to_head'
        ? 'Submitted to Head'
        : 'Draft',
    assigned_lecturer: row.lecturer_user_id
      ? {
          user_id: row.lecturer_user_id,
          email: row.lecturer_email,
          display_name: row.lecturer_display_name,
          teacher_id: row.lecturer_teacher_id,
          full_name: row.lecturer_full_name,
          label: row.lecturer_full_name || row.lecturer_display_name || row.lecturer_email,
        }
      : null,
  };
}

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
  const access = lecturerPortfolioJoin(req, 'p');
  let sql = `
    SELECT p.*, a.assignment_name, a.batch, a.course_name, a.department,
           (
             SELECT COUNT(*)
             FROM portfolio_files pf
             WHERE pf.portfolio_id = p.portfolio_id
               AND pf.removed_at IS NULL
           ) AS active_file_count,
           (
             SELECT COUNT(*)
             FROM assignment_required_documents ard
             WHERE ard.assignment_id = p.assignment_id
               AND ard.is_mandatory = 1
               AND NOT EXISTS (
                 SELECT 1
                 FROM portfolio_files pf
                 WHERE pf.portfolio_id = p.portfolio_id
                   AND pf.required_document_id = ard.id
                   AND pf.removed_at IS NULL
               )
           ) AS missing_mandatory_count,
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
           ag.ai_status, ag.ai_grade, ag.ai_grading_error,
           fg.final_grade, fg.manual_score, fg.manual_remark, fg.status, fg.publish_status,
           fg.saved_by, fg.saved_by_role,
           lpa.lecturer_user_id,
           u.email AS lecturer_email,
           u.display_name AS lecturer_display_name,
           t.teacher_id AS lecturer_teacher_id,
           t.full_name AS lecturer_full_name
    FROM portfolios p
    ${access.join}
    JOIN assignments a ON a.assignment_id = p.assignment_id
    LEFT JOIN ai_grading ag ON ag.portfolio_id = p.portfolio_id
    LEFT JOIN final_grading fg ON fg.portfolio_id = p.portfolio_id AND fg.student_no = p.student_no
    LEFT JOIN lecturer_portfolio_assignments lpa ON lpa.portfolio_id = p.portfolio_id
    LEFT JOIN users u ON u.user_id = lpa.lecturer_user_id
    LEFT JOIN teachers t ON t.user_id = u.user_id
    WHERE 1=1
  `;
  params.push(...access.params);
  if (assignment_id) { sql += ' AND p.assignment_id=?'; params.push(Number(assignment_id)); }
  if (batch) { sql += ' AND a.batch=?'; params.push(String(batch)); }
  sql += ' ORDER BY p.upload_date DESC';
  const rows = await query(sql, params);
  res.json({ portfolios: rows.map((row) => portfolioRow(row, req)) });
}

export async function getPortfolio(req, res) {
  const portfolioId = Number(req.params.id);
  if (!(await ensurePortfolioAccess(req, res, portfolioId))) return;

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
