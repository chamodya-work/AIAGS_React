import nodemailer from 'nodemailer';

let cachedTransporter = null;
let warnedMissingConfig = false;

function boolEnv(value) {
  return String(value || '').toLowerCase() === 'true';
}

export function isSmtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_FROM);
}

function getTransporter() {
  if (!isSmtpConfigured()) return null;
  if (cachedTransporter) return cachedTransporter;

  const auth = process.env.SMTP_USER
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
    : undefined;

  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: boolEnv(process.env.SMTP_SECURE),
    auth,
  });

  return cachedTransporter;
}

export async function sendMail({ to, subject, text }) {
  const transporter = getTransporter();
  if (!transporter) {
    if (!warnedMissingConfig) {
      console.warn('SMTP is not configured. Assignment email notifications will be skipped.');
      warnedMissingConfig = true;
    }
    return { status: 'skipped', error: 'SMTP is not configured' };
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    text,
  });

  return { status: 'sent', error: null };
}
