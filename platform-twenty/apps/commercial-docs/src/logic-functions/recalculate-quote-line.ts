import { type DatabaseEventPayload, defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { refreshLine } from 'src/lib/documents';

type LineEvent = { recordId: string; properties: { before?: { quoteId?: string | null }; after?: { quoteId?: string | null } } };

const handler = async (payload: DatabaseEventPayload<LineEvent>) => {
  const parentHint = payload.properties.after?.quoteId ?? payload.properties.before?.quoteId ?? null;
  await refreshLine('quoteLine', payload.recordId, parentHint);
  if (payload.properties.before?.quoteId && payload.properties.before.quoteId !== parentHint)
    await refreshLine('quoteLine', payload.recordId, payload.properties.before.quoteId);
  return { ok: true };
};

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.recalculateQuoteLine,
  name: 'recalculate-quote-line',
  description: 'Fills quote lines from the price list and keeps line and quote totals up to date.',
  timeoutSeconds: 30,
  databaseEventTriggerSettings: { eventName: 'quoteLine.*' },
  handler,
});
