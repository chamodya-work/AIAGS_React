import { query } from "../db.js";

function toDateOnly(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function computeStatus(deadlineDate, deadlineTime, uploadedAt) {
  if (uploadedAt) return "SUBMITTED";
  if (!deadlineDate) return "PENDING";

  const now = new Date();
  const due = deadlineTime
    ? new Date(`${deadlineDate}T${String(deadlineTime).slice(0, 8)}`)
    : new Date(deadlineDate);

  if (!deadlineTime) {
    now.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
  }

  return due < now ? "OVERDUE" : "PENDING";
}

async function getSubmissionSummary(student, assignmentId) {
  const identifiers = [student.student_no, student.email].filter(Boolean);
  if (!identifiers.length) {
    return { active_files: 0, is_complete: false, missing_mandatory_count: 0 };
  }

  const placeholders = identifiers.map(() => "?").join(",");
  const [activeRow, mandatoryRows] = await Promise.all([
    query(
      `SELECT COUNT(*) AS active_files
       FROM portfolio_files
       WHERE assignment_id=?
         AND student_no IN (${placeholders})
         AND removed_at IS NULL`,
      [assignmentId, ...identifiers]
    ),
    query(
      `SELECT ard.id
       FROM assignment_required_documents ard
       WHERE ard.assignment_id=?
         AND ard.is_mandatory=1
         AND NOT EXISTS (
           SELECT 1
           FROM portfolio_files pf
           WHERE pf.assignment_id=ard.assignment_id
             AND pf.required_document_id=ard.id
             AND pf.student_no IN (${placeholders})
             AND pf.removed_at IS NULL
         )`,
      [assignmentId, ...identifiers]
    ),
  ]);

  const activeFiles = Number(activeRow[0]?.active_files || 0);
  const missingMandatoryCount = mandatoryRows.length;
  return {
    active_files: activeFiles,
    is_complete: activeFiles > 0 && missingMandatoryCount === 0,
    missing_mandatory_count: missingMandatoryCount,
  };
}

export async function getMyDashboard(req, res) {
  try {
    const userId = req.user?.user_id;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    const student = (
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

    if (!student) {
      return res.status(404).json({ error: "Student profile not found for this account" });
    }

    const assignments = await query(
      `SELECT a.assignment_id, a.assignment_name, a.batch, a.course_name, a.department,
              a.start_date, a.start_time, a.deadline_date, a.deadline_time, a.remark,
              p.portfolio_id, p.upload_date, p.portfolio_link
       FROM assignments a
       LEFT JOIN (
         SELECT p1.assignment_id, p1.portfolio_id, p1.upload_date, p1.portfolio_link
         FROM portfolios p1
         JOIN (
           SELECT assignment_id, MAX(portfolio_id) AS portfolio_id
           FROM portfolios
           WHERE student_no IN (?, ?)
           GROUP BY assignment_id
         ) latest ON latest.portfolio_id = p1.portfolio_id
       ) p ON p.assignment_id = a.assignment_id
       WHERE (? IS NULL OR ? = '' OR a.batch = ?)
         AND (? IS NULL OR ? = '' OR a.course_name = ?)
         AND (? IS NULL OR ? = '' OR a.department IS NULL OR LOWER(a.department) = LOWER(?))
       ORDER BY a.deadline_date ASC, a.assignment_id DESC`,
      [
        student.student_no,
        student.email,
        student.batch,
        student.batch,
        student.batch,
        student.course_name,
        student.course_name,
        student.course_name,
        student.department,
        student.department,
        student.department,
      ]
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const next7 = new Date(today);
    next7.setDate(next7.getDate() + 7);

    const normalized = await Promise.all(assignments.map(async (a) => {
      const deadline = toDateOnly(a.deadline_date);
      const uploadDate = a.upload_date ? new Date(a.upload_date).toISOString() : null;
      const submissionSummary = await getSubmissionSummary(student, a.assignment_id);
      const baseStatus = computeStatus(deadline, a.deadline_time, submissionSummary.active_files > 0 ? uploadDate : null);
      const status = submissionSummary.active_files > 0
        ? (submissionSummary.is_complete ? "SUBMITTED" : "INCOMPLETE")
        : baseStatus;
      return {
        assignment_id: a.assignment_id,
        assignment_name: a.assignment_name,
        batch: a.batch,
        course_name: a.course_name,
        department: a.department,
        start_date: toDateOnly(a.start_date),
        start_time: a.start_time || null,
        deadline_date: deadline,
        deadline_time: a.deadline_time || null,
        remark: a.remark,
        portfolio_id: a.portfolio_id || null,
        has_submission: submissionSummary.active_files > 0,
        submission_complete: submissionSummary.is_complete,
        active_file_count: submissionSummary.active_files,
        missing_mandatory_count: submissionSummary.missing_mandatory_count,
        upload_date: uploadDate,
        status,
      };
    }));

    const summary = normalized.reduce(
      (acc, row) => {
        if (row.status === "SUBMITTED") acc.submitted += 1;
        if (row.status === "INCOMPLETE") acc.incomplete += 1;
        if (row.status === "PENDING") acc.pending += 1;
        if (row.status === "OVERDUE") acc.overdue += 1;

        if (row.status !== "SUBMITTED" && row.deadline_date) {
          const due = new Date(row.deadline_date);
          due.setHours(0, 0, 0, 0);
          if (due >= today && due <= next7) acc.upcoming_7_days += 1;
        }
        return acc;
      },
      { submitted: 0, incomplete: 0, pending: 0, overdue: 0, upcoming_7_days: 0 }
    );

    return res.json({
      student: {
        student_no: student.student_no,
        full_name: student.full_name || student.display_name || null,
        email: student.email,
        batch: student.batch,
        course_name: student.course_name,
        department: student.department,
      },
      summary,
      assignments: normalized,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to load student dashboard" });
  }
}

export async function getMyResult(req, res) {
  try {
    const userId = req.user?.user_id;
    const assignmentId = Number(req.params.assignmentId);

    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
      return res.status(400).json({ error: "Invalid assignment id" });
    }

    const student = (
      await query(
        `SELECT s.student_no, u.email
         FROM students s
         JOIN users u ON u.user_id = s.user_id
         WHERE s.user_id = ?
         LIMIT 1`,
        [userId]
      )
    )[0];

    if (!student) {
      return res.status(404).json({ error: "Student profile not found for this account" });
    }

    const rows = await query(
      `SELECT p.portfolio_id, p.student_no, p.upload_date,
              a.assignment_id, a.assignment_name, a.course_name, a.batch,
              fg.final_grade, fg.manual_remark, fg.publish_status
       FROM portfolios p
       JOIN assignments a ON a.assignment_id = p.assignment_id
       JOIN final_grading fg ON fg.portfolio_id = p.portfolio_id AND fg.student_no = p.student_no
       WHERE p.assignment_id = ?
         AND p.student_no IN (?, ?)
         AND fg.publish_status = 'published_to_student'
       ORDER BY p.upload_date DESC
       LIMIT 1`,
      [assignmentId, student.student_no, student.email]
    );

    if (!rows[0]) {
      return res.json({ released: false, result: null });
    }

    return res.json({
      released: true,
      result: {
        portfolio_id: rows[0].portfolio_id,
        assignment_id: rows[0].assignment_id,
        assignment_name: rows[0].assignment_name,
        course_name: rows[0].course_name,
        batch: rows[0].batch,
        upload_date: rows[0].upload_date,
        final_grade: rows[0].final_grade,
        student_no: student.student_no,
        remark: rows[0].manual_remark || null,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to load student result" });
  }
}
