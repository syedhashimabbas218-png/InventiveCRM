#!/usr/bin/env node
// Sets an app's server variables (instance-wide secrets such as SMTP and WhatsApp settings) from a KEY=value file.
// Run it with the API key of the workspace that owns the app registration.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: options } = parseArgs({
  options: {
    server: { type: 'string', default: process.env.INVENTIVECRM_SERVER_URL },
    'key-file': { type: 'string' },
    app: { type: 'string', default: '93ae1d55-5c54-4fac-922b-fd9fa4a69ab5' },
    'env-file': { type: 'string' },
  },
});

if (!options.server || !options['key-file'] || !options['env-file']) {
  console.error('Usage: set-app-variables.mjs --server https://crm.example.com --key-file owner.key --env-file app-variables.env [--app <universal identifier>]');
  process.exit(2);
}

const server = new URL(options.server);
const token = readFileSync(options['key-file'], 'utf8').trim();

const call = async (query, variables) => {
  const response = await fetch(new URL('/metadata', server), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: server.origin, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(payload.errors.map((error) => error.message).join('; '));
  return payload.data;
};

const wanted = Object.fromEntries(
  readFileSync(options['env-file'], 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]),
);

const { findApplicationRegistrationByUniversalIdentifier: registration } = await call(
  `query($id: String!) { findApplicationRegistrationByUniversalIdentifier(universalIdentifier: $id) { id name } }`,
  { id: options.app },
);
if (!registration) throw new Error(`No app registration ${options.app} on this server`);

const { findApplicationRegistrationVariables: variables } = await call(
  `query($id: String!) { findApplicationRegistrationVariables(applicationRegistrationId: $id) { id key isSecret isFilled } }`,
  { id: registration.id },
);

const unknown = Object.keys(wanted).filter((key) => !variables.some((variable) => variable.key === key));
if (unknown.length > 0) throw new Error(`Not declared by ${registration.name}: ${unknown.join(', ')}`);

for (const variable of variables) {
  if (!(variable.key in wanted)) {
    console.log(`${variable.key}: ${variable.isFilled ? 'kept' : 'not set'}`);
    continue;
  }
  await call(`mutation($input: UpdateApplicationRegistrationVariableInput!) { updateApplicationRegistrationVariable(input: $input) { id } }`, {
    input: { id: variable.id, update: { value: wanted[variable.key] } },
  });
  console.log(`${variable.key}: set${variable.isSecret ? ' (secret)' : ''}`);
}
