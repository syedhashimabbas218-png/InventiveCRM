import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const secret = () => {
  const value = process.env.BOOKING_LINK_SECRET;
  if (!value || value.length < 32) throw new Error('BOOKING_LINK_SECRET must be set (at least 32 characters).');
  return value;
};

const mac = (value: string) => createHmac('sha256', secret()).update(value).digest('base64url').slice(0, 32);

export const newNonce = () => randomBytes(12).toString('base64url');

// "<appointment id>.<mac>": the mac covers a per-appointment nonce, so links cannot be guessed or enumerated and
// changing the nonce revokes the old link.
export const manageToken = (appointmentId: string, nonce: string) => `${appointmentId}.${mac(`manage:${appointmentId}:${nonce}`)}`;

export const parseManageToken = (token: string) => {
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{32})$/.exec(token);
  return match ? { appointmentId: match[1], signature: match[2] } : null;
};

export const verifyManageToken = (token: string, nonce: string) => {
  const parsed = parseManageToken(token);
  if (!parsed || !nonce) return false;
  const expected = Buffer.from(mac(`manage:${parsed.appointmentId}:${nonce}`));
  const given = Buffer.from(parsed.signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
};

// Signed form ticket: the page is served with one, and a booking must come back with it no sooner than a few
// seconds later (bots post instantly) and within a day.
export const formTicket = (slug: string, issuedAt = Date.now()) => `${issuedAt}.${mac(`form:${slug}:${issuedAt}`)}`;

export const checkFormTicket = (slug: string, ticket: string | undefined, now = Date.now()) => {
  const [issued, signature] = (ticket ?? '').split('.');
  const issuedAt = Number(issued);
  if (!issuedAt || !signature) return 'missing';
  const expected = Buffer.from(mac(`form:${slug}:${issuedAt}`));
  if (expected.length !== Buffer.from(signature).length || !timingSafeEqual(expected, Buffer.from(signature))) return 'invalid';
  if (now - issuedAt < 3000) return 'too-fast';
  if (now - issuedAt > 24 * 3600 * 1000) return 'expired';
  return 'ok';
};

export const clientFingerprint = (ip: string) => createHmac('sha256', secret()).update(`client:${ip}`).digest('hex').slice(0, 24);

export const hashKey = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 40);
