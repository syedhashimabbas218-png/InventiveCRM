import { describe, expect, it } from 'vitest';

import { hasPhone, likeLiteral, normalisePhone, phonesOf, primaryPhoneOf, searchTail, storedPhoneCandidates } from 'src/lib/phones';

describe('phone normalisation', () => {
  it('turns WhatsApp ids and international numbers into E.164', () => {
    expect(normalisePhone('447700900123')).toBe('+447700900123');
    expect(normalisePhone('+44 7700 900123')).toBe('+447700900123');
    expect(normalisePhone('0044 (7700) 900-123')).toBe('+447700900123');
    expect(normalisePhone(447700900123)).toBe('+447700900123');
  });

  it('refuses what is not a phone number', () => {
    expect(normalisePhone('')).toBeNull();
    expect(normalisePhone('call me')).toBeNull();
    expect(normalisePhone('12345')).toBeNull();
    expect(normalisePhone('+0123456789')).toBeNull();
    expect(normalisePhone(null)).toBeNull();
  });

  it('reads what Twenty stores: national number plus calling code, with or without the trunk 0', () => {
    expect(storedPhoneCandidates({ number: '7700900123', callingCode: '+44' })).toEqual(['+447700900123']);
    expect(storedPhoneCandidates({ number: '07700 900123', callingCode: '+44' })).toContain('+447700900123');
    expect(storedPhoneCandidates({ number: '0612345678', callingCode: '+39' })).toContain('+390612345678');
    expect(storedPhoneCandidates({ number: '+447700900123', callingCode: '' })).toEqual(['+447700900123']);
    expect(storedPhoneCandidates({ number: '7700900123', callingCode: '' })).toEqual([]);
  });
});

describe('matching a person by phone', () => {
  const person = { primaryPhoneNumber: '7700900111', primaryPhoneCallingCode: '+44', additionalPhones: [{ number: '7700900222', callingCode: '+44' }] };

  it('matches the primary and the additional numbers exactly', () => {
    expect(hasPhone(person, '+447700900111')).toBe(true);
    expect(hasPhone(person, '+447700900222')).toBe(true);
    expect(hasPhone(person, '+447700900333')).toBe(false);
    expect(hasPhone(person, '+17700900111')).toBe(false);
    expect(hasPhone(null, '+447700900111')).toBe(false);
  });

  it('messages the primary number first', () => {
    expect(primaryPhoneOf(person)).toBe('+447700900111');
    expect(primaryPhoneOf({ primaryPhoneNumber: '', primaryPhoneCallingCode: '', additionalPhones: [{ number: '7700900222', callingCode: '+44' }] })).toBe('+447700900222');
    expect(phonesOf({ primaryPhoneNumber: '7700900111', primaryPhoneCallingCode: null, additionalPhones: null })).toEqual([]);
  });

  it('narrows the database search safely', () => {
    expect(searchTail('+447700900123')).toBe('0900123');
    expect(likeLiteral('0900123', 'suffix')).toBe('%0900123');
    expect(likeLiteral('50%_off\\', 'contains')).toBe('%50\\%\\_off\\\\%');
  });
});
