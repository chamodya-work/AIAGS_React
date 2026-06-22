import { cleanText } from './utils.js';

export function roleLabel(role) {
  if (role === 'teacher') return 'lecturer';
  if (role === 'admin') return 'admin/head';
  return role || 'user';
}

export function mapCourseName(course) {
  const value = cleanText(course);
  if (!value) return '';
  const normalized = value.toLowerCase();
  if (normalized === 'mbbs' || normalized.includes('bachelor of medicine, bachelor of surgery')) {
    return 'MBBS';
  }
  return value;
}

export function mapCourseNameFromStudentNumber(studentNumber, apiCourse) {
  const prefix = cleanText(studentNumber).split('/')[0]?.toUpperCase() || '';
  const byPrefix = {
    ME: 'MBBS',
    OT: 'OT',
    SH: 'SHS',
  };

  if (byPrefix[prefix]) return byPrefix[prefix];

  const mappedApiCourse = mapCourseName(apiCourse);
  if (mappedApiCourse) return mappedApiCourse;

  return prefix || 'Unknown';
}

export function mapStaffRole(raw = {}) {
  const position = cleanText(raw?.role?.position || raw?.position).toLowerCase();
  const posId = cleanText(raw?.role?.pos_id || raw?.pos_id);

  if (posId === '1' || posId === '2') return 'admin';
  if (position.includes('dean') || position.includes('head')) return 'admin';
  return 'teacher';
}
