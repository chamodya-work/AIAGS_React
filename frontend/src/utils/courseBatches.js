export const COURSE_OPTIONS = ['MBBS', 'SHS', 'OT'];

const BATCH_OPTIONS_BY_COURSE = {
  MBBS: rangeStrings(30, 45),
  SHS: rangeStrings(10, 20),
  OT: rangeStrings(10, 20),
};

function rangeStrings(start, end) {
  const values = [];
  for (let value = start; value <= end; value += 1) {
    values.push(String(value));
  }
  return values;
}

export function normalizeCourseName(courseName) {
  return String(courseName || '').trim().toUpperCase();
}

export function getBatchOptionsForCourse(courseName) {
  return BATCH_OPTIONS_BY_COURSE[normalizeCourseName(courseName)] || [];
}

export function getAllBatchOptions() {
  return [...new Set(Object.values(BATCH_OPTIONS_BY_COURSE).flat())].sort((a, b) => Number(a) - Number(b));
}

export function isBatchValidForCourse(courseName, batch) {
  return getBatchOptionsForCourse(courseName).includes(String(batch || '').trim());
}
