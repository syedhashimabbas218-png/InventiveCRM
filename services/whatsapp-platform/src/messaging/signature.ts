import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/;

// Meta signs the body exactly as sent (non-ASCII already \u-escaped), so the HMAC must use the raw bytes.
export const isValidWebhookSignature = (appSecret: string, rawBody: Buffer, header: string | undefined): boolean => {
  if (!appSecret || !header) {
    return false;
  }
  const match = SIGNATURE_PATTERN.exec(header);
  if (!match?.[1]) {
    return false;
  }
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const received = Buffer.from(match[1], 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
};

export const signWebhookBody = (appSecret: string, rawBody: Buffer | string): string =>
  `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
