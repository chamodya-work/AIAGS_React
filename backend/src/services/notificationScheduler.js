import cron from 'node-cron';
import { sendDeadlineReminderNotifications } from './assignmentNotificationService.js';

export function startNotificationScheduler() {
  if (String(process.env.ENABLE_EMAIL_CRON || '').toLowerCase() !== 'true') {
    return;
  }

  const schedule = process.env.EMAIL_CRON_SCHEDULE || '0 8 * * *';
  if (!cron.validate(schedule)) {
    console.warn(`Invalid EMAIL_CRON_SCHEDULE "${schedule}". Deadline reminder cron was not started.`);
    return;
  }

  cron.schedule(schedule, async () => {
    try {
      const summary = await sendDeadlineReminderNotifications();
      console.log('Deadline reminder email check completed:', summary);
    } catch (error) {
      console.error('Deadline reminder email check failed:', error.message);
    }
  });

  console.log(`Deadline reminder email cron enabled with schedule "${schedule}".`);
}
