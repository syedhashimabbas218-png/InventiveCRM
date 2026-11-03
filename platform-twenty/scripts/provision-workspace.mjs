#!/usr/bin/env node
// Creates a client workspace on a multi-workspace InventiveCRM server and an admin API key for it.
// The API key is what MCP clients and the app CLI use to set the workspace up by prompt.
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: options } = parseArgs({
  options: {
    server: { type: 'string', default: process.env.INVENTIVECRM_SERVER_URL },
    email: { type: 'string', default: process.env.INVENTIVECRM_ADMIN_EMAIL },
    password: { type: 'string', default: process.env.INVENTIVECRM_ADMIN_PASSWORD },
    name: { type: 'string' },
    subdomain: { type: 'string' },
    'key-file': { type: 'string' },
    'key-days': { type: 'string', default: '365' },
  },
});

const required = ['server', 'email', 'password', 'name', 'subdomain', 'key-file'];
const missing = required.filter((key) => !options[key]);
if (missing.length > 0) {
  console.error(`Missing: ${missing.map((key) => `--${key}`).join(', ')}`);
  console.error('Usage: provision-workspace.mjs --server https://crm.example.com --email admin@... --password ... --name "Acme Plumbing" --subdomain acme --key-file acme.key');
  console.error('The email and password can also come from INVENTIVECRM_ADMIN_EMAIL and INVENTIVECRM_ADMIN_PASSWORD.');
  process.exit(2);
}
if (!/^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])?$/.test(options.subdomain)) {
  console.error('Subdomain must be 3-30 lowercase letters, digits or hyphens.');
  process.exit(2);
}

const server = new URL(options.server);

// The server only answers credentialed calls whose Origin matches the host they are sent to.
const call = async (query, variables, { token } = {}) => {
  const response = await fetch(new URL('/metadata', server), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: server.origin,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(payload.errors.map((error) => error.message).join('; '));
  return payload.data;
};

const TOKENS = 'tokens { accessOrWorkspaceAgnosticToken { token } }';

const signIn = async () => {
  try {
    const { signIn } = await call(`mutation($email: String!, $password: String!) { signIn(email: $email, password: $password) { ${TOKENS} } }`, {
      email: options.email,
      password: options.password,
    });
    return signIn.tokens.accessOrWorkspaceAgnosticToken.token;
  } catch (error) {
    if (!/not found|does not exist|no user/i.test(error.message)) throw error;
    // On a fresh server the first account becomes the server admin.
    const { signUp } = await call(`mutation($email: String!, $password: String!) { signUp(email: $email, password: $password) { ${TOKENS} } }`, {
      email: options.email,
      password: options.password,
    });
    return signUp.tokens.accessOrWorkspaceAgnosticToken.token;
  }
};

const agnosticToken = await signIn();

const { signUpInNewWorkspace } = await call(
  `mutation($input: SignUpInNewWorkspaceInput) { signUpInNewWorkspace(input: $input) { loginToken { token } workspace { id workspaceUrls { subdomainUrl } } } }`,
  { input: { displayName: options.name, subdomain: options.subdomain } },
  { token: agnosticToken },
);
const workspaceUrl = signUpInNewWorkspace.workspace.workspaceUrls.subdomainUrl.replace(/\/$/, '');

const { getAuthTokensFromLoginToken } = await call(
  `mutation($loginToken: String!, $origin: String!) { getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) { ${TOKENS} } }`,
  { loginToken: signUpInNewWorkspace.loginToken.token, origin: workspaceUrl },
);
const workspaceToken = getAuthTokensFromLoginToken.tokens.accessOrWorkspaceAgnosticToken.token;

await call(`mutation($input: ActivateWorkspaceInput!) { activateWorkspace(data: $input) { id } }`, { input: { displayName: options.name } }, { token: workspaceToken });

const { getRoles } = await call(`{ getRoles { id label } }`, {}, { token: workspaceToken });
const adminRole = getRoles.find((role) => role.label === 'Admin');
if (!adminRole) throw new Error('Admin role not found in the new workspace');

const expiresAt = new Date(Date.now() + Number(options['key-days']) * 86_400_000).toISOString();
const { createApiKey } = await call(
  `mutation($input: CreateApiKeyInput!) { createApiKey(input: $input) { id } }`,
  { input: { name: 'InventiveCRM setup (MCP)', expiresAt, roleId: adminRole.id } },
  { token: workspaceToken },
);
const { generateApiKeyToken } = await call(
  `mutation($apiKeyId: UUID!, $expiresAt: String!) { generateApiKeyToken(apiKeyId: $apiKeyId, expiresAt: $expiresAt) { token } }`,
  { apiKeyId: createApiKey.id, expiresAt },
  { token: workspaceToken },
);

writeFileSync(options['key-file'], `${generateApiKeyToken.token}\n`, { mode: 0o600 });
console.log(JSON.stringify({ workspaceId: signUpInNewWorkspace.workspace.id, workspaceUrl, mcpUrl: `${workspaceUrl}/mcp`, apiKeyFile: options['key-file'], apiKeyExpiresAt: expiresAt }, null, 2));
