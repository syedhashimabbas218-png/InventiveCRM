import { randomBytes } from 'node:crypto';
import { withTenant, type Database, type TenantClient } from '../db/pool.ts';
import { claimConversation, releaseClaim } from '../conversations/claim.ts';
import { loadTenantSettings, pauseAi, type TenantSettingsRow } from '../conversations/conversation-store.ts';
import { sendMessage, type SendDependencies, type SendResult } from '../conversations/send.ts';
import type { CrmClient } from '../interfaces/crm.ts';
import type { OwnerNotifier } from '../interfaces/owner-notifier.ts';
import type { MessageContent } from '../messaging/normalised-event.ts';
import type { Clock } from '../shared/clock.ts';
import { newId } from '../shared/ids.ts';
import type { ToolGateway } from '../tools/gateway.ts';
import { HANDOFF_REASONS, formatSlotLabel } from '../tools/phase-one-tools.ts';
import type { ConfirmationRequest, ToolContext } from '../tools/types.ts';
import { classifyEscalation, DEFAULT_EMERGENCY_MESSAGE, DEFAULT_HANDOFF_MESSAGE, type Escalation } from './escalation.ts';
import type { ChatMessage, ModelAdapter, ModelTool } from './model/types.ts';
import { buildRules, buildSystemPrompt } from './prompt.ts';
import { checkReply, normalisePhoneDigits, type ReplyProblem } from './reply-check.ts';

export type AgentDependencies = {
  database: Database;
  clock: Clock;
  gateway: ToolGateway;
  model: ModelAdapter;
  crm: CrmClient;
  ownerNotifier: OwnerNotifier;
  send: SendDependencies;
  maxModelSteps: number;
  maxOutputTokens: number;
  historyLimit: number;
};

export type TurnOutcome =
  | 'sent'
  | 'superseded'
  | 'claim_refused'
  | 'emergency'
  | 'handoff'
  | 'customer_limit'
  | 'token_budget'
  | 'reply_blocked'
  | 'send_refused'
  | 'error';

export type TurnResult = { outcome: TurnOutcome; retryAt?: Date; details?: Record<string, unknown> };

type HistoryRow = {
  id: string;
  direction: 'inbound' | 'outbound' | 'echo';
  sender_type: 'customer' | 'ai' | 'human' | 'system';
  message_type: string;
  body: string | null;
  content: MessageContent | Record<string, never>;
  received_at: Date;
};

type TurnState = {
  tenantId: string;
  conversationId: string;
  messageId: string;
  claimId: string;
  correlationId: string;
  inputTokens: number;
  outputTokens: number;
  model?: string;
  sentMessageId?: string;
  details: Record<string, unknown>;
};

const AGENT_ACTOR = { type: 'agent' as const, id: 'agent-service' };
const CLAIM_TTL_SECONDS = 120;

const toModelName = (toolName: string) => toolName.replaceAll('.', '_');

const describeInbound = (row: HistoryRow): string => {
  const content = row.content as MessageContent;
  if (content.kind === 'media') {
    const caption = content.caption ? ` with the text: ${content.caption}` : '';
    if (content.mediaType === 'audio') return `[The customer sent a voice note. It has not been transcribed.]${caption}`;
    return `[The customer sent a ${content.mediaType}.]${caption}`;
  }
  if (content.kind === 'reply') return `[Tapped button: ${content.title}]`;
  if (content.kind === 'unsupported') return '[The customer sent a message type that cannot be shown.]';
  return row.body ?? '';
};

const toChatMessage = (row: HistoryRow): ChatMessage => {
  if (row.direction === 'inbound') return { role: 'user', content: describeInbound(row) };
  const prefix = row.sender_type === 'human' ? '(staff) ' : '';
  return { role: 'assistant', content: `${prefix}${row.body ?? `[${row.message_type} message]`}` };
};

const usageDate = (now: Date) => now.toISOString().slice(0, 10);

