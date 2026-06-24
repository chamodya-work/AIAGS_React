export const DEFAULT_COURSES = ['MBBS', 'SHS', 'OT'];

export const DEFAULT_BATCHES_BY_COURSE = {
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

export function normalizeBatch(batch) {
  return String(batch || '').trim();
}

export function getBatchOptionsForCourse(courseName) {
  const normalized = normalizeCourseName(courseName);
  return DEFAULT_BATCHES_BY_COURSE[normalized] || [];
}

export function getAllDefaultBatchOptions() {
  return [...new Set(Object.values(DEFAULT_BATCHES_BY_COURSE).flat())].sort((a, b) => {
    return Number(a) - Number(b);
  });
}

export function isKnownCourse(courseName) {
  return DEFAULT_COURSES.includes(normalizeCourseName(courseName));
}

export function isValidCourseBatch(courseName, batch) {
  const normalizedCourse = normalizeCourseName(courseName);
  const normalizedBatch = normalizeBatch(batch);
  const allowed = DEFAULT_BATCHES_BY_COURSE[normalizedCourse];
  if (!allowed) return false;
  return allowed.includes(normalizedBatch);
}
