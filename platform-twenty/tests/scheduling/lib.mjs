// Helpers for the scheduling end-to-end tests. They talk to a running multi-workspace server and to
// mock-calendar-providers.mjs on MOCK_URL.
import { readFileSync } from 'node:fs';

export const SERVER = process.env.SERVER_URL || 'http://localhost:3000';
export const MOCK = process.env.MOCK_URL || 'http://127.0.0.1:8095';
export const MAILPIT = process.env.MAILPIT_URL || 'http://127.0.0.1:8025';

const results = [];
export const assert = (name, passed, detail = '') => {
  results.push(Boolean(passed));
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
};
export const summary = () => {
  console.log(`SUMMARY ${results.filter(Boolean).length}/${results.length} passed`);
  return results.every(Boolean);
};
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const waitFor = async (label, check, timeoutMs = 60000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await check();
    if (value) return value;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const call = async (url, token, query, variables = {}, origin) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (payload.errors) throw new Error(JSON.stringify(payload.errors.map((error) => error.message)));
  return payload.data;
};

export const apiClient = (token, workspaceUrl = SERVER) => ({
  gql: (query, variables) => call(`${SERVER}/graphql`, token, query, variables, new URL(workspaceUrl).origin),
  metadata: (query, variables) => call(`${SERVER}/metadata`, token, query, variables, new URL(workspaceUrl).origin),
});

export const keyClient = (keyFile) => apiClient(readFileSync(keyFile, 'utf8').trim());

// A user access token for one workspace, from email and password.
export const userToken = async (workspaceUrl, email, password) => {
  const origin = new URL(workspaceUrl).origin;
  const { getLoginTokenFromCredentials } = await call(`${workspaceUrl}/metadata`, null, `mutation($email: String!, $password: String!, $origin: String!) { getLoginTokenFromCredentials(email: $email, password: $password, origin: $origin) { loginToken { token } } }`, { email, password, origin }, origin);
  const { getAuthTokensFromLoginToken } = await call(`${workspaceUrl}/metadata`, null, `mutation($loginToken: String!, $origin: String!) { getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) { tokens { accessOrWorkspaceAgnosticToken { token } } } }`, { loginToken: getLoginTokenFromCredentials.loginToken.token, origin }, origin);
  return getAuthTokensFromLoginToken.tokens.accessOrWorkspaceAgnosticToken.token;
};

// Adds a member through the workspace invite link, as an invited person would.
export const addMember = async (workspaceUrl, adminToken, email, password, name) => {
  const origin = new URL(workspaceUrl).origin;
  const admin = apiClient(adminToken, workspaceUrl);
  const { currentWorkspace } = await admin.metadata(`{ currentWorkspace { id inviteHash isPublicInviteLinkEnabled } }`);
  if (!currentWorkspace.isPublicInviteLinkEnabled) await admin.metadata(`mutation { updateWorkspace(data: { isPublicInviteLinkEnabled: true }) { id } }`);
  try {
    await call(`${workspaceUrl}/metadata`, null, `mutation($email: String!, $password: String!, $hash: String!, $workspaceId: UUID!) { signUpInWorkspace(email: $email, password: $password, workspaceInviteHash: $hash, workspaceId: $workspaceId) { loginToken { token } } }`, { email, password, hash: currentWorkspace.inviteHash, workspaceId: currentWorkspace.id }, origin);
  } catch (error) {
    if (!/already|exist/i.test(error.message)) throw error;
  }
  const token = await userToken(workspaceUrl, email, password);
  const [firstName, ...rest] = name.split(' ');
  const id = await memberId(token, workspaceUrl);
  await admin.gql(`mutation($id: UUID!, $data: WorkspaceMemberUpdateInput!) { updateWorkspaceMember(id: $id, data: $data) { id } }`, { id, data: { name: { firstName, lastName: rest.join(' ') } } });
  return token;
};

export const memberId = async (token, workspaceUrl) => (await apiClient(token, workspaceUrl).metadata(`{ currentUser { workspaceMember { id } } }`)).currentUser.workspaceMember.id;

export const mock = async (path, body) => {
  const response = await fetch(`${MOCK}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return response.json();
};

// The same flow the Connect button starts: transient token, Twenty's app OAuth endpoint, provider consent, callback.
export const connectCalendar = async ({ token, workspaceUrl, applicationId, providerName, provider, email, reconnectingConnectedAccountId }) => {
  await mock('/admin/next-login', { provider, email });
  const { generateTransientToken } = await apiClient(token, workspaceUrl).metadata(`mutation { generateTransientToken { transientToken { token } } }`);
  const params = new URLSearchParams({ applicationId, providerName, transientToken: generateTransientToken.transientToken.token });
  if (reconnectingConnectedAccountId) params.set('reconnectingConnectedAccountId', reconnectingConnectedAccountId);
  let url = `${SERVER}/auth/apps/authorize?${params}`;
  const hops = [];
  for (let hop = 0; hop < 6; hop += 1) {
    const response = await fetch(url, { redirect: 'manual' });
    hops.push(`${response.status} ${new URL(url).pathname}`);
    const location = response.headers.get('location');
    if (!location || response.status < 300 || response.status >= 400) break;
    url = new URL(location, url).toString();
    if (!url.startsWith(SERVER) && !url.startsWith(MOCK)) break;
  }
  return hops;
};

export const booking = async (workspaceUrl, body, headers = {}) => {
  const response = await fetch(`${workspaceUrl}/s/booking/api`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
};

export const admin = async (workspaceUrl, token, body) => {
  const response = await fetch(`${workspaceUrl}/s/scheduling/admin`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
};

export const mailTo = async (address, since = 0) => {
  const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`)).json();
  return (list.messages ?? []).filter((message) => Date.parse(message.Created) >= since);
};
