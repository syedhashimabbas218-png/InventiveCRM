import type { TenantClient } from '../db/pool.ts';
import type { ConversationRow } from '../conversations/conversation-store.ts';

export type TemplateStatus = 'pending' | 'approved' | 'rejected' | 'paused' | 'disabled';

export type TemplateDefinition = {
  name: string;
  language: string;
  category: 'utility' | 'marketing';
  body: string;
  parameters: string[];
  quick_replies: string[];
};

export type TemplateRow = TemplateDefinition & { status: TemplateStatus; last_event: string | null };

// Meta: body <= 1024 characters, named {{lower_snake}} parameters, quick-reply labels <= 25 alphanumeric characters, <= 10 buttons.
export const validateTemplateDefinition = (template: TemplateDefinition): string[] => {
  const errors: string[] = [];
  if (!/^[a-z0-9_]{1,512}$/.test(template.name)) errors.push('name must be lowercase letters, digits and underscores');
  if (!/^[a-z]{2,3}(?:_[A-Za-z]{2,4})?$/.test(template.language)) errors.push('language must look like en or en_GB');
  if (template.category !== 'utility' && template.category !== 'marketing') errors.push('category must be utility or marketing');
  if (!template.body.trim() || template.body.length > 1024) errors.push('body must be 1-1024 characters');
  const placeholders = [...template.body.matchAll(/\{\{([^}]*)\}\}/g)].map((match) => match[1] ?? '');
  for (const placeholder of placeholders) {
    if (!/^[a-z_]+$/.test(placeholder)) errors.push(`parameter {{${placeholder}}} must be lowercase letters and underscores`);
  }
  if (new Set(placeholders).size !== placeholders.length) errors.push('parameter names must be unique');
  if (placeholders.join(',') !== template.parameters.join(',')) errors.push('parameters must list the body placeholders in order');
  if (template.quick_replies.length > 10) errors.push('at most 10 buttons');
  for (const label of template.quick_replies) {
    if (!/^[A-Za-z0-9 ]{1,25}$/.test(label)) errors.push(`quick reply "${label}" must be 1-25 alphanumeric characters`);
  }
  return errors;
};

// Meta reports languages as en-US in status webhooks and expects en_US when sending.
export const normaliseLanguage = (language: string): string => language.replace('-', '_');

export const upsertTemplate = async (client: TenantClient, template: TemplateDefinition, status: TemplateStatus, now: Date) => {
  await client.query(
    `INSERT INTO whatsapp_templates (tenant_id, name, language, category, body, parameters, quick_replies, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (tenant_id, name, language) DO UPDATE
     SET category = excluded.category, body = excluded.body, parameters = excluded.parameters,
         quick_replies = excluded.quick_replies, status = excluded.status, updated_at = excluded.updated_at`,
    [client.tenantId, template.name, template.language, template.category, template.body, template.parameters, template.quick_replies, status, now],
  );
};

export const listTemplates = async (client: TenantClient): Promise<TemplateRow[]> =>
  (
    await client.query<TemplateRow>(
      `SELECT name, language, category, body, parameters, quick_replies, status, last_event
       FROM whatsapp_templates WHERE tenant_id = $1 ORDER BY name, language`,
      [client.tenantId],
    )
  ).rows;

const STATUS_BY_EVENT: Record<string, TemplateStatus | undefined> = {
  APPROVED: 'approved',
  REINSTATED: 'approved',
  FLAGGED: 'approved',
  PENDING: 'pending',
  IN_APPEAL: 'pending',
  UNARCHIVED: 'pending',
  REJECTED: 'rejected',
  PAUSED: 'paused',
  DISABLED: 'disabled',
  ARCHIVED: 'disabled',
  DELETED: 'disabled',
  PENDING_DELETION: 'disabled',
};

// Unknown events and LOCKED / LIMIT_EXCEEDED are recorded but leave the sendable status unchanged.
export const applyTemplateStatusEvent = async (
  client: TenantClient,
  update: { name: string; language: string; event: string; providerTemplateId?: string },
  now: Date,
): Promise<boolean> => {
  const status = STATUS_BY_EVENT[update.event];
  const result = await client.query(
    `UPDATE whatsapp_templates
     SET status = coalesce($4, status), last_event = $5, provider_template_id = coalesce($6, provider_template_id), updated_at = $7
     WHERE tenant_id = $1 AND name = $2 AND language = $3`,
    [client.tenantId, update.name, normaliseLanguage(update.language), status ?? null, update.event, update.providerTemplateId ?? null, now],
  );
  return (result.rowCount ?? 0) > 0;
};

export type TemplateSendRequest = {
  name: string;
  language_code: string;
  parameters?: Record<string, string>;
  quick_reply_payloads?: string[];
};

export type TemplateRefusal =
  | { status: 422; body: { reason: 'template_not_allowed'; errors: string[] } }
  | { status: 409; body: { reason: 'opted_out' } };

export const checkTemplateSend = async (
  client: TenantClient,
  conversation: ConversationRow,
  request: TemplateSendRequest,
): Promise<TemplateRefusal | undefined> => {
  const template = (
    await client.query<TemplateRow>(
      'SELECT * FROM whatsapp_templates WHERE tenant_id = $1 AND name = $2 AND language = $3',
      [client.tenantId, request.name, request.language_code],
    )
  ).rows[0];
  if (!template) return { status: 422, body: { reason: 'template_not_allowed', errors: ['template is not registered for this client'] } };
  if (template.status !== 'approved') {
    return { status: 422, body: { reason: 'template_not_allowed', errors: [`template status is ${template.status}`] } };
  }

  const parameters = request.parameters ?? {};
  const names = Object.keys(parameters);
  const errors: string[] = [];
  if (names.length !== template.parameters.length || !template.parameters.every((name) => names.includes(name))) {
    errors.push(`parameters must be exactly: ${template.parameters.join(', ') || 'none'}`);
  }
  for (const value of Object.values(parameters)) {
    // Meta rejects parameter text with newlines, tabs or more than four consecutive spaces.
    if (!value.trim() || /[\n\t]| {5,}/.test(value) || value.length > 200) errors.push('parameter values must be short single-line text');
  }
  if ((request.quick_reply_payloads ?? []).length !== template.quick_replies.length) {
    errors.push(`expected ${template.quick_replies.length} quick reply payloads`);
  }
  if (errors.length) return { status: 422, body: { reason: 'template_not_allowed', errors } };

  const contact = (
    await client.query<{ opted_out_at: Date | null; consent_at: Date | null }>(
      'SELECT opted_out_at, consent_at FROM customer_contacts WHERE tenant_id = $1 AND customer_identity = $2',
      [client.tenantId, conversation.customer_identity],
    )
  ).rows[0];
  if (contact?.opted_out_at) return { status: 409, body: { reason: 'opted_out' } };
  if (template.category === 'marketing' && !contact?.consent_at) return { status: 409, body: { reason: 'opted_out' } };
  return undefined;
};
