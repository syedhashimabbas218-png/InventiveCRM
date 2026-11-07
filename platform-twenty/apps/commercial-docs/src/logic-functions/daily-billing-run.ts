import { defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { gql, nodes, runAsApplication } from 'src/lib/api';
import { todayInLondon } from 'src/lib/dates';
import { markOverdueInvoices, runRecurringInvoices } from 'src/lib/documents';

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
  const recurringInvoicesCreated = await runRecurringInvoices(today);
  const invoicesMarkedOverdue = await markOverdueInvoices(today);
  const quotesExpired = await expireQuotes(today);
  return { date: today, recurringInvoicesCreated: recurringInvoicesCreated.length, invoicesMarkedOverdue, quotesExpired };
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.dailyBillingRun,
  name: 'daily-billing-run',
  description: 'Creates due recurring invoices, marks unpaid invoices past their due date as overdue and expires out-of-date quotes.',
  timeoutSeconds: 120,
  cronTriggerSettings: { pattern: '0 6 * * *' },
  httpRouteTriggerSettings: { path: '/billing/daily-run', httpMethod: 'POST', isAuthRequired: true },
  handler: runAsApplication(handler),
});
