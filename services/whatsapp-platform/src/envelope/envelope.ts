import { CORRELATION_ID_PATTERN, TENANT_ID_PATTERN } from '../shared/ids.ts';

export type ActorType = 'user' | 'agent' | 'system';

export type Actor = {
  type: ActorType;
  id: string;
};

export type Envelope<TPayload> = {
  tenant_id: string;
  actor: Actor;
  correlation_id: string;
  idempotency_key: string;
  occurred_at: string;
  payload: TPayload;
};

export type EnvelopeParseResult<TPayload> =
  | { ok: true; envelope: Envelope<TPayload> }
  | { ok: false; errors: string[] };

const ACTOR_TYPES: readonly ActorType[] = ['user', 'agent', 'system'];
const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const ENVELOPE_KEYS = new Set(['tenant_id', 'actor', 'correlation_id', 'idempotency_key', 'occurred_at', 'payload']);
const MAX_ID_LENGTH = 200;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isBoundedString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;

export const parseEnvelope = <TPayload = Record<string, unknown>>(
  input: unknown,
): EnvelopeParseResult<TPayload> => {
  if (!isPlainObject(input)) {
    return { ok: false, errors: ['envelope must be an object'] };
  }

  const errors: string[] = [];

  for (const key of Object.keys(input)) {
    if (!ENVELOPE_KEYS.has(key)) {
      errors.push(`unknown field: ${key}`);
    }
  }

  if (typeof input.tenant_id !== 'string' || !TENANT_ID_PATTERN.test(input.tenant_id)) {
    errors.push('tenant_id is missing or malformed');
  }

  const actor = input.actor;
  if (!isPlainObject(actor)) {
    errors.push('actor must be an object');
  } else {
    if (!ACTOR_TYPES.includes(actor.type as ActorType)) {
      errors.push('actor.type must be user, agent or system');
    }
    if (!isBoundedString(actor.id)) {
      errors.push('actor.id is missing or too long');
    }
  }

  if (typeof input.correlation_id !== 'string' || !CORRELATION_ID_PATTERN.test(input.correlation_id)) {
    errors.push('correlation_id is missing or malformed');
  }

  if (!isBoundedString(input.idempotency_key)) {
    errors.push('idempotency_key is missing or too long');
  }

  if (
    typeof input.occurred_at !== 'string' ||
    !ISO_8601_PATTERN.test(input.occurred_at) ||
    Number.isNaN(Date.parse(input.occurred_at))
  ) {
    errors.push('occurred_at must be an ISO-8601 timestamp with a timezone');
  }

  if (!isPlainObject(input.payload)) {
    errors.push('payload must be an object');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, envelope: input as unknown as Envelope<TPayload> };
};
