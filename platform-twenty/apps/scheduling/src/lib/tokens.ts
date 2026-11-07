import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const secret = () => {
  const value = process.env.BOOKING_LINK_SECRET;
  if (!value || value.length < 32) throw new Error('BOOKING_LINK_SECRET must be set (at least 32 characters).');
  return value;
};

// The secret is shared by the whole server, so every token is signed with a key derived for this workspace: a link
// or ticket issued in one client's workspace is refused in every other.
export const workspaceIdFromToken = (token: string | undefined) => {
  const payload = token?.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { workspaceId?: unknown };
    return typeof claims.workspaceId === 'string' && claims.workspaceId ? claims.workspaceId : null;
  } catch {
    return null;
  }
};

const workspaceKey = () => {
  const workspaceId = workspaceIdFromToken(process.env.TWENTY_APP_APPLICATION_ACCESS_TOKEN) ?? workspaceIdFromToken(process.env.TWENTY_APP_ACCESS_TOKEN);
  if (!workspaceId) throw new Error('The workspace of this request is unknown, so no link can be signed or checked.');
  return createHmac('sha256', secret()).update(`workspace:${workspaceId}`).digest();
};

const mac = (value: string) => createHmac('sha256', workspaceKey()).update(value).digest('base64url').slice(0, 32);

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

// Ten-minute ticket for the staff advisor map, which runs outside Twenty's app frame (it needs a real DOM for the map).
export const mapTicket = (memberId: string, issuedAt = Date.now()) => `${memberId}.${issuedAt}.${mac(`map:${memberId}:${issuedAt}`)}`;

export const checkMapTicket = (ticket: string, now = Date.now()) => {
  const [memberId, issued, signature] = ticket.split('.');
  const issuedAt = Number(issued);
  if (!memberId || !issuedAt || !signature || now - issuedAt > 10 * 60 * 1000) return false;
  const expected = Buffer.from(mac(`map:${memberId}:${issuedAt}`));
  return expected.length === Buffer.from(signature).length && timingSafeEqual(expected, Buffer.from(signature));
};
