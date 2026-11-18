import { createHmac } from 'node:crypto';

import { currentWorkspaceId, signBody } from 'src/lib/crypto';

export const REALTIME_TOPIC = 'whatsapp';
export const REALTIME_TOKEN_SECONDS = 3600;
const PUBLISH_TIMEOUT_MS = 3000;

export type ChangeKind = 'conversation' | 'message';
export type ChangeEvent = { kind: ChangeKind; ids: string[] };

const realtimeSecret = () => {
  const value = process.env.REALTIME_SECRET;
  if (!value || value.length < 32) throw new Error('REALTIME_SECRET must be set (at least 32 characters).');
  return value;
};

export const buildPublishRequest = ({ workspace, events, secret, nowSeconds = Math.floor(Date.now() / 1000) }: { workspace: string; events: ChangeEvent[]; secret: string; nowSeconds?: number }) => {
  const body = JSON.stringify({ workspace, topic: REALTIME_TOPIC, events });
  const timestamp = String(nowSeconds);
  return { body, headers: { 'Content-Type': 'application/json', 'X-Realtime-Timestamp': timestamp, 'X-Realtime-Signature': signBody(secret, timestamp, body) } };
};

// Live updates are a convenience: a hub that is down or slow must never fail the write that came before.
export const publishChange = async (events: ChangeEvent[]) => {
  const base = process.env.REALTIME_INTERNAL_URL?.replace(/\/$/, '');
  const meaningful = events.filter((event) => event.ids.length > 0);
  if (!base || meaningful.length === 0) return;
  try {
    const workspace = currentWorkspaceId();
    if (!workspace) throw new Error('the workspace of this request is unknown');
    const { body, headers } = buildPublishRequest({ workspace, events: meaningful, secret: realtimeSecret() });
    const response = await fetch(`${base}/v1/publish`, { method: 'POST', headers, body, signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`the hub answered ${response.status}`);
  } catch (error) {
    console.error(`whatsapp realtime publish: ${(error as Error).message}`);
  }
};

// Collects what a request changed so one publish goes out at the end, whatever path the request took.
export const createChangeSet = () => {
  const conversations = new Set<string>();
  const messages = new Set<string>();
  return {
    conversation: (id: string | null | undefined) => void (id && conversations.add(id)),
    message: (id: string | null | undefined) => void (id && messages.add(id)),
    publish: () =>
      publishChange([
        { kind: 'conversation', ids: [...conversations] },
        { kind: 'message', ids: [...messages] },
      ]),
  };
};

export type ChangeSet = ReturnType<typeof createChangeSet>;

export const mintRealtimeToken = ({ workspace, member, secret, nowSeconds = Math.floor(Date.now() / 1000) }: { workspace: string; member: string; secret: string; nowSeconds?: number }) => {
  const exp = nowSeconds + REALTIME_TOKEN_SECONDS;
  const payloadPart = Buffer.from(JSON.stringify({ workspace, member, topics: [REALTIME_TOPIC], exp })).toString('base64url');
  const signature = createHmac('sha256', secret).update(`v1.${payloadPart}`).digest('base64url');
  return { token: `v1.${payloadPart}.${signature}`, expiresAt: new Date(exp * 1000).toISOString() };
};

export const realtimeTokenFor = (member: string) => {
  const publicUrl = process.env.REALTIME_PUBLIC_URL?.replace(/\/$/, '');
  const workspace = currentWorkspaceId();
  if (!publicUrl || !process.env.REALTIME_INTERNAL_URL || !workspace) return null;
  return { url: `${publicUrl}/v1/stream`, ...mintRealtimeToken({ workspace, member, secret: realtimeSecret() }) };
};
