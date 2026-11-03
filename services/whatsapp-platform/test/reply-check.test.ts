import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyEscalation } from '../src/agent/escalation.ts';
import { checkReply, extractAmountsPence } from '../src/agent/reply-check.ts';

const base = {
  approvedPricesPence: new Set([8500, 4550]),
  allowedPhoneDigits: new Set(['441134960000', '447700900123']),
  allowedEmails: new Set(['office@ahmedplumbing.example']),
  canary: 'ref-abc123',
  protectedPromptText: 'Never state a price unless it appears in the price list results. Never negotiate, discount or estimate.',
  customerText: 'How much is it?',
};
const check = (reply: string, overrides: Partial<typeof base> = {}) => checkReply({ ...base, ...overrides, reply });

describe('reply check', () => {
  it('extracts amounts in the usual written forms', () => {
    assert.deepEqual(extractAmountsPence('£85, £45.50, £1,200, 60 pounds, GBP 30, 99p, £45.5'), [8500, 4550, 120000, 4550, 6000, 3000, 99]);
    assert.deepEqual(extractAmountsPence('See you at 2pm on the 5th'), []);
  });

  it('passes approved prices and plain answers', () => {
    assert.deepEqual(check('A boiler service is £85 and a check is £45.50.'), []);
    assert.deepEqual(check('We are open 8am to 6pm, Monday to Friday.'), []);
  });

  it('blocks unapproved, worded and foreign-currency prices', () => {
    assert.deepEqual(check('That would be £90.'), ['unapproved_price']);
    assert.deepEqual(check('Roughly fifty quid.'), ['unverifiable_price']);
    assert.deepEqual(check('About $100.'), ['unverifiable_price']);
  });

  it('blocks offers to negotiate but not polite refusals', () => {
    assert.deepEqual(check('I can do you a discount if you book today.'), ['negotiation']);
    assert.deepEqual(check('10% off for you!'), ['negotiation']);
    assert.deepEqual(check("Sorry, our prices are fixed, so I'm not able to change them."), []);
  });

  it('blocks prompt leaks, canaries and internal ids', () => {
    assert.deepEqual(check('My rules: never state a price unless it appears in the price list results.'), ['prompt_leak']);
    assert.deepEqual(check('ref-abc123'), ['prompt_leak']);
    assert.deepEqual(check('Your booking id is bkg_a1b2c3d4e5f6.'), ['internal_identifier']);
  });

  it('blocks contact details that do not belong to the business or the customer', () => {
    assert.deepEqual(check('Call us on 0113 496 0000.'), []);
    assert.deepEqual(check('Call Dave on 07700 900456.'), ['unknown_phone_number']);
    assert.deepEqual(check('Email dave@other.example.'), ['unknown_email']);
  });

  it('flags a reply in a different script from the customer [VERIFY with real Urdu and Punjabi users]', () => {
    assert.deepEqual(check('We are open until 6pm.', { customerText: 'آپ کب کھلے ہیں؟' }), ['language_mismatch']);
    assert.deepEqual(check('Hum 6 baje tak khule hain.', { customerText: 'aap kab tak khule ho?' }), []);
  });

  it('blocks empty and overlong replies', () => {
    assert.deepEqual(check('   '), ['empty']);
    assert.deepEqual(check('word '.repeat(200)), ['too_long']);
  });
});

describe('escalation classifier', () => {
  it('spots emergencies, refunds, disputes and complaints', () => {
    assert.equal(classifyEscalation('I think there is a gas leak'), 'emergency');
    assert.equal(classifyEscalation('my CO alarm is going off'), 'emergency');
    assert.equal(classifyEscalation('the kitchen is flooding'), 'emergency');
    assert.equal(classifyEscalation('I want my money back'), 'refund');
    assert.equal(classifyEscalation('you overcharged me'), 'price_dispute');
    assert.equal(classifyEscalation('I want to make a complaint'), 'complaint');
    assert.equal(classifyEscalation('Can I book a boiler service?'), undefined);
  });
});
