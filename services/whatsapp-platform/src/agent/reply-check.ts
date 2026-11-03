export type ReplyCheckInput = {
  reply: string;
  approvedPricesPence: ReadonlySet<number>;
  allowedPhoneDigits: ReadonlySet<string>;
  allowedEmails: ReadonlySet<string>;
  canary: string;
  protectedPromptText: string;
  customerText: string;
};

// Model replies never carry a real booking: those are confirmed by button and answered by fixed text.

export type ReplyProblem =
  | 'empty'
  | 'too_long'
  | 'unapproved_price'
  | 'unverifiable_price'
  | 'negotiation'
  | 'prompt_leak'
  | 'internal_identifier'
  | 'unknown_phone_number'
  | 'unknown_email'
  | 'unconfirmed_booking_claim'
  | 'language_mismatch';

export const MAX_REPLY_LENGTH = 700;
const PROMPT_OVERLAP_WORDS = 8;

const POUND_AMOUNT = /£\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;
const WORDED_AMOUNT = /\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s?(?:pounds?|quid|gbp)\b/gi;
const GBP_PREFIX_AMOUNT = /\bgbp\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/gi;
const PENCE_AMOUNT = /\b(\d+)\s?p\b/g;
const OTHER_CURRENCY = /[$€]\s?\d|\b\d+\s?(?:dollars?|euros?)\b/i;
const NUMBER_WORD_PRICE = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b[\w\s-]{0,20}\b(?:pounds?|quid|grand)\b|\b\d+(?:\.\d+)?\s?(?:k|grand)\b|\b(?:a|one|two|three|four|five)\s+grand\b/i;
// "A callout costs 120" states a price without a currency sign; the number is read as pounds.
const BARE_PRICE = /\b(?:cost|costs|costing|price|priced|charge|charges|fee|fees|rate)\b[^.?!\d£]{0,25}?\b(\d{2,6})(?:\.(\d{2}))?\b(?!\s?(?:%|percent|minutes?|mins?|hours?|hrs?|days?|am|pm|years?|months?|weeks?|p\b|pounds?|quid|gbp))/gi;
const BOOKING_CLAIM = /\b(?:you'?re|you are|you have been|you've been|i'?ve|we'?ve|it'?s|is now|all)\s+(?:been\s+)?(?:booked|confirmed|scheduled)\b|\bbooking (?:is|has been) (?:confirmed|made)\b/i;
const NEGOTIATION = [
  /\b\d+\s?(?:%|percent)\s*(?:off|discount)/i,
  /\b(?:i|we)\s+(?:can|could|will|'ll)\b[^.?!]{0,40}\b(?:discount|reduce|knock|lower|cheaper|match|deal)\b/i,
  /\bspecial\s+(?:price|offer|deal)\s+(?:for|just)\s+you\b/i,
];
const INTERNAL_ID = /\b(?:tnt|cnv|msg|slot|bkg|pa|clm|cor|per|wac|job|cred)_[a-z0-9]{6,}/i;
const PHONE_CANDIDATE = /\+?\d[\d\s()-]{8,}\d/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

const toPence = (pounds: string, pence: string | undefined): number =>
  Number(pounds.replaceAll(',', '')) * 100 + (pence ? Number(pence.padEnd(2, '0')) : 0);

export const extractAmountsPence = (text: string): number[] => {
  const amounts: number[] = [];
  for (const pattern of [POUND_AMOUNT, WORDED_AMOUNT, GBP_PREFIX_AMOUNT]) {
    for (const match of text.matchAll(pattern)) amounts.push(toPence(match[1] ?? '0', match[2]));
  }
  for (const match of text.matchAll(PENCE_AMOUNT)) amounts.push(Number(match[1]));
  for (const match of text.matchAll(BARE_PRICE)) amounts.push(toPence(match[1] ?? '0', match[2]));
  return amounts;
};

export const normalisePhoneDigits = (text: string): string => {
  const digits = text.replace(/\D/g, '');
  return digits.startsWith('0') ? `44${digits.slice(1)}` : digits;
};

type Script = 'latin' | 'arabic' | 'gurmukhi' | 'devanagari' | 'none';

export const dominantScript = (text: string): Script => {
  const counts: Record<Exclude<Script, 'none'>, number> = { latin: 0, arabic: 0, gurmukhi: 0, devanagari: 0 };
  for (const character of text) {
    if (/\p{Script=Latin}/u.test(character)) counts.latin += 1;
    else if (/\p{Script=Arabic}/u.test(character)) counts.arabic += 1;
    else if (/\p{Script=Gurmukhi}/u.test(character)) counts.gurmukhi += 1;
    else if (/\p{Script=Devanagari}/u.test(character)) counts.devanagari += 1;
  }
  const [script, count] = Object.entries(counts).sort((left, right) => right[1] - left[1])[0] ?? ['none', 0];
  return count > 0 ? (script as Script) : 'none';
};

const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];

const sharesLongRun = (reply: string, protectedText: string): boolean => {
  const replyText = ` ${words(reply).join(' ')} `;
  const protectedWords = words(protectedText);
  for (let index = 0; index + PROMPT_OVERLAP_WORDS <= protectedWords.length; index += 1) {
    if (replyText.includes(` ${protectedWords.slice(index, index + PROMPT_OVERLAP_WORDS).join(' ')} `)) return true;
  }
  return false;
};

// Enforced in code before any AI text leaves the platform; the prompt asks for the same, but is not trusted.
export const checkReply = (input: ReplyCheckInput): ReplyProblem[] => {
  const problems = new Set<ReplyProblem>();
  const reply = input.reply.trim();
  if (!reply) return ['empty'];
  if (reply.length > MAX_REPLY_LENGTH) problems.add('too_long');

  for (const amount of extractAmountsPence(reply)) {
    if (!input.approvedPricesPence.has(amount)) problems.add('unapproved_price');
  }
  if (OTHER_CURRENCY.test(reply) || NUMBER_WORD_PRICE.test(reply)) problems.add('unverifiable_price');
  if (NEGOTIATION.some((pattern) => pattern.test(reply))) problems.add('negotiation');
  if (BOOKING_CLAIM.test(reply)) problems.add('unconfirmed_booking_claim');

  if (reply.includes(input.canary) || sharesLongRun(reply, input.protectedPromptText)) problems.add('prompt_leak');
  if (INTERNAL_ID.test(reply)) problems.add('internal_identifier');

  for (const match of reply.matchAll(PHONE_CANDIDATE)) {
    const digits = normalisePhoneDigits(match[0]);
    if (digits.length >= 10 && digits.length <= 15 && !input.allowedPhoneDigits.has(digits)) problems.add('unknown_phone_number');
  }
  for (const match of reply.matchAll(EMAIL)) {
    if (!input.allowedEmails.has(match[0].toLowerCase())) problems.add('unknown_email');
  }

  const customerScript = dominantScript(input.customerText);
  const replyScript = dominantScript(reply);
  if (customerScript !== 'none' && replyScript !== 'none' && customerScript !== replyScript) problems.add('language_mismatch');

  return [...problems];
};
