import { afterEach, describe, expect, it } from 'vitest';

import { channelSeal, decryptText, directConversationKey, encryptText, memberKey, membershipSeal, sealMatches } from 'src/lib/crypto';
import { channelName, cleanBody, cleanLinks, cleanMentions, FAST_POLL_MS, MAX_MESSAGE_LENGTH, pollChanges, pollDelay, unreadPollDelay } from 'src/lib/rules';

const tokenFor = (workspaceId: string) => `x.${Buffer.from(JSON.stringify({ workspaceId })).toString('base64url')}.y`;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('message encryption', () => {
  afterEach(() => {
    delete process.env.CHAT_SECRET;
    delete process.env.TWENTY_APP_ACCESS_TOKEN;
  });

  it('round-trips, and fails in another channel, another workspace or after tampering', () => {
    process.env.CHAT_SECRET = 'k'.repeat(40);
    process.env.TWENTY_APP_ACCESS_TOKEN = tokenFor('workspace-a');
    const sealed = encryptText('Lunch at 1? 🍕', A);
    expect(sealed).not.toContain('Lunch');
    expect(encryptText('Lunch at 1? 🍕', A)).not.toBe(sealed);
    expect(decryptText(sealed, A)).toBe('Lunch at 1? 🍕');
    expect(decryptText(sealed, B)).toBeNull();
    const parts = sealed.split('.');
    expect(decryptText(`${parts[0]}.${parts[1]}.${parts[2]?.slice(0, -2)}AA`, A)).toBeNull();
    expect(decryptText('plain text', A)).toBeNull();
    process.env.TWENTY_APP_ACCESS_TOKEN = tokenFor('workspace-b');
    expect(decryptText(sealed, A)).toBeNull();
  });

  it('makes member keys and seals that only the app can produce', () => {
    process.env.CHAT_SECRET = 'k'.repeat(40);
    process.env.TWENTY_APP_ACCESS_TOKEN = tokenFor('workspace-a');
    expect(memberKey(A)).not.toContain(A);
    expect(memberKey(A)).toBe(memberKey(A));
    expect(membershipSeal(C, A)).not.toBe(membershipSeal(C, B));
    expect(sealMatches(membershipSeal(C, A), membershipSeal(C, A))).toBe(true);
    expect(sealMatches(membershipSeal(C, A), 'forged')).toBe(false);
    expect(sealMatches(membershipSeal(C, A), null)).toBe(false);
    const channel = { id: C, kind: 'CHANNEL', visibility: 'PRIVATE', directKey: 'x', createdByMemberId: memberKey(A) };
    expect(channelSeal({ ...channel, visibility: 'PUBLIC' })).not.toBe(channelSeal(channel));
    expect(directConversationKey(A, B)).toBe(directConversationKey(B, A));
    const before = memberKey(A);
    process.env.TWENTY_APP_ACCESS_TOKEN = tokenFor('workspace-b');
    expect(memberKey(A)).not.toBe(before);
  });

  it('refuses to work without a long secret', () => {
    process.env.CHAT_SECRET = 'short';
    process.env.TWENTY_APP_ACCESS_TOKEN = tokenFor('workspace-a');
    expect(() => encryptText('x', A)).toThrow(/CHAT_SECRET/);
  });
});

describe('message rules', () => {
  it('trims and limits text', () => {
    expect(cleanBody('  hi\r\nthere \n\n\n\n\nend ')).toBe('hi\nthere \n\n\nend');
    expect(cleanBody('x'.repeat(MAX_MESSAGE_LENGTH + 10))).toHaveLength(MAX_MESSAGE_LENGTH);
    expect(cleanBody(42)).toBe('');
  });

  it('keeps only well-formed record links, each once, at most five', () => {
    const links = cleanLinks([
      { objectNameSingular: 'person', recordId: A, label: 'Ann' },
      { objectNameSingular: 'person', recordId: A, label: 'Ann again' },
      { objectNameSingular: 'company; drop', recordId: B, label: 'x' },
      { objectNameSingular: 'company', recordId: 'not-a-uuid', label: 'x' },
      null,
      ...Array.from({ length: 10 }, (_, index) => ({ objectNameSingular: 'opportunity', recordId: `4444444${index}-4444-4444-8444-444444444444`, label: 'Deal' })),
    ]);
    expect(links[0]).toEqual({ objectNameSingular: 'person', recordId: A, label: 'Ann' });
    expect(links).toHaveLength(5);
  });

  it('only lets people who can see the channel be mentioned', () => {
    expect(cleanMentions([A, B, B, C, 'x'], new Set([A, B]))).toEqual([A, B]);
    expect(cleanMentions('nope', new Set([A]))).toEqual([]);
  });

  it('turns channel names into slugs', () => {
    expect(channelName('  Sales & Leads! ')).toBe('sales-leads');
    expect(channelName('#general')).toBe('general');
  });
});

describe('polling', () => {
  const message = (id: string, editedAt: string | null = null) => ({ id, editedAt });

  it('reports nothing when a poll only repeats what is shown', () => {
    const shown = [message('a'), message('b')];
    expect(pollChanges(shown, [message('b')], [message('a')], []).changedAnything).toBe(false);
  });

  it('picks out new messages, real edits and removals of shown messages only', () => {
    const shown = [message('a'), message('b')];
    const result = pollChanges(shown, [message('b'), message('c'), message('d')], [message('a', '2026-11-17T10:00:00.000Z'), message('x', '2026-11-17T10:00:00.000Z')], ['b', 'd', 'y']);
    expect(result.fresh.map((entry) => entry.id)).toEqual(['c']);
    expect(result.edits.map((entry) => entry.id)).toEqual(['a']);
    expect(result.gone).toEqual(['b']);
    expect(result.changedAnything).toBe(true);
  });

  it('slows down while quiet and after failures, never beyond a minute', () => {
    expect(pollDelay(0, 0)).toBe(FAST_POLL_MS);
    expect(pollDelay(2 * 60_000, 0)).toBe(10_000);
    expect(pollDelay(10 * 60_000, 0)).toBe(30_000);
    expect(pollDelay(0, 1)).toBe(8_000);
    expect(pollDelay(0, 10)).toBe(60_000);
    expect(unreadPollDelay(0)).toBe(15_000);
    expect(unreadPollDelay(10 * 60_000)).toBe(60_000);
  });
});
