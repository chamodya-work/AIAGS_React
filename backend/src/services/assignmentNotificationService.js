import { query } from '../db.js';
import { sendMail } from './emailService.js';

const NOTIFICATION_TYPES = {
  created: 'created',
  reminder: 'deadline_reminder',
};

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function timeOnly(value) {
  if (!value) return '23:59';
  return String(value).slice(0, 5);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + days);
  return next;
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateTime(dateValue, timeValue) {
  const date = dateOnly(dateValue);
  if (!date) return '-';
  return `${date} ${timeOnly(timeValue)}`;
}

function appLoginText() {
  return process.env.APP_BASE_URL
    ? `Login to AIAGS: ${process.env.APP_BASE_URL}`
    : 'Please login to AIAGS.';
}

async function getAssignment(assignmentId) {
  return (
    await query(
      `SELECT assignment_id, assignment_name, course_name, department, batch,
              start_date, start_time, deadline_date, deadline_time
       FROM assignments
       WHERE assignment_id=?
       LIMIT 1`,
      [assignmentId]
    )
  )[0] || null;
}

async function getRelevantStudents(assignment) {
  return query(
    `SELECT s.student_no, s.full_name, s.batch, s.course_name, s.department,
            u.email, u.display_name
     FROM students s
     LEFT JOIN users u ON u.user_id = s.user_id
     WHERE (u.role IS NULL OR u.role = 'student')
       AND (s.batch IS NULL OR s.batch = '' OR s.batch = ?)
       AND (s.course_name IS NULL OR s.course_name = '' OR s.course_name = ?)
       AND (
         s.department IS NULL
         OR s.department = ''
         OR ? IS NULL
         OR ? = ''
         OR LOWER(s.department) = LOWER(?)
       )
     ORDER BY s.student_no ASC`,
    [
      assignment.batch,
      assignment.course_name,
      assignment.department,
      assignment.department,
      assignment.department,
    ]
  );
}

async function createNotificationLog(assignmentId, student, type) {
  await query(
    `INSERT IGNORE INTO assignment_notifications
      (assignment_id, student_no, email, notification_type, status)
     VALUES (?,?,?,?,?)`,
    [assignmentId, student.student_no, student.email || '', type, 'pending']
  );

  return (
    await query(
      `SELECT notification_id, status
       FROM assignment_notifications
       WHERE assignment_id=? AND student_no=? AND notification_type=?
       LIMIT 1`,
      [assignmentId, student.student_no, type]
    )
  )[0];
}

async function updateNotificationLog(notificationId, status, error = null) {
  await query(
    `UPDATE assignment_notifications
     SET status=?, error=?, sent_at=CASE WHEN ?='sent' THEN NOW() ELSE sent_at END
     WHERE notification_id=?`,
    [status, error, status, notificationId]
  );
}

function createdSubject(assignment) {
  return `New Assignment Created: ${assignment.assignment_name}`;
}

function reminderSubject(assignment) {
  return `Reminder: Assignment Deadline Approaching - ${assignment.assignment_name}`;
}

function createdBody(assignment, student) {
  return [
    `Dear ${student.full_name || student.display_name || 'Student'},`,
    '',
    'A new assignment has been created in AIAGS.',
    '',
    `Assignment: ${assignment.assignment_name}`,
    `Course: ${assignment.course_name || '-'}`,
    `Department: ${assignment.department || '-'}`,
    `Batch: ${assignment.batch || '-'}`,
    `Start: ${formatDateTime(assignment.start_date, assignment.start_time)}`,
    `Deadline: ${formatDateTime(assignment.deadline_date, assignment.deadline_time)}`,
    '',
    'Please login to AIAGS and upload the required documents before the deadline.',
    appLoginText(),
    '',
    'This is an automated message.',
  ].join('\n');
}

function reminderBody(assignment, student) {
  return [
    `Dear ${student.full_name || student.display_name || 'Student'},`,
    '',
    'This is a reminder that the deadline for the following assignment is approaching.',
    '',
    `Assignment: ${assignment.assignment_name}`,
    `Deadline: ${formatDateTime(assignment.deadline_date, assignment.deadline_time)}`,
    '',
    'Please submit your required documents before the deadline.',
    appLoginText(),
    '',
    'This is an automated message.',
  ].join('\n');
}

async function sendAssignmentNotification({ assignment, student, type }) {
  const log = await createNotificationLog(assignment.assignment_id, student, type);
  if (!log) return { status: 'failed', error: 'Notification log could not be created' };

  if (log.status === 'sent') {
    return { status: 'skipped', error: 'Notification already sent' };
  }

  if (!student.email) {
    await updateNotificationLog(log.notification_id, 'skipped', 'Student email is missing');
    return { status: 'skipped', error: 'Student email is missing' };
  }

  try {
    const result = await sendMail({
      to: student.email,
      subject: type === NOTIFICATION_TYPES.created ? createdSubject(assignment) : reminderSubject(assignment),
      text: type === NOTIFICATION_TYPES.created ? createdBody(assignment, student) : reminderBody(assignment, student),
    });

    await updateNotificationLog(log.notification_id, result.status, result.error);
    return result;
  } catch (error) {
    const message = String(error?.message || error || 'Email send failed');
    await updateNotificationLog(log.notification_id, 'failed', message);
    return { status: 'failed', error: message };
  }
}

function emptySummary() {
  return { total: 0, sent: 0, failed: 0, skipped: 0 };
}

function addToSummary(summary, result) {
  summary.total += 1;
  if (result.status === 'sent') summary.sent += 1;
  else if (result.status === 'failed') summary.failed += 1;
  else summary.skipped += 1;
}

export async function sendAssignmentCreatedNotifications(assignmentId) {
  const assignment = await getAssignment(assignmentId);
  if (!assignment) return { ...emptySummary(), error: 'Assignment not found' };

  const students = await getRelevantStudents(assignment);
  const summary = emptySummary();

  for (const student of students) {
    const result = await sendAssignmentNotification({
      assignment,
      student,
      type: NOTIFICATION_TYPES.created,
    });
    addToSummary(summary, result);
  }

  return summary;
}

export async function sendDeadlineReminderNotifications({ now = new Date(), daysBefore } = {}) {
  const reminderDays = Number(daysBefore ?? process.env.DEADLINE_REMINDER_DAYS ?? 3);
  const targetDate = dateKey(addDays(now, Number.isFinite(reminderDays) ? reminderDays : 3));
  const assignments = await query(
    `SELECT assignment_id, assignment_name, course_name, department, batch,
            start_date, start_time, deadline_date, deadline_time
     FROM assignments
     WHERE deadline_date = ?
     ORDER BY deadline_time ASC, assignment_id ASC`,
    [targetDate]
  );

  const summary = { ...emptySummary(), target_date: targetDate, assignments: assignments.length };

  for (const assignment of assignments) {
    const students = await getRelevantStudents(assignment);
    for (const student of students) {
      const result = await sendAssignmentNotification({
        assignment,
        student,
        type: NOTIFICATION_TYPES.reminder,
      });
      addToSummary(summary, result);
    }
  }

  return summary;
}
