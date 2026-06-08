import { sendDeadlineReminderNotifications } from '../services/assignmentNotificationService.js';

export async function sendDeadlineReminders(req, res) {
  try {
    const summary = await sendDeadlineReminderNotifications();
    res.json({ ok: true, summary });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to send deadline reminder emails' });
  }
}
