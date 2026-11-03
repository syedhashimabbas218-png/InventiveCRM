import { randomBytes } from 'node:crypto';

export type IdPrefix = 'tnt' | 'cor' | 'cnv' | 'msg' | 'att' | 'wac' | 'job' | 'clm' | 'pa' | 'slot' | 'bkg' | 'cred' | 'kb' | 'pb';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export const newId = (prefix: IdPrefix): string => {
  const bytes = randomBytes(20);
  let suffix = '';
  for (const byte of bytes) {
    suffix += ALPHABET[byte % ALPHABET.length];
  }
  return `${prefix}_${suffix}`;
};

export const TENANT_ID_PATTERN = /^tnt_[A-Za-z0-9]{8,64}$/;
export const CORRELATION_ID_PATTERN = /^cor_[A-Za-z0-9]{8,64}$/;
