export type Escalation = 'emergency' | 'complaint' | 'refund' | 'price_dispute';

// Deterministic and deliberately broad: a false alarm costs a human glance, a miss can cost much more.
const EMERGENCY_PATTERNS = [
  /\bgas\s+leak/i,
  /\bsmell(?:s|ing)?\s+(?:of\s+)?gas\b/i,
  /\bcarbon\s+monoxide\b/i,
  /\bco\s+alarm\b/i,
  /\bfire\b/i,
  /\bon\s+fire\b/i,
  /\bsmoke\b/i,
  /\bflood(?:ing|ed)?\b/i,
  /\bburst\s+pipe/i,
  /\bwater\s+(?:is\s+)?(?:pouring|gushing|everywhere)/i,
  /\bsparks?\b|\bsparking\b/i,
  /\belectric(?:al)?\s+shock/i,
  /\bcan'?t\s+breathe\b/i,
  /\bchest\s+pain/i,
  /\bunconscious\b/i,
  /\bbleeding\b/i,
  /\bemergency\b/i,
  // Roman Urdu / Urdu: "gas ki boo" (smell of gas), "aag" and "آگ" (fire), "گیس" (gas). Needs native-speaker review.
  /\bgas\s+(?:ki\s+)?(?:boo|bu|bo|smell)\b/i,
  /\baag\b/i,
  /آگ|گیس/,
];

const COMPLAINT_PATTERNS = [/\bcomplain(?:t|ts|ing)?\b/i, /\bunhappy\b/i, /\bnot\s+(?:at\s+all\s+)?happy\b/i, /\bworst\b/i, /\bterrible\s+(?:service|job|work)\b/i, /\bombudsman\b/i, /\btrading\s+standards\b/i, /\bsolicitor\b/i, /\bsue\b/i];
const REFUND_PATTERNS = [/\brefund/i, /\bmoney\s+back\b/i, /\bchargeback\b/i];
const PRICE_DISPUTE_PATTERNS = [/\bover\s?charged?\b/i, /\brip(?:ped)?\s?-?off\b/i, /\bwrong\s+(?:price|amount|bill|invoice)\b/i, /\bdispute\b/i];

export const classifyEscalation = (text: string): Escalation | undefined => {
  if (EMERGENCY_PATTERNS.some((pattern) => pattern.test(text))) return 'emergency';
  if (REFUND_PATTERNS.some((pattern) => pattern.test(text))) return 'refund';
  if (PRICE_DISPUTE_PATTERNS.some((pattern) => pattern.test(text))) return 'price_dispute';
  if (COMPLAINT_PATTERNS.some((pattern) => pattern.test(text))) return 'complaint';
  return undefined;
};

export const DEFAULT_EMERGENCY_MESSAGE =
  'This sounds urgent. If anyone is in danger, call 999 now. If you smell gas, leave the property and call the gas emergency line on 0800 111 999. I have alerted the team.';

export const DEFAULT_HANDOFF_MESSAGE = 'Thanks, I have passed this to the team and someone will get back to you as soon as they can.';
