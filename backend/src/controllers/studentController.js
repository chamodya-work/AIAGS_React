import { query } from "../db.js";

function toDateOnly(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function computeStatus(deadlineDate, uploadedAt) {
  if (uploadedAt) return "SUBMITTED";
  if (!deadlineDate) return "PENDING";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(deadlineDate);
  due.setHours(0, 0, 0, 0);

  return due < today ? "OVERDUE" : "PENDING";
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
              a.start_date, a.deadline_date, a.remark,
              p.portfolio_id, p.upload_date
       FROM assignments a
       LEFT JOIN portfolios p
         ON p.assignment_id = a.assignment_id
        AND p.student_no = ?
       WHERE (? IS NULL OR ? = '' OR a.batch = ?)
         AND (? IS NULL OR ? = '' OR a.course_name = ?)
         AND (? IS NULL OR ? = '' OR a.department IS NULL OR LOWER(a.department) = LOWER(?))
       ORDER BY a.deadline_date ASC, a.assignment_id DESC`,
      [
        student.student_no,
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

    const normalized = assignments.map((a) => {
      const deadline = toDateOnly(a.deadline_date);
      const uploadDate = a.upload_date ? new Date(a.upload_date).toISOString() : null;
      const status = computeStatus(deadline, uploadDate);
      return {
        assignment_id: a.assignment_id,
        assignment_name: a.assignment_name,
        batch: a.batch,
        course_name: a.course_name,
        department: a.department,
        start_date: toDateOnly(a.start_date),
        deadline_date: deadline,
        remark: a.remark,
        portfolio_id: a.portfolio_id || null,
        upload_date: uploadDate,
        status,
      };
    });

    const summary = normalized.reduce(
      (acc, row) => {
        if (row.status === "SUBMITTED") acc.submitted += 1;
        if (row.status === "PENDING") acc.pending += 1;
        if (row.status === "OVERDUE") acc.overdue += 1;

        if (row.status !== "SUBMITTED" && row.deadline_date) {
          const due = new Date(row.deadline_date);
          due.setHours(0, 0, 0, 0);
          if (due >= today && due <= next7) acc.upcoming_7_days += 1;
        }
        return acc;
      },
      { submitted: 0, pending: 0, overdue: 0, upcoming_7_days: 0 }
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
