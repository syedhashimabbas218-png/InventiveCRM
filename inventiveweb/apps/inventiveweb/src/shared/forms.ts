export const FIELD_TYPES = ['text', 'textarea', 'email', 'phone', 'number', 'date', 'select', 'checkbox'] as const;
export type FieldKind = (typeof FIELD_TYPES)[number];
export type Answer = string | number | boolean;
export type FormField = {
  key: string;
  label: string;
  type: FieldKind;
  required: boolean;
  visibility: 'customer' | 'staff';
  options?: string[];
  condition?: { field: string; equals: Answer };
};
export type FormSchema = { schemaVersion: 1; fields: FormField[] };

const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (message: string): never => { throw new Error(message); };

// The same bounded parser runs in the front component and the authenticated logic function.
export function parseFormSchema(input: unknown): FormSchema {
  if (!record(input) || input.schemaVersion !== 1 || !Array.isArray(input.fields)) return fail('Unsupported form definition.');
  if (input.fields.length > 60) return fail('A form can contain at most 60 fields.');
  const prior = new Map<string, FormField>();
  const fields = input.fields.map((item: unknown): FormField => {
    if (!record(item)) return fail('Invalid field.');
    const { key, label, type, required, visibility } = item;
    if (typeof key !== 'string' || !/^[a-z][a-zA-Z0-9_]{0,63}$/.test(key) || forbiddenKeys.has(key) || prior.has(key)) return fail('Field keys must be unique, safe identifiers.');
    if (typeof label !== 'string' || !label.trim() || label.length > 160) return fail(`Invalid label for ${key}.`);
    if (!FIELD_TYPES.includes(type as FieldKind)) return fail(`Unsupported type for ${key}.`);
    if (typeof required !== 'boolean' || !['customer', 'staff'].includes(String(visibility))) return fail(`Invalid rules for ${key}.`);
    const field: FormField = { key, label: label.trim(), type: type as FieldKind, required, visibility: visibility as FormField['visibility'] };
    if (type === 'select') {
      if (!Array.isArray(item.options) || !item.options.length || item.options.length > 100) return fail(`Add 1–100 options for ${key}.`);
      const options = item.options.map((v: unknown) => typeof v === 'string' && v.trim() && v.length <= 160 ? v.trim() : fail(`Invalid option for ${key}.`));
      if (new Set(options).size !== options.length) return fail(`Duplicate options for ${key}.`);
      field.options = options;
    }
    if (item.condition !== undefined) {
      const condition = item.condition;
      if (!record(condition) || typeof condition.field !== 'string') return fail(`Invalid condition for ${key}.`);
      const parent = prior.get(condition.field);
      if (!parent || parent.condition) return fail('Conditions must reference an earlier, unconditional field.');
      if (visibility === 'customer' && parent.visibility !== 'customer') return fail('Customer fields cannot depend on staff fields.');
      const eq = condition.equals;
      if (!['string', 'number', 'boolean'].includes(typeof eq) || (typeof eq === 'number' && !Number.isFinite(eq))) return fail('Invalid condition value.');
      if (parent.type === 'checkbox' && typeof eq !== 'boolean') return fail('Checkbox conditions require true or false.');
      if (parent.type === 'number' && typeof eq !== 'number') return fail('Number conditions require a number.');
      if (!['checkbox', 'number'].includes(parent.type) && typeof eq !== 'string') return fail('Text conditions require text.');
      if (parent.type === 'select' && !parent.options?.includes(eq as string)) return fail('Condition must match an available option.');
      field.condition = { field: condition.field, equals: eq as Answer };
    }
    prior.set(key, field);
    return field;
  });
  return { schemaVersion: 1, fields };
}

export function visibleFields(schema: FormSchema, answers: Record<string, unknown>, audience: 'customer' | 'staff') {
  return schema.fields.filter(field => (audience === 'staff' || field.visibility === 'customer') &&
    (!field.condition || answers[field.condition.field] === field.condition.equals));
}

export function validateAnswers(schema: FormSchema, input: unknown, audience: 'customer' | 'staff') {
  if (!record(input)) return fail('Answers must be an object.');
  const answers: Record<string, Answer> = {};
  const errors: Record<string, string> = {};
  for (const field of visibleFields(schema, input, audience)) {
    const value = input[field.key];
    const empty = value === undefined || value === null || (typeof value === 'string' && !value.trim());
    if (empty) { if (field.required) errors[field.key] = 'Required'; continue; }
    if (field.type === 'checkbox') {
      if (typeof value !== 'boolean') errors[field.key] = 'Choose yes or no';
      else if (field.required && !value) errors[field.key] = 'Must be checked';
      else answers[field.key] = value;
    } else if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) errors[field.key] = 'Enter a finite number';
      else answers[field.key] = value;
    } else if (typeof value !== 'string' || value.length > 5000) {
      errors[field.key] = 'Enter text of at most 5,000 characters';
    } else {
      const text = value.trim();
      if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) errors[field.key] = 'Enter a valid email';
      else if (field.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0,10) !== text)) errors[field.key] = 'Enter a valid date';
      else if (field.type === 'select' && !field.options?.includes(text)) errors[field.key] = 'Choose an available option';
      else answers[field.key] = text;
    }
  }
  // Drop unknown, hidden and staff-only answers rather than trusting a client submission.
  return { valid: Object.keys(errors).length === 0, answers, errors };
}

export const EMPTY_FORM: FormSchema = { schemaVersion: 1, fields: [] };
