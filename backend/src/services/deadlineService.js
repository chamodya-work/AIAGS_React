export const DEADLINE_PASSED_MESSAGE = 'The submission deadline has passed. You can no longer upload or edit this assignment.';

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function normalizeTime(value) {
  if (!value) return '23:59:59';
  const text = String(value).trim();
  if (/^\d{2}:\d{2}$/.test(text)) return `${text}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(text)) return text;
  return '23:59:59';
}

export function assignmentDeadlineAt(assignment) {
  const deadlineDate = dateOnly(assignment?.deadline_date);
  if (!deadlineDate) return null;
  return new Date(`${deadlineDate}T${normalizeTime(assignment?.deadline_time)}`);
}

export function getDeadlineInfo(assignment, now = new Date()) {
  const deadlineAt = assignmentDeadlineAt(assignment);
  const isClosed = deadlineAt ? now > deadlineAt : false;

  return {
    deadline_at: deadlineAt ? deadlineAt.toISOString() : null,
    submission_open: !isClosed,
    deadline_status: isClosed ? 'Closed' : 'Open',
  };
}

export function assertSubmissionOpen(assignment) {
  if (!getDeadlineInfo(assignment).submission_open) {
    const error = new Error(DEADLINE_PASSED_MESSAGE);
    error.statusCode = 403;
    throw error;
  }
}
