import type { Database } from '../db/pool.ts';
import type { Actor } from '../envelope/envelope.ts';
import type { CalendarClient } from '../interfaces/calendar.ts';
import type { CrmClient } from '../interfaces/crm.ts';
import type { EventBus } from '../interfaces/event-bus.ts';
import type { OwnerNotifier } from '../interfaces/owner-notifier.ts';
import type { Clock } from '../shared/clock.ts';

// Plan 7.4: read; low-risk reversible; customer-impacting (needs confirmation); financial/destructive
// (staff approval); system/deployment (internal approval, never available to the agent).
export type PermissionClass = 'read' | 'low_risk_write' | 'customer_confirmed' | 'staff_approval' | 'internal_approval';

// Built by the server from the conversation row. Nothing in it comes from the model or the customer.
export type ToolContext = {
  tenantId: string;
  conversationId: string;
  customerIdentity: string;
  crmPersonId: string | null;
  actor: Actor;
  correlationId: string;
};

export type ToolRuntime = {
  database: Database;
  crm: CrmClient;
  calendar: CalendarClient;
  eventBus: EventBus;
  ownerNotifier: OwnerNotifier;
  clock: Clock;
};

export type ParseResult<TValue> = { ok: true; value: TValue } | { ok: false; error: string };

export type PreparedAction = { ok: true; params: Record<string, unknown>; summary: string; expiresAt: Date } | { ok: false; reason: string };

// Expected, explainable failures (slot gone, booking not yours). Shown to the model as a tool error.
export class ToolError extends Error {}

export type ToolDefinition<TInput = Record<string, unknown>> = {
  name: string;
  description: string;
  permissionClass: PermissionClass;
  parameters: Record<string, unknown>;
  parse: (input: unknown) => ParseResult<TInput>;
  prepare?: (runtime: ToolRuntime, context: ToolContext, input: TInput) => Promise<PreparedAction>;
  execute: (runtime: ToolRuntime, context: ToolContext, params: Record<string, unknown>) => Promise<unknown>;
};

export type ConfirmationRequest = {
  pendingActionId: string;
  summary: string;
  buttons: { id: string; title: string }[];
};

export type ToolCallResult =
  | { status: 'ok'; output: unknown }
  | { status: 'needs_customer_confirmation'; confirmation: ConfirmationRequest }
  | { status: 'needs_staff_approval'; pendingActionId: string }
  | { status: 'denied'; reason: 'unknown_tool' | 'not_permitted' | 'invalid_input'; details?: string }
  | { status: 'failed'; reason: string };

// Lets tools with different input types live in one registry; the input is always the tool's own parse output.
export const registerTool = <TInput extends Record<string, unknown>>(definition: ToolDefinition<TInput>): ToolDefinition => {
  const { prepare } = definition;
  return {
    ...definition,
    parse: (input) => definition.parse(input),
    prepare: prepare ? (runtime, context, input) => prepare(runtime, context, input as TInput) : undefined,
  };
};
