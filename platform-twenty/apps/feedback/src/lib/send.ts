import { createHmac } from 'node:crypto';

import nodemailer from 'nodemailer';

import { cachedForRun, metadata } from 'src/lib/api';
import { type FeedbackSettings } from 'src/lib/settings';

// Public pages live on the workspace's own address: <workspace URL>/s/...
export const publicBaseUrl = cachedForRun(async () => {
  const { currentWorkspace } = await metadata<{ currentWorkspace: { workspaceUrls: { customUrl: string | null; subdomainUrl: string } } }>(
    `{ currentWorkspace { workspaceUrls { customUrl subdomainUrl } } }`,
  );
  return `${(currentWorkspace.workspaceUrls.customUrl || currentWorkspace.workspaceUrls.subdomainUrl).replace(/\/$/, '')}/s`;
});

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

export const toE164 = (phones: { primaryPhoneNumber: string | null; primaryPhoneCallingCode: string | null } | null | undefined): string | null => {
  const number = (phones?.primaryPhoneNumber ?? '').replace(/[^\d+]/g, '');
  if (!number) return null;
  if (number.startsWith('+')) return number;
  const callingCode = (phones?.primaryPhoneCallingCode || '+44').replace(/[^\d+]/g, '');
  return `${callingCode.startsWith('+') ? callingCode : `+${callingCode}`}${number.replace(/^0+/, '')}`;
};

const business = (settings: FeedbackSettings) => settings.businessName?.trim() || 'Our team';

export const buildSurveyEmail = ({ firstName, url, settings }: { firstName: string; url: string; settings: FeedbackSettings }) => {
  const question = settings.question?.trim() || 'How likely are you to recommend us to a friend or colleague?';
  const subject = `How did we do? ${business(settings)} would like your feedback`;
  const scale = Array.from({ length: 11 }, (_, score) => score);
  const text = [`Hello ${firstName},`, '', question, 'Choose a score from 0 (not at all likely) to 10 (extremely likely):', url, '', `Thank you,`, business(settings)].join('\n');
  const cell = (score: number) =>
    `<td style="padding:2px"><a href="${escapeHtml(`${url}?score=${score}`)}" style="display:block;width:34px;line-height:34px;text-align:center;border:1px solid #d6d6d6;border-radius:4px;color:#333333;text-decoration:none;font-weight:600">${score}</a></td>`;
  const html = `<!doctype html><html><body style="margin:0;background:#fcfcfc;font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;color:#333333">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #ebebeb;border-radius:8px">
<tr><td style="padding:28px">
<p style="margin:0 0 12px">Hello ${escapeHtml(firstName)},</p>
<p style="margin:0 0 18px;font-size:16px;font-weight:600">${escapeHtml(question)}</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr>${scale.map(cell).join('')}</tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;color:#666666;font-size:12px"><tr><td>Not at all likely</td><td align="right">Extremely likely</td></tr></table>
<p style="margin:22px 0 0;color:#666666;font-size:13px">It takes ten seconds. Thank you,<br>${escapeHtml(business(settings))}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
};

export const sendSurveyEmail = async ({ to, firstName, url, settings }: { to: string; firstName: string; url: string; settings: FeedbackSettings }) => {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURITY, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM_ADDRESS } = process.env;
  if (!SMTP_HOST || !SMTP_FROM_ADDRESS) throw new Error('The mail server is not configured (SMTP_HOST and SMTP_FROM_ADDRESS).');
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: SMTP_SECURITY === 'TLS',
    requireTLS: SMTP_SECURITY === 'STARTTLS',
    ignoreTLS: SMTP_SECURITY === 'NONE',
    auth: SMTP_USERNAME ? { user: SMTP_USERNAME, pass: SMTP_PASSWORD } : undefined,
  });
  const email = buildSurveyEmail({ firstName, url, settings });
  // Our domain signs this mail, so the sender always shows it comes through us.
  await transport.sendMail({ from: { name: `${business(settings)} via InventiveCRM`, address: SMTP_FROM_ADDRESS }, to, ...email });
};

// Hands the survey to InventiveChat (WHATSAPP_HANDOFF.md, event feedback.survey), which owns templates and numbers.
export const sendSurveyWhatsApp = async ({ requestId, phone, name, url, settings }: { requestId: string; phone: string; name: string; url: string; settings: FeedbackSettings }) => {
  const { WHATSAPP_GATEWAY_URL, WHATSAPP_GATEWAY_SECRET } = process.env;
  if (!WHATSAPP_GATEWAY_URL || !WHATSAPP_GATEWAY_SECRET) throw new Error('The WhatsApp service is not configured.');
  const body = JSON.stringify({
    event: 'feedback.survey',
    deliveryId: requestId,
    business: { name: business(settings) },
    recipient: { name, phone, whatsappOptIn: true },
    survey: { url, question: settings.question?.trim() || 'How likely are you to recommend us to a friend or colleague?' },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', WHATSAPP_GATEWAY_SECRET).update(`${timestamp}.${body}`).digest('hex');
  const response = await fetch(WHATSAPP_GATEWAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-InventiveCRM-Timestamp': timestamp, 'X-InventiveCRM-Signature': `sha256=${signature}` },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const reply = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(`WhatsApp service answered ${response.status}${reply.error ? `: ${reply.error}` : ''}`);
  }
};

export const sendAlertEmail = async ({ to, subject, text }: { to: string[]; subject: string; text: string }) => {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURITY, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM_ADDRESS } = process.env;
  if (!SMTP_HOST || !SMTP_FROM_ADDRESS || to.length === 0) return;
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: SMTP_SECURITY === 'TLS',
    requireTLS: SMTP_SECURITY === 'STARTTLS',
    ignoreTLS: SMTP_SECURITY === 'NONE',
    auth: SMTP_USERNAME ? { user: SMTP_USERNAME, pass: SMTP_PASSWORD } : undefined,
  });
  await transport.sendMail({ from: { name: 'InventiveCRM Feedback', address: SMTP_FROM_ADDRESS }, to, subject, text });
};
