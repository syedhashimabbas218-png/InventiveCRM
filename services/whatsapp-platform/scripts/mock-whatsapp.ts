import { MockGraphServer } from '../src/dev/mock-graph-server.ts';

// Local stand-in for graph.facebook.com. Point GRAPH_API_BASE_URL at the printed URL.
const server = new MockGraphServer();
for (const pair of (process.env.MOCK_NUMBERS ?? '').split(',').filter(Boolean)) {
  const [phoneNumberId, accessToken] = pair.split(':');
  if (phoneNumberId && accessToken) server.registerNumber(phoneNumberId, accessToken);
}
console.log(`mock WhatsApp Graph API listening on ${await server.start()}`);
