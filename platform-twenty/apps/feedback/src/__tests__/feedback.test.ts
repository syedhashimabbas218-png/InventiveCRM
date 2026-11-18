import { afterEach, describe, expect, it } from 'vitest';

import { TwentyUnavailableError } from 'src/lib/api';
import { escapeMarkdown, followUpTaskMarkdown, loggableError } from 'src/lib/answers';
import { isValidScore, npsGroup, npsSummary, reviewLinkFor, shouldAlert } from 'src/lib/nps';
import { type Candidate, isMissingSourceAppError, nextScanCursor, pickNewRequests, retryDelay } from 'src/lib/requests';
import { buildSurveyEmail } from 'src/lib/send';
import { type FeedbackSettings } from 'src/lib/settings';
import { newNonce, surveyToken, verifySurveyToken } from 'src/lib/tokens';
import { resolveGatewayUrl } from 'src/lib/send';

const tokenFor = (workspaceId: string) => `x.${Buffer.from(JSON.stringify({ workspaceId })).toString('base64url')}.y`;

describe('net promoter score', () => {
  it('groups scores the standard way', () => {
    expect([0, 6, 7, 8, 9, 10].map(npsGroup)).toEqual(['DETRACTOR', 'DETRACTOR', 'PASSIVE', 'PASSIVE', 'PROMOTER', 'PROMOTER']);
  });

  it('is percent promoters minus percent detractors', () => {
    expect(npsSummary([10, 10, 9, 8, 3])).toMatchObject({ total: 5, promoters: 3, passives: 1, detractors: 1, nps: 40 });
    expect(npsSummary([]).nps).toBeNull();
  });

  it('accepts only whole scores from 0 to 10', () => {
    expect([0, 10].every(isValidScore)).toBe(true);
    expect([-1, 11, 5.5, '7', null].some(isValidScore)).toBe(false);
  });

  it('alerts at or below the threshold', () => {
    expect(shouldAlert(6, 6)).toBe(true);
    expect(shouldAlert(7, 6)).toBe(false);
  });

  it('offers the review link only to promoters and only over https', () => {
    expect(reviewLinkFor(9, 9, 'https://g.page/r/abc/review')).toBe('https://g.page/r/abc/review');
    expect(reviewLinkFor(8, 9, 'https://g.page/r/abc/review')).toBeNull();
    expect(reviewLinkFor(10, 9, 'javascript:alert(1)')).toBeNull();
  });
});

describe('survey links', () => {
  afterEach(() => {
    delete process.env.TWENTY_APP_APPLICATION_ACCESS_TOKEN;
  });

  it('verify in their own workspace and fail in another or with another key', () => {
    process.env.FEEDBACK_LINK_SECRET = 'x'.repeat(40);
    const id = '0f62412a-f6fc-4f8e-929d-889e6347d975';
    const nonce = newNonce();
    process.env.TWENTY_APP_APPLICATION_ACCESS_TOKEN = tokenFor('workspace-a');
    const token = surveyToken(id, nonce);
    expect(verifySurveyToken(token, nonce)).toBe(true);
    expect(verifySurveyToken(token, newNonce())).toBe(false);
    process.env.TWENTY_APP_APPLICATION_ACCESS_TOKEN = tokenFor('workspace-b');
    expect(verifySurveyToken(token, nonce)).toBe(false);
  });
});

describe('survey email', () => {
  it('escapes the business name and question and links every score', () => {
    const email = buildSurveyEmail({ firstName: '<b>Sam</b>', url: 'https://acme.example/s/feedback/t', settings: { businessName: 'Acme & Sons', question: '<script>x</script>' } as FeedbackSettings });
    expect(email.html).not.toContain('<script>x</script>');
    expect(email.html).not.toContain('<b>Sam</b>');
    expect(email.html).toContain('Acme &#38; Sons');
    for (let score = 0; score <= 10; score += 1) expect(email.html).toContain(`?score=${score}`);
  });
});

describe('sending', () => {
  it('retries a failed send after 30 minutes, then 2 hours, and gives up after the third attempt', () => {
    expect([1, 2, 3].map(retryDelay)).toEqual([30 * 60_000, 2 * 3600_000, null]);
  });
});

