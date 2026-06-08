import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { sendDeadlineReminders } from '../controllers/notificationController.js';

const router = Router();

router.post('/send-deadline-reminders', requireAuth, requireRole('admin'), sendDeadlineReminders);

export default router;
