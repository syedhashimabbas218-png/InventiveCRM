import type { TemplatePolicy } from '../conversations/send.ts';
import { ACTIVE_PHASE, findTemplate } from './library.ts';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const templatePolicy: TemplatePolicy = async (client, { conversation, template, now }) => {
  const definition = findTemplate(template.name, template.language_code);
  if (!definition || definition.phase > ACTIVE_PHASE) {
    return { status: 422, body: { reason: 'template_not_allowed', errors: ['template is not in the active library'] } };
  }

  const parameters = template.parameters ?? {};
  const names = Object.keys(parameters);
  const errors: string[] = [];
  if (names.length !== definition.parameters.length || !definition.parameters.every((name) => names.includes(name))) {
    errors.push(`parameters must be exactly: ${definition.parameters.join(', ')}`);
  }
  for (const value of Object.values(parameters)) {
    // Meta rejects parameter text with newlines, tabs or more than four consecutive spaces.
    if (!value.trim() || /[\n\t]| {5,}/.test(value) || value.length > 200) errors.push('parameter values must be short single-line text');
  }
  if ((template.quick_reply_payloads ?? []).length !== definition.quick_replies.length) {
    errors.push(`expected ${definition.quick_replies.length} quick reply payloads`);
  }
  if (errors.length) return { status: 422, body: { reason: 'template_not_allowed', errors } };

  const approval = (
    await client.query<{ status: string }>(
      'SELECT status FROM whatsapp_templates WHERE tenant_id = $1 AND name = $2 AND language = $3',
      [client.tenantId, definition.name, definition.language],
    )
  ).rows[0];
  if (approval?.status !== 'approved') {
    return { status: 422, body: { reason: 'template_not_allowed', errors: ['template is not approved for this number'] } };
  }

  const contact = (
    await client.query<{ opted_out_at: Date | null; consent_at: Date | null }>(
      'SELECT opted_out_at, consent_at FROM customer_contacts WHERE tenant_id = $1 AND customer_identity = $2',
      [client.tenantId, conversation.customer_identity],
    )
  ).rows[0];
  if (contact?.opted_out_at) return { status: 409, body: { reason: 'opted_out' } };
  if (definition.category === 'marketing' && !contact?.consent_at) return { status: 409, body: { reason: 'opted_out' } };

  if (definition.counts_toward_weekly_cap) {
    const counted = (
      await client.query<{ count: string }>(
        `SELECT count(*) AS count FROM messages m
         JOIN conversations c ON c.tenant_id = m.tenant_id AND c.id = m.conversation_id
         WHERE m.tenant_id = $1 AND c.customer_identity = $2 AND m.direction = 'outbound'
           AND m.message_type = 'template' AND m.received_at > $3`,
        [client.tenantId, conversation.customer_identity, new Date(now.getTime() - WEEK_MS)],
      )
    ).rows[0];
    const cap = (
      await client.query<{ max_template_messages_per_customer_per_week: number }>(
        'SELECT max_template_messages_per_customer_per_week FROM tenant_settings WHERE tenant_id = $1',
        [client.tenantId],
      )
    ).rows[0];
    if (Number(counted?.count ?? 0) >= (cap?.max_template_messages_per_customer_per_week ?? 0)) {
      return { status: 429, body: { reason: 'template_cap_reached' } };
    }
  }
  return undefined;
};