describe('scanning for customers', () => {
  const since = '2026-11-17T10:00:00.000Z';
  const now = Date.parse('2026-11-17T10:15:00.000Z');

  it('treats only a missing source app as nothing to scan', () => {
    expect(isMissingSourceAppError(new Error('GraphQL error: Cannot query field "appointments" on type "Query".'))).toBe(true);
    expect(isMissingSourceAppError(new Error('GraphQL error: Unknown type "InvoiceFilterInput".'))).toBe(true);
    expect(isMissingSourceAppError(new Error('GraphQL error: Forbidden resource'))).toBe(false);
    expect(isMissingSourceAppError(new TwentyUnavailableError('Twenty did not answer: Cannot query field'))).toBe(false);
  });

  it('moves the cursor to now when every page was read completely', () => {
    expect(nextScanCursor(since, now, [{ full: false, lastUpdatedAt: '2026-11-17T10:05:00.000Z' }, { full: false, lastUpdatedAt: null }])).toBe(new Date(now).toISOString());
    expect(nextScanCursor(since, now, [])).toBe(new Date(now).toISOString());
  });

  it('resumes from the earliest last row of a full page', () => {
    expect(
      nextScanCursor(since, now, [
        { full: true, lastUpdatedAt: '2026-11-17T10:07:00.000Z' },
        { full: true, lastUpdatedAt: '2026-11-17T10:03:00.000Z' },
        { full: false, lastUpdatedAt: '2026-11-17T10:01:00.000Z' },
      ]),
    ).toBe('2026-11-17T10:03:00.000Z');
    expect(nextScanCursor(since, now, [{ full: true, lastUpdatedAt: '2026-11-17T10:20:00.000Z' }])).toBe(new Date(now).toISOString());
  });

  it('steps past a full page that never gets beyond the cursor', () => {
    expect(nextScanCursor(since, now, [{ full: true, lastUpdatedAt: since }])).toBe('2026-11-17T10:00:00.001Z');
  });

  it('asks once per source record and once per customer, skipping those without a person or asked recently', () => {
    const candidate = (sourceId: string, personId: string | null): Candidate => ({ source: 'APPOINTMENT', sourceId, personId, name: sourceId });
    const picked = pickNewRequests(
      [candidate('a1', 'p1'), candidate('a2', null), candidate('a3', 'p2'), candidate('a4', 'p3'), candidate('a5', 'p1'), candidate('a6', 'p4')],
      new Set(['a3']),
      new Set(['p3']),
    );
    expect(picked.map((row) => row.sourceId)).toEqual(['a1', 'a6']);
  });
});

describe('follow-up task', () => {
  it('shows the comment as plain text, without links, images or html', () => {
    expect(escapeMarkdown('[click](https://evil.example) ![x](https://evil.example/x.png) <img src=x> **hi**')).toBe(
      '\\[click\\]\\(https\\:\\/\\/evil\\.example\\) \\!\\[x\\]\\(https\\:\\/\\/evil\\.example\\/x\\.png\\) \\<img src\\=x\\> \\*\\*hi\\*\\*',
    );
    expect(escapeMarkdown('Thanks Sam 123')).toBe('Thanks Sam 123');
  });

  it('quotes every line of the comment', () => {
    expect(followUpTaskMarkdown(3, 'Late.\n# Not a heading')).toContain('> Late\\.\n> \\# Not a heading');
    expect(followUpTaskMarkdown(3, '')).toContain('No comment was left.');
  });

  it('keeps addresses out of logged errors', () => {
    expect(loggableError(new Error('550 <owner@acme.test>: Recipient address rejected'))).toBe('550 <<address>>: Recipient address rejected');
  });
});

describe('WhatsApp gateway address', () => {
  it('sends a path to the WhatsApp app of this same workspace, and keeps a full address as it is', () => {
    expect(resolveGatewayUrl('/s/whatsapp/gateway', 'https://acme.crm.example.com/s')).toBe('https://acme.crm.example.com/s/whatsapp/gateway');
    expect(resolveGatewayUrl('/s/whatsapp/gateway', 'https://glow.crm.example.com/s')).toBe('https://glow.crm.example.com/s/whatsapp/gateway');
    expect(resolveGatewayUrl('https://chat.example.com/hand-off', 'https://acme.crm.example.com/s')).toBe('https://chat.example.com/hand-off');
  });
});
