import { gql, nodes } from 'src/lib/api';
import { functionsBaseUrl } from 'src/lib/engine';
import { resendKey, webhookSigningSecret } from 'src/lib/resend';
import { saveBrand } from 'src/lib/store';
import { openText, sealText, verifySvixSignature, webhookToken } from 'src/lib/tokens';

const CONTEXT = 'resend-signing-secret';

export const webhookUrl = async () => `${await functionsBaseUrl()}/campaigns/webhook/${webhookToken()}`;

// A bad signature must not make us ask Resend again each time: anyone holding the URL could spend the account's API
// quota. A rotated secret is therefore picked up after at most this long, and Resend retries what was refused.
const REFETCH_AFTER_MS = 10 * 60_000;

type Known = { secret: string | null; fetchedAt: number };

const known = async (): Promise<Known | null> => {
  const row = nodes((await gql<{ campaignBrands: { edges: { node: { trackingKey: string | null } }[] } }>(`{ campaignBrands(orderBy: [{ createdAt: AscNullsLast }], first: 1) { edges { node { id trackingKey } } } }`)).campaignBrands)[0];
  const opened = openText(row?.trackingKey, CONTEXT);
  if (!opened) return null;
  try {
    const parsed = JSON.parse(opened) as Partial<Known>;
    return typeof parsed.fetchedAt === 'number' ? { secret: typeof parsed.secret === 'string' ? parsed.secret : null, fetchedAt: parsed.fetchedAt } : null;
  } catch {
    return null;
  }
};

const refetch = async (): Promise<Known> => {
  const key = await resendKey();
  const secret = key ? await webhookSigningSecret(key, await webhookUrl()) : null;
  const fresh = { secret, fetchedAt: Date.now() };
  await saveBrand({ trackingKey: sealText(JSON.stringify(fresh), CONTEXT) });
  return fresh;
};

export type SignatureCheck = 'VALID' | 'INVALID' | 'UNAVAILABLE';

export const checkResendSignature = async (rawBody: string, headers: Record<string, string | undefined>): Promise<SignatureCheck> => {
  const id = headers['svix-id'];
  const timestamp = headers['svix-timestamp'];
  const signatures = headers['svix-signature'];
  if (!id || !timestamp || !signatures) return 'INVALID';
  const matches = (candidate: Known | null) => Boolean(candidate?.secret && verifySvixSignature(candidate.secret, id, timestamp, signatures, rawBody));
  const current = await known();
  if (matches(current)) return 'VALID';
  if (current && Date.now() - current.fetchedAt < REFETCH_AFTER_MS) return 'INVALID';
  try {
    return matches(await refetch()) ? 'VALID' : 'INVALID';
  } catch (error) {
    console.error(`resend webhook: the signing secret could not be read: ${(error as Error).message}`);
    return 'UNAVAILABLE';
  }
};
