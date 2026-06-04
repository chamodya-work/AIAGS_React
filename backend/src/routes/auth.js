import { Router } from 'express';
import { login, createUser, me, studentHomeAccess } from '../controllers/authController.js';
import { normalizeRole, requireAuth, requireRole, roleLabel } from '../middleware/auth.js';
import { query } from '../db.js';

const router = Router();

router.post('/login', login);
router.get('/me', requireAuth, me);
router.get('/student-home', requireAuth, requireRole('student'), studentHomeAccess);

// User management (admin only)
router.post('/users', requireAuth, requireRole('admin'), createUser);

router.get('/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const rows = await query(
      `SELECT u.user_id, u.role, u.email, u.display_name, u.created_at,
              s.student_no, s.full_name, s.batch, s.course_name
       FROM users u
       LEFT JOIN students s ON s.user_id = u.user_id
       ORDER BY u.created_at DESC`
    );
    res.json({
      users: rows.map((row) => ({
        ...row,
        role: normalizeRole(row.role),
        role_label: roleLabel(row.role),
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (userId === req.user.user_id) return res.status(400).json({ error: 'Cannot delete yourself' });
    await query('DELETE FROM users WHERE user_id=?', [userId]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const { display_name, role } = req.body;
    const normalizedRole = normalizeRole(role);
    if (!['admin', 'teacher', 'student'].includes(normalizedRole)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    await query('UPDATE users SET display_name=?, role=? WHERE user_id=?', [display_name || null, normalizedRole, userId]);
    const rows = await query('SELECT user_id, role, email, display_name FROM users WHERE user_id=?', [userId]);
    res.json({
      user: rows[0]
        ? { ...rows[0], role: normalizeRole(rows[0].role), role_label: roleLabel(rows[0].role) }
        : null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
