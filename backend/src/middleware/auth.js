import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

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

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'change_me');
    req.user = {
      ...payload,
      role: normalizeRole(payload.role),
      role_label: payload.role_label || roleLabel(payload.role),
    };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export function requireRole(...roles) {
  const allowedRoles = roles.map(normalizeRole);

  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!allowedRoles.includes(normalizeRole(req.user.role))) {
      return res.status(403).json({
        error: 'Access denied',
        required_roles: roles.map(roleLabel),
      });
    }
    next();
  };
}
