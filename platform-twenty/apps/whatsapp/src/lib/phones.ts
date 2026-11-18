const E164 = /^\+[1-9]\d{6,14}$/;

export const isE164 = (value: unknown): value is string => typeof value === 'string' && E164.test(value);

const digitsOf = (value: string) => value.replace(/\D/g, '');

// WhatsApp ids are the international number without "+"; a value that already starts with + or 00 is international too.
export const normalisePhone = (raw: unknown): string | null => {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const text = String(raw).trim();
  if (!text || /\p{L}/u.test(text)) return null;
  const digits = digitsOf(text);
  const international = text.startsWith('+') ? digits : text.startsWith('00') ? digits.slice(2) : digits;
  const candidate = `+${international}`;
  return isE164(candidate) ? candidate : null;
};

export const waIdOf = (e164: string) => e164.replace(/^\+/, '');

type StoredPhone = { number?: string | null; callingCode?: string | null };

// Twenty keeps the national number and the calling code apart. Some countries keep a leading 0 in the national
// number (Italy) and others drop it (UK), so both readings are tried.
export const storedPhoneCandidates = ({ number, callingCode }: StoredPhone) => {
  const text = (number ?? '').trim();
  if (!text) return [];
  if (text.startsWith('+') || text.startsWith('00')) {
    const international = normalisePhone(text);
    return international ? [international] : [];
  }
  const code = digitsOf(callingCode ?? '');
  if (!code) return [];
  const national = digitsOf(text);
  return [...new Set([`+${code}${national}`, `+${code}${national.replace(/^0+/, '')}`])].filter(isE164);
};

export type PersonPhones = {
  primaryPhoneNumber?: string | null;
  primaryPhoneCallingCode?: string | null;
  additionalPhones?: { number?: string | null; callingCode?: string | null }[] | null;
} | null;

export const phonesOf = (phones: PersonPhones) => {
  if (!phones) return [];
  const additional = Array.isArray(phones.additionalPhones) ? phones.additionalPhones : [];
  return [{ number: phones.primaryPhoneNumber, callingCode: phones.primaryPhoneCallingCode }, ...additional].flatMap(storedPhoneCandidates);
};

export const hasPhone = (phones: PersonPhones, e164: string) => phonesOf(phones).includes(e164);

// The number to message a person on: the primary one when it reads as international, otherwise the first that does.
export const primaryPhoneOf = (phones: PersonPhones) => phonesOf(phones)[0] ?? null;

// The last seven digits narrow the database search; the exact comparison happens in code.
export const searchTail = (e164: string) => digitsOf(e164).slice(-7);

export const likeLiteral = (value: string, mode: 'suffix' | 'contains') => {
  const escaped = value.replace(/[\\%_]/g, (character) => `\\${character}`);
  return mode === 'suffix' ? `%${escaped}` : `%${escaped}%`;
};
