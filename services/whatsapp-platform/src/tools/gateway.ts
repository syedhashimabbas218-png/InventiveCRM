import { writeAudit } from '../audit/audit-log.ts';
import { withTenant } from '../db/pool.ts';
import type { ActorType } from '../envelope/envelope.ts';
import { newId, TENANT_ID_PATTERN } from '../shared/ids.ts';
import {
  ToolError,
  type ToolCallResult,
  type ToolContext,
  type ToolDefinition,
  type ToolRuntime,
} from './types.ts';

const CONFIRM_PREFIX = 'confirm:';
const DECLINE_PREFIX = 'decline:';

export const parseConfirmationReply = (
  replyId: string,
): { decision: 'confirm' | 'decline'; pendingActionId: string } | undefined => {
  if (replyId.startsWith(CONFIRM_PREFIX)) return { decision: 'confirm', pendingActionId: replyId.slice(CONFIRM_PREFIX.length) };
  if (replyId.startsWith(DECLINE_PREFIX)) return { decision: 'decline', pendingActionId: replyId.slice(DECLINE_PREFIX.length) };
  return undefined;
};

type PendingActionRow = {
  id: string;
  conversation_id: string;
  tool: string;
  params: Record<string, unknown>;
  summary: string;
  status: string;
  created_at: Date;
  expires_at: Date;
};

const summariseForAudit = (value: unknown): Record<string, unknown> => {
  const text = JSON.stringify(value) ?? 'null';
  return text.length > 2000 ? { truncated: text.slice(0, 2000) } : { value: JSON.parse(text) };
};

export class ToolGateway {
  private readonly tools: Map<string, ToolDefinition>;

  constructor(
    private readonly runtime: ToolRuntime,
    tools: readonly ToolDefinition[],
    private readonly allowlist: Readonly<Record<ActorType, ReadonlySet<string>>>,
  ) {
    this.tools = new Map(tools.map((tool) => [tool.name, tool]));
  }

  // Only tools this actor may use are ever shown to the model.
  listFor(actorType: ActorType): ToolDefinition[] {
    return [...this.tools.values()].filter(
      (tool) => this.allowlist[actorType].has(tool.name) && tool.permissionClass !== 'internal_approval',
    );
  }

  async call(context: ToolContext, name: string, rawInput: unknown): Promise<ToolCallResult> {
    if (!TENANT_ID_PATTERN.test(context.tenantId)) throw new Error('tool context has no valid tenant');
    const now = this.runtime.clock();
    const audit = (decision: 'allowed' | 'denied' | 'error', action: string, details: Record<string, unknown>) =>
      writeAudit(this.runtime.database, {
        tenantId: context.tenantId,
        actor: context.actor,
        correlationId: context.correlationId,
        action,
        target: context.conversationId,
        decision,
        details,
        occurredAt: now,
      });

    const tool = this.tools.get(name);
    if (!tool) {
      await audit('denied', `tool:${name.slice(0, 64)}`, { reason: 'unknown_tool' });
      return { status: 'denied', reason: 'unknown_tool' };
    }
    if (!this.allowlist[context.actor.type].has(name) || tool.permissionClass === 'internal_approval') {
      await audit('denied', `tool:${name}`, { reason: 'not_permitted', permission_class: tool.permissionClass });
      return { status: 'denied', reason: 'not_permitted' };
    }

    const parsed = tool.parse(rawInput);
    if (!parsed.ok) {
      await audit('denied', `tool:${name}`, { reason: 'invalid_input', error: parsed.error, input: summariseForAudit(rawInput) });
      return { status: 'denied', reason: 'invalid_input', details: parsed.error };
    }

    if (tool.permissionClass === 'customer_confirmed' || tool.permissionClass === 'staff_approval') {
      return this.propose(context, tool, parsed.value, audit);
    }

    try {
      const output = await tool.execute(this.runtime, context, parsed.value);
      await audit('allowed', `tool:${name}`, { input: summariseForAudit(parsed.value), output: summariseForAudit(output) });
      return { status: 'ok', output };
    } catch (error) {
      await audit('error', `tool:${name}`, { input: summariseForAudit(parsed.value), error: (error as Error).message });
      return { status: 'failed', reason: error instanceof ToolError ? error.message : 'tool_unavailable' };
    }
  }

