import { sendMessage } from '../../src/conversations/send.ts';
import { createDatabase } from '../../src/db/pool.ts';
import { createGraphClient } from '../../src/whatsapp/graph-client.ts';

// Run as a separate process by crash-recovery.test.ts, which kills it with SIGKILL mid-send.
const environment = process.env;
const database = createDatabase(environment.CHILD_DATABASE_URL ?? '');
const now = new Date(environment.CHILD_NOW ?? '');

await sendMessage(
  {
    database,
    clock: () => now,
    graph: createGraphClient({ baseUrl: environment.CHILD_GRAPH_URL ?? '', version: 'v26.0', timeoutMs: 60_000 }),
    tokenKeys: [{ id: environment.CHILD_KEY_ID ?? '', key: Buffer.from(environment.CHILD_KEY ?? '', 'base64') }],
    eventBus: { publish: async () => undefined },
    sendTimeoutMs: 500,
  },
  JSON.parse(environment.CHILD_ENVELOPE ?? '{}'),
);