const recordUsage = async (deps: AgentDependencies, tenantId: string, inputTokens: number, outputTokens: number) => {
  await withTenant(deps.database, tenantId, (client) =>
    client.query(
      `INSERT INTO token_usage (tenant_id, usage_date, input_tokens, output_tokens) VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, usage_date) DO UPDATE
       SET input_tokens = token_usage.input_tokens + excluded.input_tokens,
           output_tokens = token_usage.output_tokens + excluded.output_tokens`,
      [tenantId, usageDate(deps.clock()), inputTokens, outputTokens],
    ),
  );
};

const tokensUsedToday = async (client: TenantClient, now: Date): Promise<number> => {
  const row = (
    await client.query<{ total: string }>(
      'SELECT coalesce(sum(input_tokens + output_tokens), 0) AS total FROM token_usage WHERE tenant_id = $1 AND usage_date = $2',
      [client.tenantId, usageDate(now)],
    )
  ).rows[0];
  return Number(row?.total ?? 0);
};

type TurnContext = {
  settings: TenantSettingsRow;
  businessName: string;
  customerIdentity: string;
  crmPersonId: string | null;
  history: HistoryRow[];
  latest: HistoryRow;
  recentCustomerMessages: number;
  tokensToday: number;
  approvedPricesPence: Set<number>;
  allowedPhoneDigits: Set<string>;
  allowedEmails: Set<string>;
  businessNumber: string;
  hasSentAiMessage: boolean;
  upcomingBookings: { id: string; starts_at: Date }[];
};

const loadTurnContext = async (deps: AgentDependencies, client: TenantClient, conversationId: string, now: Date): Promise<TurnContext | undefined> => {
  const conversation = (
    await client.query<{ customer_identity: string; crm_person_id: string | null; business_name: string; business_number: string }>(
      `SELECT c.customer_identity, c.crm_person_id, t.name AS business_name, a.display_phone_number AS business_number
       FROM conversations c
       JOIN tenants t ON t.id = c.tenant_id
       JOIN whatsapp_accounts a ON a.tenant_id = c.tenant_id AND a.id = c.whatsapp_account_id
       WHERE c.tenant_id = $1 AND c.id = $2`,
      [client.tenantId, conversationId],
    )
  ).rows[0];
  if (!conversation) return undefined;

  const history = (
    await client.query<HistoryRow>(
      `SELECT * FROM (
         SELECT id, direction, sender_type, message_type, body, content, received_at, seq FROM messages
         WHERE tenant_id = $1 AND conversation_id = $2 ORDER BY seq DESC LIMIT $3
       ) recent ORDER BY seq`,
      [client.tenantId, conversationId, deps.historyLimit],
    )
  ).rows;
  const latest = [...history].reverse().find((row) => row.direction === 'inbound');
  if (!latest) return undefined;

  const recent = (
    await client.query<{ count: string }>(
      `SELECT count(*) AS count FROM messages m JOIN conversations c ON c.tenant_id = m.tenant_id AND c.id = m.conversation_id
       WHERE m.tenant_id = $1 AND c.customer_identity = $2 AND m.direction = 'inbound' AND m.received_at > $3`,
      [client.tenantId, conversation.customer_identity, new Date(now.getTime() - 3600_000)],
    )
  ).rows[0];

  const prices = await client.query<{ price_pence: number }>(
    'SELECT price_pence FROM pricebook_items WHERE tenant_id = $1 AND approved',
    [client.tenantId],
  );
  const knowledge = await client.query<{ body: string }>('SELECT title || \' \' || body AS body FROM kb_entries WHERE tenant_id = $1', [client.tenantId]);
  const knowledgeText = knowledge.rows.map((row) => row.body).join('\n');
  const allowedPhoneDigits = new Set(
    [conversation.customer_identity, conversation.business_number, ...(knowledgeText.match(/\+?\d[\d\s()-]{8,}\d/g) ?? [])].map(normalisePhoneDigits),
  );
  const allowedEmails = new Set((knowledgeText.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []).map((email) => email.toLowerCase()));

  const aiSent = await client.query(
    "SELECT 1 FROM messages WHERE tenant_id = $1 AND conversation_id = $2 AND direction = 'outbound' AND sender_type = 'ai' LIMIT 1",
    [client.tenantId, conversationId],
  );
  const bookings = await client.query<{ id: string; starts_at: Date }>(
    `SELECT b.id, b.starts_at FROM bookings b JOIN conversations c ON c.tenant_id = b.tenant_id AND c.id = b.conversation_id
     WHERE b.tenant_id = $1 AND c.customer_identity = $2 AND b.status = 'confirmed' AND b.starts_at > $3 ORDER BY b.starts_at LIMIT 5`,
    [client.tenantId, conversation.customer_identity, now],
  );

  return {
    settings: await loadTenantSettings(client),
    businessName: conversation.business_name,
    customerIdentity: conversation.customer_identity,
    crmPersonId: conversation.crm_person_id,
    history,
    latest,
    recentCustomerMessages: Number(recent?.count ?? 0),
    tokensToday: await tokensUsedToday(client, now),
    approvedPricesPence: new Set(prices.rows.map((row) => row.price_pence)),
    allowedPhoneDigits,
    allowedEmails,
    businessNumber: conversation.business_number,
    hasSentAiMessage: (aiSent.rowCount ?? 0) > 0,
    upcomingBookings: bookings.rows,
  };
};

