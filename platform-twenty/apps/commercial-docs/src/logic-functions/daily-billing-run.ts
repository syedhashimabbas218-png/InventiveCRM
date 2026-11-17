import { defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { gql, nodes, runAsApplication } from 'src/lib/api';
import { todayInLondon } from 'src/lib/dates';
import { DAILY_RUN_TIMEOUT_SECONDS, markOverdueInvoices, releaseStuckDocuments, runRecurringInvoices } from 'src/lib/documents';

const expireQuotes = async (today: string) => {
  const data = await gql<{ quotes: { edges: { node: { id: string } }[] } }>(
    `query($today: Date!) { quotes(filter: { status: { eq: SENT }, validUntil: { lt: $today } }, first: 200) { edges { node { id } } } }`,
    { today },
  );
  for (const quote of nodes(data.quotes))
    await gql(`mutation($id: UUID!) { updateQuote(id: $id, data: { status: EXPIRED }) { id } }`, { id: quote.id });
  return nodes(data.quotes).length;
};

const handler = async (input?: { body?: { date?: string } | null; date?: string }) => {
  // A caller may replay a past day (tests do), never a future one: that would issue and send invoices early.
  const requested = input?.body?.date ?? input?.date;
  const actualToday = todayInLondon();
  const today = typeof requested === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(requested) && requested <= actualToday ? requested : actualToday;
  const errors: string[] = [];
  // Each step runs even when an earlier one fails, so one bad record never stops reminders or quote expiry.
  const step = async <TResult>(name: string, run: () => Promise<TResult>, fallback: TResult) => {
    try {
      return await run();
    } catch (error) {
      console.error(`Daily run, ${name}: ${(error as Error).message}`);
      errors.push(`${name}: ${(error as Error).message}`);
      return fallback;
    }
  };
  const documentsReleased = await step('unfinished documents', () => releaseStuckDocuments(), 0);
  const recurringInvoicesCreated = await step('recurring invoices', () => runRecurringInvoices(today), [] as string[]);
  const invoicesMarkedOverdue = await step('overdue invoices', () => markOverdueInvoices(today), 0);
  const quotesExpired = await step('quote expiry', () => expireQuotes(today), 0);
  return { date: today, recurringInvoicesCreated: recurringInvoicesCreated.length, invoicesMarkedOverdue, quotesExpired, documentsReleased, ...(errors.length > 0 ? { errors } : {}) };
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.dailyBillingRun,
  name: 'daily-billing-run',
  description: 'Creates due recurring invoices, marks unpaid invoices past their due date as overdue, expires out-of-date quotes and releases documents whose issuing never finished.',
  timeoutSeconds: DAILY_RUN_TIMEOUT_SECONDS,
  cronTriggerSettings: { pattern: '0 6 * * *' },
  httpRouteTriggerSettings: { path: '/billing/daily-run', httpMethod: 'POST', isAuthRequired: true },
  handler: runAsApplication(handler),
});
