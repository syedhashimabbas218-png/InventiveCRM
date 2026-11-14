import { afterEach, describe, expect, it } from 'vitest';

import { decryptMessage, encryptMessage } from 'src/lib/crypto';
import { channelName, cleanBody, cleanLinks, cleanMentions, directKey, MAX_MESSAGE_LENGTH } from 'src/lib/rules';

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
    const sealed = encryptMessage('Lunch at 1? 🍕', A);
    expect(sealed).not.toContain('Lunch');
    expect(encryptMessage('Lunch at 1? 🍕', A)).not.toBe(sealed);
    expect(decryptMessage(sealed, A)).toBe('Lunch at 1? 🍕');
    expect(decryptMessage(sealed, B)).toBeNull();
    const parts = sealed.split('.');
    expect(decryptMessage(`${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}AA`, A)).toBeNull();
    expect(decryptMessage('plain text', A)).toBeNull();
    process.env.TWENTY_APP_ACCESS_TOKEN = tokenFor('workspace-b');
    expect(decryptMessage(sealed, A)).toBeNull();
  });

  it('refuses to work without a long secret', () => {
    process.env.CHAT_SECRET = 'short';
    process.env.TWENTY_APP_ACCESS_TOKEN = tokenFor('workspace-a');
    expect(() => encryptMessage('x', A)).toThrow(/CHAT_SECRET/);
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

  it('names direct conversations the same way from both sides', () => {
    expect(directKey(B, A)).toBe(directKey(A, B));
  });

  it('turns channel names into slugs', () => {
    expect(channelName('  Sales & Leads! ')).toBe('sales-leads');
    expect(channelName('#general')).toBe('general');
  });
});
