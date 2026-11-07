import nodemailer from 'nodemailer';

import { cachedForRun, metadata } from 'src/lib/api';
import { type AppointmentRecord } from 'src/lib/booking';
import { manageToken } from 'src/lib/tokens';

// Public pages live on the workspace's own address: <workspace URL>/s/...
export const publicBaseUrl = cachedForRun(async () => {
  const { currentWorkspace } = await metadata<{ currentWorkspace: { workspaceUrls: { customUrl: string | null; subdomainUrl: string } } }>(
    `{ currentWorkspace { workspaceUrls { customUrl subdomainUrl } } }`,
  );
  return `${(currentWorkspace.workspaceUrls.customUrl || currentWorkspace.workspaceUrls.subdomainUrl).replace(/\/$/, '')}/s`;
});

export const manageUrl = async (appointment: { id: string; manageNonce: string }) => `${await publicBaseUrl()}/booking/manage/${manageToken(appointment.id, appointment.manageNonce)}`;

export const formatWhen = (start: number, end: number, timeZone: string) => {
  const zone = timeZone || 'Europe/London';
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(start);
  const time = (at: number) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit' }).format(at);
  return `${day}, ${time(start)} to ${time(end)} (${zone})`;
};

const icsText = (value: string) => value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
const icsTime = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const fold = (line: string) => line.match(/.{1,73}/g)?.join('\r\n ') ?? line;

// A stable UID and a rising SEQUENCE let calendar apps update or cancel the same entry instead of adding another.
export const buildIcs = ({
  appointment,
  method,
  summary,
  organizer,
  description,
}: {
  appointment: AppointmentRecord;
  method: 'REQUEST' | 'CANCEL';
  summary: string;
  organizer: { name: string; email: string };
  description: string;
}) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//InventiveCRM//Scheduling//EN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${appointment.id}@inventivecrm`,
    `SEQUENCE:${Math.floor(Date.now() / 1000)}`,
    `DTSTAMP:${icsTime(Date.now())}`,
    `DTSTART:${icsTime(Date.parse(appointment.startsAt))}`,
    `DTEND:${icsTime(Date.parse(appointment.endsAt))}`,
    `SUMMARY:${icsText(summary)}`,
    `DESCRIPTION:${icsText(description)}`,
    ...(appointment.location || appointment.meetingUrl ? [`LOCATION:${icsText(appointment.meetingUrl || appointment.location)}`] : []),
    `ORGANIZER;CN=${icsText(organizer.name)}:mailto:${organizer.email}`,
    `ATTENDEE;CN=${icsText(appointment.customerName)};ROLE=REQ-PARTICIPANT:mailto:${appointment.customerEmail}`,
    `STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .map(fold)
    .join('\r\n');

export const sendMail = async ({
  to,
  subject,
  text,
  replyTo,
  fromName,
  ics,
}: {
  to: string;
  subject: string;
  text: string;
  replyTo?: string | null;
  fromName: string;
  ics?: { content: string; method: 'REQUEST' | 'CANCEL' } | null;
}) => {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURITY, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM_ADDRESS } = process.env;
  if (!SMTP_HOST || !SMTP_FROM_ADDRESS) throw new Error('Booking emails are not configured (SMTP_HOST and SMTP_FROM_ADDRESS).');
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: SMTP_SECURITY === 'TLS',
    requireTLS: SMTP_SECURITY === 'STARTTLS',
    ignoreTLS: SMTP_SECURITY === 'NONE',
    auth: SMTP_USERNAME ? { user: SMTP_USERNAME, pass: SMTP_PASSWORD } : undefined,
  });
  await transport.sendMail({
    from: { name: fromName, address: SMTP_FROM_ADDRESS },
    replyTo: replyTo || undefined,
    to,
    subject,
    text,
    ...(ics ? { icalEvent: { method: ics.method, content: ics.content, filename: 'appointment.ics' } } : {}),
  });
};
