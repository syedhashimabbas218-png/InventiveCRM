import { createHmac } from 'node:crypto';

import { workspaceIdFromToken } from 'src/lib/crypto';

// Protocol and limits: platform-twenty/realtime/README.md.
const TOPIC = 'chat';
const PASS_SECONDS = 3600;

export type ChatChange = { kind: 'messages' | 'channel'; ids: string[] };

const settings = () => {
  const secret = process.env.REALTIME_SECRET ?? '';
  const internalUrl = process.env.REALTIME_INTERNAL_URL?.replace(/\/$/, '') ?? '';
  const publicUrl = process.env.REALTIME_PUBLIC_URL?.replace(/\/$/, '') ?? '';
  const workspace = workspaceIdFromToken(process.env.TWENTY_APP_APPLICATION_ACCESS_TOKEN) ?? workspaceIdFromToken(process.env.TWENTY_APP_ACCESS_TOKEN);
  return secret.length >= 32 && internalUrl && publicUrl && workspace ? { secret, internalUrl, publicUrl, workspace } : null;
};

export const signPublish = (secret: string, timestamp: string, body: string) => `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

export const passFor = (secret: string, claims: { workspace: string; member: string; exp: number }) => {
  const payload = Buffer.from(JSON.stringify({ ...claims, topics: [TOPIC] })).toString('base64url');
  return `v1.${payload}.${createHmac('sha256', secret).update(`v1.${payload}`).digest('base64url')}`;
};

// Live updates are a convenience: a hub that is down or slow must never fail the write before it.
export const publishChatChanges = async (changes: ChatChange[]) => {
  const config = settings();
  const events = changes.filter((change) => change.ids.length > 0);
  if (!config || events.length === 0) return;
  const body = JSON.stringify({ workspace: config.workspace, topic: TOPIC, events });
  const timestamp = String(Math.floor(Date.now() / 1000));
  try {
    const response = await fetch(`${config.internalUrl}/v1/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Realtime-Timestamp': timestamp, 'X-Realtime-Signature': signPublish(config.secret, timestamp, body) },
      body,
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`the hub answered ${response.status}`);
  } catch (error) {
    console.error(`team chat realtime publish: ${(error as Error).message}`);
  }
};

export const livePassFor = (member: string) => {
  const config = settings();
  if (!config) return null;
  const exp = Math.floor(Date.now() / 1000) + PASS_SECONDS;
  return { url: `${config.publicUrl}/v1/stream`, token: passFor(config.secret, { workspace: config.workspace, member, exp }), expiresAt: new Date(exp * 1000).toISOString() };
};
