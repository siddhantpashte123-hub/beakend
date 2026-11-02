// ─────────────────────────────────────────────────────────────
// BlueBeakend — transactional email (SMTP via nodemailer)
// Falls back to logging + "outbox" settings row when SMTP is
// unconfigured, so password-reset flows always work in dev.
// ─────────────────────────────────────────────────────────────
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('mailer');

let transporter = null;
function getTransporter() {
  if (config.smtp.host) {
    if (!transporter) {
      transporter = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.port === 465,
        auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      });
    }
    return transporter;
  }
  return null;
}

/**
 * Send an email. Returns { delivered, messageId?, preview? }.
 * Without SMTP configured the message is logged and stashed in the
 * outbox (exposed via admin API for testing the flow end-to-end).
 */
export async function sendMail({ to, subject, text, html }) {
  const t = getTransporter();
  if (t) {
    try {
      const info = await t.sendMail({ from: config.smtp.from, to, subject, text, html });
      log.info(`mail sent to ${to}: ${subject}`);
      return { delivered: true, messageId: info.messageId };
    } catch (err) {
      log.error(`mail send failed: ${err.message}`);
      return { delivered: false, error: err.message };
    }
  }
  const preview = { to, subject, text, ts: new Date().toISOString() };
  log.info(`[outbox] no SMTP configured — mail to ${to} captured: ${subject}`);
  outbox.push(preview);
  if (outbox.length > 100) outbox.shift();
  return { delivered: false, preview };
}

export const outbox = [];
