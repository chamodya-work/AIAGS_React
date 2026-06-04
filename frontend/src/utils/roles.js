const ROLE_ALIASES = {
  admin: 'admin',
  head: 'admin',
  hod: 'admin',
  administrator: 'admin',
  teacher: 'teacher',
  lecturer: 'teacher',
  student: 'student',
};

export function normalizeRole(role) {
  return ROLE_ALIASES[String(role || '').toLowerCase()] || role;
}

export function roleLabel(role) {
  const normalized = normalizeRole(role);
  if (normalized === 'teacher') return 'lecturer';
  if (normalized === 'admin') return 'admin/head';
  return normalized || 'user';
}

export function hasRole(user, allowedRoles) {
  const role = normalizeRole(user?.role);
  return allowedRoles.map(normalizeRole).includes(role);
}

export function homeForRole(role) {
  const normalized = normalizeRole(role);
  if (normalized === 'student') return '/student/home';
  if (normalized === 'admin') return '/portfolio/list';
  if (normalized === 'teacher') return '/grading';
  return '/login';
}
