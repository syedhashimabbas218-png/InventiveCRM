import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { describeError, InventiveChatError, OUTCOME_UNKNOWN_MESSAGE, readError, sendAutomationText } from 'src/lib/inventivechat';

type Request = { method: string; path: string; body: Record<string, unknown> | null };

const CONTEXT = { key: 'wa_test_key', tenantId: 'ten_1' };
const INPUT = { conversationId: 'conv_1', text: 'Your booking is on Friday.', topic: 'bookings', idempotencyKey: 'crm_abc_1', correlation: 'abc' };

let requests: Request[] = [];

const fakeInventiveChat = (answers: Record<string, () => Response | Promise<Response>>) =>
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname.replace(/^\/v1/, '');
    requests.push({ method: init.method ?? 'GET', path, body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null });
    const answer = answers[`${init.method} ${path}`];
    if (!answer) return Response.json({ reason: 'not_found' }, { status: 404 });
    return answer();
  });

const claimed = () => Response.json({ claimed: true, claim_id: 'clm_1', expires_at: '2026-11-18T10:01:00Z' });
const conversation = () => Response.json({ conversation_id: 'conv_1', latest_message_id: 'msg_in_2' });
const released = () => Response.json({ released: true });
const paths = () => requests.map((request) => `${request.method} ${request.path}`);

beforeEach(() => {
  requests = [];
  process.env.INVENTIVECHAT_API_URL = 'http://inventivechat.test';
});

afterEach(() => vi.unstubAllGlobals());

describe('automated replies hold a claim only while they send', () => {
  it("claims for the customer's latest message, sends, then releases the claim", async () => {
    fakeInventiveChat({
      'GET /conversations/conv_1': conversation,
      'POST /conversations/conv_1/claim': claimed,
      'POST /messages/send': () => Response.json({ message_id: 'msg_out_1', conversation_id: 'conv_1' }),
      'POST /conversations/conv_1/release': released,
    });
    await expect(sendAutomationText(CONTEXT, INPUT)).resolves.toMatchObject({ messageId: 'msg_out_1' });
    expect(paths()).toEqual(['GET /conversations/conv_1', 'POST /conversations/conv_1/claim', 'POST /messages/send', 'POST /conversations/conv_1/release']);
    expect(requests[1]?.body?.payload).toEqual({ claimant: 'ai', latest_message_id: 'msg_in_2', ttl_seconds: 60 });
    expect(requests[2]?.body?.payload).toMatchObject({ claim_id: 'clm_1', topic: 'bookings', type: 'text' });
    expect(requests[3]?.body?.payload).toEqual({ claim_id: 'clm_1' });
  });

  it('releases the claim when the send is refused, and passes the refusal on', async () => {
    fakeInventiveChat({
      'GET /conversations/conv_1': conversation,
      'POST /conversations/conv_1/claim': claimed,
      'POST /messages/send': () => Response.json({ reason: 'out_of_scope', allowed_topics: ['billing'], action: 'handoff' }, { status: 422 }),
      'POST /conversations/conv_1/release': released,
    });
    await expect(sendAutomationText(CONTEXT, INPUT)).rejects.toMatchObject({ code: 'out_of_scope', allowedTopics: ['billing'] });
    expect(paths().at(-1)).toBe('POST /conversations/conv_1/release');
  });

  it('claims afresh on every attempt, so a retry never reuses a released claim', async () => {
    fakeInventiveChat({
      'GET /conversations/conv_1': conversation,
      'POST /conversations/conv_1/claim': claimed,
      'POST /messages/send': () => Response.json({ error: 'rate_limited' }, { status: 429 }),
      'POST /conversations/conv_1/release': released,
    });
    await expect(sendAutomationText(CONTEXT, INPUT)).rejects.toBeInstanceOf(InventiveChatError);
    await expect(sendAutomationText(CONTEXT, INPUT)).rejects.toBeInstanceOf(InventiveChatError);
    const claimKeys = requests.filter((request) => request.path.endsWith('/claim')).map((request) => request.body?.idempotency_key);
    expect(new Set(claimKeys).size).toBe(2);
    const sendKeys = requests.filter((request) => request.path === '/messages/send').map((request) => request.body?.idempotency_key);
    expect(sendKeys).toEqual(['crm_abc_1', 'crm_abc_1']);
  });

  it('does not wait on a release when InventiveChat stopped answering', async () => {
    fakeInventiveChat({
      'GET /conversations/conv_1': conversation,
      'POST /conversations/conv_1/claim': claimed,
      'POST /messages/send': () => Promise.reject(new Error('socket hang up')),
    });
    await expect(sendAutomationText(CONTEXT, INPUT)).rejects.toMatchObject({ code: 'unreachable' });
    expect(paths()).not.toContain('POST /conversations/conv_1/release');
  });

  it('a release that fails does not hide a sent message', async () => {
    fakeInventiveChat({
      'GET /conversations/conv_1': conversation,
      'POST /conversations/conv_1/claim': claimed,
      'POST /messages/send': () => Response.json({ message_id: 'msg_out_1', conversation_id: 'conv_1' }),
      'POST /conversations/conv_1/release': () => Response.json({ error: 'internal' }, { status: 500 }),
    });
    await expect(sendAutomationText(CONTEXT, INPUT)).resolves.toMatchObject({ messageId: 'msg_out_1' });
  });

  it('refuses before claiming when the customer never wrote', async () => {
    fakeInventiveChat({ 'GET /conversations/conv_1': () => Response.json({ conversation_id: 'conv_1', latest_message_id: null }) });
    await expect(sendAutomationText(CONTEXT, INPUT)).rejects.toMatchObject({ code: 'outside_window' });
    expect(paths()).toEqual(['GET /conversations/conv_1']);
  });
});

describe('sends whose outcome InventiveChat cannot confirm', () => {
  it('are never retried with the same key and say what happened', () => {
    for (const status of [502, 409]) {
      const error = readError(status, { reason: 'outcome_unknown' }, null);
      expect(error.retryable).toBe(false);
      expect(error.later).toBe(false);
      expect(describeError(error)).toBe(OUTCOME_UNKNOWN_MESSAGE);
    }
  });

  it('explain a claim that ended while the reply was being sent', () => {
    expect(describeError(readError(409, { reason: 'claim_invalid' }, null))).toMatch(/customer wrote again or a teammate stepped in/);
  });
});
