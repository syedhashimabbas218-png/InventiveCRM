import type { ParseResult } from './types.ts';

type FieldSpec =
  | { type: 'string'; maxLength: number; minLength?: number; pattern?: RegExp; optional?: boolean }
  | { type: 'integer'; min: number; max: number; optional?: boolean }
  | { type: 'enum'; values: readonly string[]; optional?: boolean };

// Rejects unknown keys, so a model cannot smuggle tenant_id, conversation_id or similar into a tool call.
export const strictObject =
  <TValue extends Record<string, unknown>>(spec: Record<string, FieldSpec>) =>
  (input: unknown): ParseResult<TValue> => {
    const value = input ?? {};
    if (typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'arguments must be an object' };
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!(key in spec)) return { ok: false, error: `unknown argument: ${key}` };
    }
    for (const [key, field] of Object.entries(spec) as [string, FieldSpec][]) {
      const fieldValue = record[key];
      if (fieldValue === undefined || fieldValue === null) {
        if (field.optional) continue;
        return { ok: false, error: `missing argument: ${key}` };
      }
      if (field.type === 'string') {
        if (
          typeof fieldValue !== 'string' ||
          fieldValue.length > field.maxLength ||
          fieldValue.trim().length < (field.minLength ?? 1) ||
          (field.pattern && !field.pattern.test(fieldValue))
        ) {
          return { ok: false, error: `invalid argument: ${key}` };
        }
      } else if (field.type === 'integer') {
        if (!Number.isInteger(fieldValue) || (fieldValue as number) < field.min || (fieldValue as number) > field.max) {
          return { ok: false, error: `invalid argument: ${key}` };
        }
      } else if (!field.values.includes(fieldValue as string)) {
        return { ok: false, error: `invalid argument: ${key}` };
      }
    }
    return { ok: true, value: record as TValue };
  };