  private async propose(
    context: ToolContext,
    tool: ToolDefinition,
    input: Record<string, unknown>,
    audit: (decision: 'allowed' | 'denied' | 'error', action: string, details: Record<string, unknown>) => Promise<void>,
  ): Promise<ToolCallResult> {
    if (!tool.prepare) throw new Error(`${tool.name} needs a prepare step`);
    const prepared = await tool.prepare(this.runtime, context, input);
    if (!prepared.ok) {
      await audit('denied', `tool:${tool.name}:propose`, { reason: prepared.reason, input: summariseForAudit(input) });
      return { status: 'failed', reason: prepared.reason };
    }
    const awaitingStaff = tool.permissionClass === 'staff_approval';
    const pendingActionId = newId('pa');
    await withTenant(this.runtime.database, context.tenantId, (client) =>
      client.query(
        `INSERT INTO pending_actions (id, tenant_id, conversation_id, tool, params, summary, status, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          pendingActionId,
          context.tenantId,
          context.conversationId,
          tool.name,
          prepared.params,
          prepared.summary,
          awaitingStaff ? 'awaiting_staff' : 'awaiting_customer',
          this.runtime.clock(),
          prepared.expiresAt,
        ],
      ),
    );
    await audit('allowed', `tool:${tool.name}:propose`, { pending_action_id: pendingActionId, params: prepared.params });

    if (awaitingStaff) {
      await this.runtime.ownerNotifier.alert({
        tenantId: context.tenantId,
        conversationId: context.conversationId,
        kind: 'handoff',
        message: `Approval needed: ${prepared.summary}`,
      });
      return { status: 'needs_staff_approval', pendingActionId };
    }
    return {
      status: 'needs_customer_confirmation',
      confirmation: {
        pendingActionId,
        summary: prepared.summary,
        buttons: [
          { id: `${CONFIRM_PREFIX}${pendingActionId}`, title: 'Confirm' },
          { id: `${DECLINE_PREFIX}${pendingActionId}`, title: 'Change' },
        ],
      },
    };
  }

  // Runs a customer-confirmed action with the parameters stored when it was proposed, never new model input.
  async resolveConfirmation(
    context: ToolContext,
    replyId: string,
    confirmingMessageId: string,
  ): Promise<ToolCallResult | undefined> {
    const reply = parseConfirmationReply(replyId);
    if (!reply) return undefined;
    const now = this.runtime.clock();

    const claimed = await withTenant(this.runtime.database, context.tenantId, async (client) => {
      const message = (
        await client.query<{ received_at: Date }>(
          `SELECT received_at FROM messages
           WHERE tenant_id = $1 AND id = $2 AND conversation_id = $3 AND direction = 'inbound' AND sender_identity = $4`,
          [context.tenantId, confirmingMessageId, context.conversationId, context.customerIdentity],
        )
      ).rows[0];
      if (!message) return { error: 'confirmation_not_from_this_customer' } as const;

      const action = (
        await client.query<PendingActionRow>(
          'SELECT * FROM pending_actions WHERE tenant_id = $1 AND id = $2 AND conversation_id = $3 FOR UPDATE',
          [context.tenantId, reply.pendingActionId, context.conversationId],
        )
      ).rows[0];
      if (!action) return { error: 'unknown_confirmation' } as const;
      if (action.status !== 'awaiting_customer') return { error: `already_${action.status}` } as const;
      if (action.created_at > message.received_at) return { error: 'confirmation_predates_offer' } as const;
      if (action.expires_at <= now) {
        await client.query("UPDATE pending_actions SET status = 'expired' WHERE tenant_id = $1 AND id = $2", [context.tenantId, action.id]);
        return { error: 'confirmation_expired' } as const;
      }
      const nextStatus = reply.decision === 'confirm' ? 'executed' : 'declined';
      await client.query(
        'UPDATE pending_actions SET status = $3, confirmed_by_message_id = $4 WHERE tenant_id = $1 AND id = $2',
        [context.tenantId, action.id, nextStatus, confirmingMessageId],
      );
      return { action } as const;
    });

    const auditBase = {
      tenantId: context.tenantId,
      actor: context.actor,
      correlationId: context.correlationId,
      target: context.conversationId,
      occurredAt: now,
    };
    if ('error' in claimed) {
      await writeAudit(this.runtime.database, {
        ...auditBase,
        action: 'tool:confirmation',
        decision: 'denied',
        details: { reason: claimed.error, reply_id: replyId },
      });
      return { status: 'failed', reason: claimed.error ?? 'unknown_confirmation' };
    }
    const { action } = claimed;
    if (reply.decision === 'decline') {
      await writeAudit(this.runtime.database, { ...auditBase, action: `tool:${action.tool}:declined`, decision: 'allowed', details: { pending_action_id: action.id } });
      return { status: 'ok', output: { declined: true, summary: action.summary } };
    }

    const tool = this.tools.get(action.tool);
    if (!tool || !this.allowlist[context.actor.type].has(tool.name)) {
      return { status: 'denied', reason: 'not_permitted' };
    }
    try {
      const output = await tool.execute(this.runtime, context, action.params);
      await withTenant(this.runtime.database, context.tenantId, (client) =>
        client.query('UPDATE pending_actions SET result = $3 WHERE tenant_id = $1 AND id = $2', [context.tenantId, action.id, output ?? null]),
      );
      await writeAudit(this.runtime.database, {
        ...auditBase,
        action: `tool:${tool.name}:confirmed`,
        decision: 'allowed',
        details: { pending_action_id: action.id, params: action.params, output: summariseForAudit(output) },
      });
      return { status: 'ok', output };
    } catch (error) {
      await withTenant(this.runtime.database, context.tenantId, (client) =>
        client.query("UPDATE pending_actions SET status = 'failed' WHERE tenant_id = $1 AND id = $2", [context.tenantId, action.id]),
      );
      await writeAudit(this.runtime.database, {
        ...auditBase,
        action: `tool:${tool.name}:confirmed`,
        decision: 'error',
        details: { pending_action_id: action.id, error: (error as Error).message },
      });
      return { status: 'failed', reason: error instanceof ToolError ? error.message : 'tool_unavailable' };
    }
  }
}
