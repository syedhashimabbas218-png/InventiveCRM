import { afterEach, describe, expect, it } from 'vitest';

import { isValidScore, npsGroup, npsSummary, reviewLinkFor, shouldAlert } from 'src/lib/nps';
import { buildSurveyEmail } from 'src/lib/send';
import { type FeedbackSettings } from 'src/lib/settings';
import { newNonce, surveyToken, verifySurveyToken } from 'src/lib/tokens';

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
