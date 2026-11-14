import { afterEach, describe, expect, it } from 'vitest';

import { STARTER_TEMPLATES } from 'src/constants/starter-templates';
import { DEFAULT_BRAND, designProblems, fillVariables, parseDesign, renderEmail, safeImage, safeLink, unknownVariables, type Design } from 'src/lib/design';
import { fromAddress, isEmail } from 'src/lib/engine';
import { normaliseAddress } from 'src/lib/store';
import { newNonce, recipientToken, verifyRecipientToken, verifyWebhookToken, webhookToken } from 'src/lib/tokens';

const tokenFor = (workspaceId: string) => `x.${Buffer.from(JSON.stringify({ workspaceId })).toString('base64url')}.y`;
const brand = { ...DEFAULT_BRAND, name: 'Acme', footerText: 'Acme Ltd\n1 High Street, London' };
const options = { subject: 'Hello {{firstName|there}}', previewText: 'News', unsubscribeUrl: 'https://crm.example/s/campaigns/unsubscribe/abc', contact: { firstName: 'Sam', email: 'sam@example.com' } };

describe('variables', () => {
  it('fills known variables and uses the fallback when empty', () => {
    expect(fillVariables('Hi {{firstName}}', { firstName: 'Sam' })).toBe('Hi Sam');
    expect(fillVariables('Hi {{ firstName | there }}', {})).toBe('Hi there');
    expect(fillVariables('{{fullName}} at {{companyName}}', { firstName: 'Sam', lastName: 'Lee', companyName: 'Acme' })).toBe('Sam Lee at Acme');
  });

  it('leaves unknown variables visible and reports them', () => {
    expect(fillVariables('{{nickname}}', { firstName: 'Sam' })).toBe('{{nickname}}');
    expect(unknownVariables({ version: 1, blocks: [{ id: 'a', type: 'text', text: '{{nickname}} {{firstName}}' }] }, '{{city}}')).toEqual(['city', 'nickname']);
  });
});

describe('links', () => {
  it('only allows web, email and phone links', () => {
    expect(safeLink('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeLink('mailto:hi@example.com')).toBe('mailto:hi@example.com');
    expect(safeLink('javascript:alert(1)')).toBe('');
    expect(safeLink('data:text/html,<script>')).toBe('');
    expect(safeImage('http://example.com/a.png')).toBe('');
    expect(safeImage('https://example.com/a.png')).toBe('https://example.com/a.png');
  });
});

describe('rendering', () => {
  const design: Design = {
    version: 1,
    blocks: [
      { id: '1', type: 'heading', text: 'Hi {{firstName}} <b>', level: 1 },
      { id: '2', type: 'text', text: 'Read **this** and [our site](https://example.com?a=1&b=2).\n\nSecond [bad](javascript:alert(1)) paragraph.' },
      { id: '3', type: 'button', label: 'Go', url: 'https://example.com/go' },
      { id: '4', type: 'image', url: 'javascript:alert(1)', alt: 'x' },
      { id: '5', type: 'social', links: { instagram: 'https://instagram.com/acme', facebook: 'javascript:x' } },
    ],
  };
  const { html, text, subject } = renderEmail(design, brand, options);

  it('personalises the subject and the body', () => {
    expect(subject).toBe('Hello Sam');
    expect(html).toContain('Hi Sam &#60;b&#62;');
  });

  it('escapes content and drops unsafe links and images', () => {
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<strong>this</strong>');
    expect(html).toContain('href="https://example.com/?a=1&#38;b=2"');
    expect(html).toContain('Instagram');
    expect(html).not.toContain('Facebook');
  });

  it('always carries the footer address and the unsubscribe link', () => {
    expect(html).toContain('Acme Ltd<br>1 High Street, London');
    expect(html).toContain('href="https://crm.example/s/campaigns/unsubscribe/abc"');
    expect(text).toContain('Unsubscribe: https://crm.example/s/campaigns/unsubscribe/abc');
  });

  it('has a plain text version with links spelled out', () => {
    expect(text).toContain('HI SAM <B>');
    expect(text).toContain('our site (https://example.com/?a=1&b=2)');
    expect(text).toContain('Go: https://example.com/go');
  });

  it('renders every starter template without problems except missing links', () => {
    for (const template of STARTER_TEMPLATES) {
      const rendered = renderEmail(template.design, brand, options);
      expect(rendered.html).toContain('<!doctype html>');
      expect(designProblems(template.design, brand).every((problem) => /button|image/.test(problem))).toBe(true);
    }
  });
});

describe('designer placeholders', () => {
  it('show empty images and buttons in the designer only', () => {
    const design: Design = { version: 1, blocks: [{ id: 'i', type: 'image', url: '' }, { id: 'b', type: 'button', label: 'Go', url: '' }] };
    const preview = renderEmail(design, brand, { ...options, placeholders: true }).html;
    const real = renderEmail(design, brand, options).html;
    expect(preview).toContain('dashed');
    expect(preview).toContain('>Go</a>');
    expect(real).not.toContain('dashed');
    expect(real).not.toContain('>Go</a>');
  });
});

describe('design checks', () => {
  it('requires content and a footer address', () => {
    expect(designProblems({ version: 1, blocks: [] }, DEFAULT_BRAND)).toHaveLength(2);
  });

  it('drops unknown block types and oversize input from the browser', () => {
    const parsed = parseDesign({ blocks: [{ type: 'script', text: 'x' }, { type: 'text', text: 'a'.repeat(10_000) }, null, 'x'] });
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0]).toMatchObject({ type: 'text' });
    expect((parsed.blocks[0] as { text: string }).text.length).toBe(5000);
    expect(parseDesign({ blocks: Array.from({ length: 100 }, () => ({ type: 'divider' })) }).blocks).toHaveLength(60);
  });
});