export const runAgentTurn = async (
  deps: AgentDependencies,
  job: { tenantId: string; conversationId: string; messageId: string },
): Promise<TurnResult> => {
  const startedAt = deps.clock();
  const { tenantId, conversationId, messageId } = job;

  const latestInbound = await withTenant(deps.database, tenantId, async (client) =>
    (
      await client.query<{ id: string }>(
        "SELECT id FROM messages WHERE tenant_id = $1 AND conversation_id = $2 AND direction = 'inbound' ORDER BY seq DESC LIMIT 1",
        [tenantId, conversationId],
      )
    ).rows[0],
  );
  // Debounce: a later message has its own turn, which will answer everything at once.
  if (latestInbound?.id !== messageId) return { outcome: 'superseded' };

  const claim = await claimConversation(deps, tenantId, {
    conversationId,
    claimant: 'ai',
    latestMessageId: messageId,
    ttlSeconds: CLAIM_TTL_SECONDS,
  });
  if (!claim.claimed) {
    if (claim.reason === 'paused' && 'retryAfterSeconds' in claim && claim.retryAfterSeconds && claim.retryAfterSeconds < 600) {
      return { outcome: 'claim_refused', retryAt: new Date(startedAt.getTime() + claim.retryAfterSeconds * 1000), details: { reason: claim.reason } };
    }
    return { outcome: 'claim_refused', details: { reason: claim.reason } };
  }

  const state: TurnState = {
    tenantId,
    conversationId,
    messageId,
    claimId: claim.claimId,
    correlationId: newId('cor'),
    inputTokens: 0,
    outputTokens: 0,
    details: {},
  };

  let result: TurnResult;
  try {
    result = await runClaimedTurn(deps, state);
  } catch (error) {
    // Default on any failure: send nothing.
    result = { outcome: 'error', details: { error: (error as Error).message } };
  } finally {
    await releaseClaim(deps, tenantId, conversationId, state.claimId).catch(() => undefined);
  }

  await withTenant(deps.database, tenantId, (client) =>
    client.query(
      `INSERT INTO agent_turns (id, tenant_id, conversation_id, message_id, outcome, model, input_tokens, output_tokens,
                                sent_message_id, details, started_at, finished_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        newId('turn'),
        tenantId,
        conversationId,
        messageId,
        result.outcome,
        state.model ?? null,
        state.inputTokens,
        state.outputTokens,
        state.sentMessageId ?? null,
        { ...state.details, ...result.details },
        startedAt,
        deps.clock(),
      ],
    ),
  ).catch(() => undefined);
  return result;
};

const runClaimedTurn = async (deps: AgentDependencies, state: TurnState): Promise<TurnResult> => {
  const now = deps.clock();
  const context = await withTenant(deps.database, state.tenantId, (client) => loadTurnContext(deps, client, state.conversationId, now));
  if (!context) return { outcome: 'error', details: { error: 'conversation_not_found' } };

  let crmPersonId = context.crmPersonId;
  if (!crmPersonId) {
    crmPersonId = await deps.crm
      .findOrCreatePersonByPhone(state.tenantId, context.customerIdentity)
      .then((person) => person.id)
      .catch(() => null);
  }

  const toolContext: ToolContext = {
    tenantId: state.tenantId,
    conversationId: state.conversationId,
    customerIdentity: context.customerIdentity,
    crmPersonId,
    actor: AGENT_ACTOR,
    correlationId: state.correlationId,
  };

  const send = (suffix: string, payload: Record<string, unknown>): Promise<SendResult> =>
    sendMessage(deps.send, {
      tenant_id: state.tenantId,
      actor: AGENT_ACTOR,
      correlation_id: state.correlationId,
      idempotency_key: `turn:${state.messageId}:${suffix}`,
      occurred_at: deps.clock().toISOString(),
      payload: { conversation_id: state.conversationId, claim_id: state.claimId, ...payload },
    });

  const handOff = async (outcome: TurnOutcome, reason: (typeof HANDOFF_REASONS)[number], text: string, summary: string): Promise<TurnResult> => {
    const sent = await send('handoff', { type: 'text', body: text });
    if (sent.status === 200) state.sentMessageId = sent.body.message_id;
    await deps.gateway.call(toolContext, 'handoff.request', { reason, summary: summary.slice(0, 500) });
    return { outcome, details: { send_status: sent.status } };
  };

  const latestText = describeInbound(context.latest);
  const pendingCustomerText = context.history
    .filter((row) => row.direction === 'inbound' && row.received_at >= (context.history.findLast((other) => other.direction !== 'inbound')?.received_at ?? new Date(0)))
    .map(describeInbound)
    .join('\n');

  const escalation: Escalation | undefined = classifyEscalation(pendingCustomerText);
  if (escalation === 'emergency') {
    return handOff('emergency', 'emergency', context.settings.emergency_message ?? DEFAULT_EMERGENCY_MESSAGE, `Possible emergency: ${latestText}`);
  }
  if (escalation) {
    return handOff('handoff', escalation, context.settings.handoff_message ?? DEFAULT_HANDOFF_MESSAGE, `${escalation}: ${latestText}`);
  }

  if (context.recentCustomerMessages > context.settings.customer_messages_per_hour_limit) {
    return limitReached(deps, state, toolContext, send, context, 'customer_limit', 'Customer passed the hourly message limit');
  }
  if (context.tokensToday >= context.settings.daily_token_budget) {
    return limitReached(deps, state, toolContext, send, context, 'token_budget', 'Daily AI token budget reached');
  }

  const latestContent = context.latest.content as MessageContent;
  let confirmationNote: string | undefined;
  if (latestContent.kind === 'reply') {
    const resolved = await deps.gateway.resolveConfirmation(toolContext, latestContent.replyId, context.latest.id);
    if (resolved?.status === 'ok') {
      const output = resolved.output as { declined?: boolean; booked?: boolean; rescheduled?: boolean; cancelled?: boolean; when?: string };
      const text = output.booked
        ? `You're booked in for ${output.when}. We'll send you a reminder before the appointment.`
        : output.rescheduled
          ? `Done, your booking is now ${output.when}.`
          : output.cancelled
            ? 'Your booking has been cancelled.'
            : undefined;
      if (text) return sendFinal(deps, state, send, context, text);
      confirmationNote = 'The customer chose not to go ahead with the proposed time. Ask what would suit them better.';
    } else if (resolved) {
      return sendFinal(deps, state, send, context, 'Sorry, that option is no longer available. Would you like me to look for another time?');
    }
  }

  const canary = `ref-${randomBytes(6).toString('hex')}`;
  const systemPrompt = buildSystemPrompt({
    businessName: context.businessName,
    languages: context.settings.languages,
    timezone: context.settings.timezone,
    now,
    canary,
  });
  const protectedPromptText = buildRules(context.businessName, context.settings.languages);

  const prefetched = await deps.gateway.call(toolContext, 'kb.search', { query: latestText.slice(0, 200) || 'services' });
  const bookingsText = context.upcomingBookings.length
    ? context.upcomingBookings.map((booking) => `${booking.id}: ${formatSlotLabel(booking.starts_at, context.settings.timezone)}`).join('; ')
    : 'none';
  const businessContext = [
    `Knowledge base results for the latest message: ${prefetched.status === 'ok' ? JSON.stringify(prefetched.output) : 'unavailable'}`,
    `This customer's upcoming bookings (id: time): ${bookingsText}`,
    confirmationNote,
  ]
    .filter(Boolean)
    .join('\n');

  const tools = deps.gateway.listFor('agent');
  const modelTools: ModelTool[] = tools.map((tool) => ({ name: toModelName(tool.name), description: tool.description, parameters: tool.parameters }));
  const toolNames = new Map(tools.map((tool) => [toModelName(tool.name), tool.name]));

  const messages: ChatMessage[] = [
    { role: 'system', content: `${systemPrompt}\n\n${businessContext}` },
    ...context.history.map(toChatMessage),
  ];

  // Written from inside askModel; a holder object keeps TypeScript from narrowing these to undefined.
  const pending: { confirmation?: ConfirmationRequest; handoff?: { reason: string; summary: string } } = {};
  const currentHandoff = () => pending.handoff;

  const askModel = async (): Promise<string | undefined> => {
    for (let step = 0; step < deps.maxModelSteps; step += 1) {
      if (context.tokensToday + state.inputTokens + state.outputTokens >= context.settings.daily_token_budget) return undefined;
      const response = await deps.model.complete({ messages, tools: modelTools, maxOutputTokens: deps.maxOutputTokens });
      state.model = response.model;
      state.inputTokens += response.usage.inputTokens;
      state.outputTokens += response.usage.outputTokens;
      await recordUsage(deps, state.tenantId, response.usage.inputTokens, response.usage.outputTokens);

      if (response.toolCalls.length === 0) return response.content.trim();

      messages.push({ role: 'assistant', content: response.content, toolCalls: response.toolCalls });
      for (const call of response.toolCalls) {
        const toolName = toolNames.get(call.name) ?? call.name;
        let toolResult: unknown;
        if (toolName === 'handoff.request') {
          // Run after the goodbye message is sent; pausing first would block that send.
          const args = (call.arguments ?? {}) as { reason?: string; summary?: string };
          pending.handoff = { reason: String(args.reason ?? 'unsure'), summary: String(args.summary ?? latestText) };
          toolResult = { status: 'ok', output: { handed_off: true } };
        } else {
          const outcome = await deps.gateway.call(toolContext, toolName, call.arguments);
          if (outcome.status === 'needs_customer_confirmation') pending.confirmation = outcome.confirmation;
          toolResult =
            outcome.status === 'needs_customer_confirmation'
              ? { status: outcome.status, note: `The customer will be shown Confirm/Change buttons for: ${outcome.confirmation.summary}` }
              : outcome;
        }
        messages.push({ role: 'tool', toolCallId: call.id, toolName: call.name, content: JSON.stringify(toolResult) });
      }
    }
    return undefined;
  };

  let draft = await askModel();
  if (pending.handoff) {
    const reason = (HANDOFF_REASONS as readonly string[]).includes(pending.handoff.reason) ? pending.handoff.reason : 'unsure';
    return handOff('handoff', reason as (typeof HANDOFF_REASONS)[number], context.settings.handoff_message ?? DEFAULT_HANDOFF_MESSAGE, pending.handoff.summary);
  }
  if (draft === undefined) {
    if (context.tokensToday + state.inputTokens + state.outputTokens >= context.settings.daily_token_budget) {
      return limitReached(deps, state, toolContext, send, context, 'token_budget', 'Daily AI token budget reached');
    }
    return handOff('handoff', 'unsure', context.settings.handoff_message ?? DEFAULT_HANDOFF_MESSAGE, `Agent could not finish: ${latestText}`);
  }

  const check = (text: string): ReplyProblem[] =>
    checkReply({
      reply: text,
      approvedPricesPence: context.approvedPricesPence,
      allowedPhoneDigits: context.allowedPhoneDigits,
      allowedEmails: context.allowedEmails,
      canary,
      protectedPromptText,
      customerText: pendingCustomerText,
    });

  let problems = check(draft);
  if (problems.length > 0) {
    state.details.blocked_draft_problems = problems;
    messages.push({ role: 'assistant', content: draft });
    messages.push({
      role: 'system',
      content: `That reply was not sent because of: ${problems.join(', ')}. Write a new reply that follows the rules.`,
    });
    draft = await askModel();
    const lateHandoff = currentHandoff();
    if (lateHandoff) {
      return handOff('handoff', 'unsure', context.settings.handoff_message ?? DEFAULT_HANDOFF_MESSAGE, lateHandoff.summary);
    }
    problems = draft === undefined ? ['empty'] : check(draft);
    if (problems.length > 0 || draft === undefined) {
      state.details.blocked_retry_problems = problems;
      await handOff('reply_blocked', 'unsure', context.settings.handoff_message ?? DEFAULT_HANDOFF_MESSAGE, `Reply blocked (${problems.join(', ')}): ${latestText}`);
      return { outcome: 'reply_blocked', details: { problems } };
    }
  }

  return sendFinal(deps, state, send, context, draft, pending.confirmation);
};

const sendFinal = async (
  deps: AgentDependencies,
  state: TurnState,
  send: (suffix: string, payload: Record<string, unknown>) => Promise<SendResult>,
  context: TurnContext,
  text: string,
  confirmation?: ConfirmationRequest,
): Promise<TurnResult> => {
  const disclosure =
    context.settings.ai_disclosure_enabled && !context.hasSentAiMessage ? `Hi, I'm the virtual assistant for ${context.businessName}. ` : '';
  const body = `${disclosure}${text}`;
  const sent = confirmation
    ? await send('reply', { type: 'buttons', body: `${body}\n\n${confirmation.summary}?`.slice(0, 1024), buttons: confirmation.buttons })
    : await send('reply', { type: 'text', body });
  if (sent.status !== 200) return { outcome: 'send_refused', details: { send_status: sent.status, reason: sent.body.reason } };
  state.sentMessageId = sent.body.message_id;
  return { outcome: 'sent' };
};

const limitReached = async (
  deps: AgentDependencies,
  state: TurnState,
  toolContext: ToolContext,
  send: (suffix: string, payload: Record<string, unknown>) => Promise<SendResult>,
  context: TurnContext,
  outcome: 'customer_limit' | 'token_budget',
  message: string,
): Promise<TurnResult> => {
  const sent = await send('limit', { type: 'text', body: context.settings.handoff_message ?? DEFAULT_HANDOFF_MESSAGE });
  if (sent.status === 200) state.sentMessageId = sent.body.message_id;
  const now = deps.clock();
  const shouldAlert = await withTenant(deps.database, state.tenantId, async (client) => {
    await pauseAi(client, state.conversationId, now, new Date(now.getTime() + context.settings.human_pause_hours * 3600_000));
    if (outcome === 'customer_limit') return true;
    const updated = await client.query(
      `INSERT INTO token_usage (tenant_id, usage_date, budget_alert_sent) VALUES ($1, $2, true)
       ON CONFLICT (tenant_id, usage_date) DO UPDATE SET budget_alert_sent = true WHERE NOT token_usage.budget_alert_sent
       RETURNING 1`,
      [state.tenantId, usageDate(now)],
    );
    return (updated.rowCount ?? 0) > 0;
  });
  if (shouldAlert) {
    await deps.ownerNotifier.alert({ tenantId: state.tenantId, conversationId: state.conversationId, kind: 'limit_reached', message });
  }
  return { outcome, details: { send_status: sent.status } };
};
