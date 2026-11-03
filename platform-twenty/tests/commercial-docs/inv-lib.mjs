import { readFileSync } from 'node:fs';
export const client = (keyFile) => {
  const key = readFileSync(keyFile, 'utf8').trim();
  const gql = async (query, variables = {}) => {
    const response = await fetch('http://localhost:3000/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ query, variables }) });
    const payload = await response.json();
    if (payload.errors) throw new Error(JSON.stringify(payload.errors.map((error) => error.message)));
    return payload.data;
  };
  return { gql, key };
};
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const waitFor = async (label, check, timeoutMs = 60000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await check();
    if (value) return value;
    await sleep(1500);
  }
  throw new Error(`Timed out waiting for ${label}`);
};
const results = [];
export const assert = (name, passed, detail = '') => { results.push(passed); console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`); };
export const summary = () => console.log(`SUMMARY ${results.filter(Boolean).length}/${results.length} passed`);
export const pounds = (money) => (Number(money?.amountMicros ?? 0) / 1_000_000).toFixed(2);