describe('addresses', () => {
  it('validates and normalises', () => {
    expect(isEmail('a@b.co')).toBe(true);
    expect(isEmail('a@b')).toBe(false);
    expect(isEmail('"x"@b.com')).toBe(false);
    expect(normaliseAddress(' Sam@Example.COM ', 'EMAIL')).toBe('sam@example.com');
    expect(normaliseAddress('+44 7700 900-123', 'WHATSAPP')).toBe('+447700900123');
  });

  it('builds a from header without header injection', () => {
    expect(fromAddress({ fromName: 'Acme "Team"\r\nBcc: x@y.z', fromLocalPart: 'News', fromDomain: 'Acme.com' })).toBe('"Acme TeamBcc: x@y.z" <news@acme.com>');
  });
});

describe('signed links', () => {
  afterEach(() => {
    delete process.env.CAMPAIGN_LINK_SECRET;
    delete process.env.TWENTY_APP_ACCESS_TOKEN;
  });

  it('verifies an unsubscribe link only in its own workspace and with its nonce', () => {
    process.env.CAMPAIGN_LINK_SECRET = 'x'.repeat(40);
    process.env.TWENTY_APP_ACCESS_TOKEN = tokenFor('workspace-a');
    const nonce = newNonce();
    const token = recipientToken('11111111-1111-4111-8111-111111111111', nonce);
    expect(verifyRecipientToken(token, nonce)).toBe(true);
    expect(verifyRecipientToken(token, newNonce())).toBe(false);
    expect(verifyRecipientToken(token.replace('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'), nonce)).toBe(false);
    const hook = webhookToken();
    expect(verifyWebhookToken(hook)).toBe(true);
    process.env.TWENTY_APP_ACCESS_TOKEN = tokenFor('workspace-b');
    expect(verifyRecipientToken(token, nonce)).toBe(false);
    expect(verifyWebhookToken(hook)).toBe(false);
  });

  it('refuses to sign without a long secret', () => {
    process.env.CAMPAIGN_LINK_SECRET = 'short';
    process.env.TWENTY_APP_ACCESS_TOKEN = tokenFor('workspace-a');
    expect(() => webhookToken()).toThrow(/CAMPAIGN_LINK_SECRET/);
  });
});
