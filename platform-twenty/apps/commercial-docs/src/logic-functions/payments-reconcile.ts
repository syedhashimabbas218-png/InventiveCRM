import { defineLogicFunction } from 'twenty-sdk/define';

import { IDS } from 'src/constants/ids';
import { runAsApplication } from 'src/lib/api';
import { reconcilePayments } from 'src/lib/payments';

export default defineLogicFunction({
  universalIdentifier: IDS.logicFunctions.paymentsReconcile,
  name: 'payments-reconcile',
  description: 'Checks open pay-now links with Stripe or Revolut and marks invoices paid; closes links of invoices paid or voided another way.',
  timeoutSeconds: 300,
  cronTriggerSettings: { pattern: '7-59/30 * * * *' },
  httpRouteTriggerSettings: { path: '/payments/reconcile', httpMethod: 'POST', isAuthRequired: true },
  handler: runAsApplication(() => reconcilePayments()),
});
