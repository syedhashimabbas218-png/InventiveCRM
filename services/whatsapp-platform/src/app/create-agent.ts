import { runAgentTurn, type AgentDependencies } from '../agent/turn.ts';
import type { ModelAdapter } from '../agent/model/types.ts';
import type { SendDependencies } from '../conversations/send.ts';
import type { CalendarClient } from '../interfaces/calendar.ts';
import type { CrmClient } from '../interfaces/crm.ts';
import type { JobHandler } from '../jobs/worker.ts';
import { ToolGateway } from '../tools/gateway.ts';
import { createPhaseOneTools, PHASE_ONE_ALLOWLIST, type BookingChangeHandler } from '../tools/phase-one-tools.ts';

export type AgentWiring = SendDependencies & {
  crm: CrmClient;
  calendar: CalendarClient;
  model: ModelAdapter;
  onBookingChange: BookingChangeHandler;
};

export const createAgent = (wiring: AgentWiring): { agent: AgentDependencies; turnHandler: JobHandler } => {
  const gateway = new ToolGateway(
    {
      database: wiring.database,
      crm: wiring.crm,
      calendar: wiring.calendar,
      eventBus: wiring.eventBus,
      ownerNotifier: wiring.ownerNotifier,
      clock: wiring.clock,
    },
    createPhaseOneTools(wiring.onBookingChange),
    PHASE_ONE_ALLOWLIST,
  );
  const agent: AgentDependencies = {
    database: wiring.database,
    clock: wiring.clock,
    gateway,
    model: wiring.model,
    crm: wiring.crm,
    ownerNotifier: wiring.ownerNotifier,
    send: wiring,
    maxModelSteps: 4,
    maxOutputTokens: 400,
    historyLimit: 20,
  };
  const turnHandler: JobHandler = async (job) => {
    const result = await runAgentTurn(agent, {
      tenantId: job.tenant_id,
      conversationId: String(job.payload.conversation_id),
      messageId: String(job.payload.message_id),
    });
    if (result.outcome === 'error') throw new Error(String(result.details?.error ?? 'agent turn failed'));
    return result.retryAt ? { retryAt: result.retryAt } : undefined;
  };
  return { agent, turnHandler };
};
