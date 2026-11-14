import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const secret = () => {
  const value = process.env.FEEDBACK_LINK_SECRET;
  if (!value || value.length < 32) throw new Error('FEEDBACK_LINK_SECRET must be set (at least 32 characters).');
  return value;
};

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

// The secret is shared by the whole server; links are signed with a key derived for this workspace so a link from
// one client never opens a survey in another.
const workspaceKey = () => {
  const workspaceId = workspaceIdFromToken(process.env.TWENTY_APP_APPLICATION_ACCESS_TOKEN) ?? workspaceIdFromToken(process.env.TWENTY_APP_ACCESS_TOKEN);
  if (!workspaceId) throw new Error('The workspace of this request is unknown, so no link can be signed or checked.');
  return createHmac('sha256', secret()).update(`workspace:${workspaceId}`).digest();
};

const mac = (value: string) => createHmac('sha256', workspaceKey()).update(value).digest('base64url').slice(0, 32);

export const newNonce = () => randomBytes(12).toString('base64url');

export const surveyToken = (requestId: string, nonce: string) => `${requestId}.${mac(`survey:${requestId}:${nonce}`)}`;

export const parseSurveyToken = (token: string) => {
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{32})$/.exec(token);
  return match ? { requestId: match[1], signature: match[2] } : null;
};

export const verifySurveyToken = (token: string, nonce: string | null | undefined) => {
  const parsed = parseSurveyToken(token);
  if (!parsed || !nonce) return false;
  const expected = Buffer.from(mac(`survey:${parsed.requestId}:${nonce}`));
  const given = Buffer.from(parsed.signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
};
