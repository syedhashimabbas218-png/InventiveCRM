const { chromium } = require('playwright');
const fs = require('fs');
const leaks = [];
const launch = () => chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,*.localhost,127.0.0.1' } });
const dump = async (page, label, { quiet } = {}) => {
  await page.waitForTimeout(2500);
  const text = await page.innerText('body').catch(() => '');
  const cleaned = text.replace(/Built on Twenty[^]*?endorsed by Twenty\./g, '');
  const hits = cleaned.match(/.{0,50}\bTwenty\b.{0,50}/g) || [];
  console.log(`--- ${label} | ${page.url()} | title="${await page.title()}" | twenty=${hits.length}`);
  if (!quiet) console.log('   ' + text.slice(0, 500).replace(/\n+/g, ' | '));
  hits.forEach((hit) => leaks.push(`${label}: ${hit}`));
  await page.screenshot({ path: `mt-${label}.png` });
  return text;
};
const tokenFromContext = async (context) => {
  const cookies = await context.cookies();
  const pair = cookies.find((cookie) => cookie.name === 'tokenPair');
  if (!pair) return null;
  const parsed = JSON.parse(decodeURIComponent(pair.value));
  return parsed.accessOrWorkspaceAgnosticToken?.token ?? parsed.accessToken?.token ?? null;
};
const graphql = async (token, query, variables = {}, origin = 'http://localhost:3000') => {
  const response = await fetch('http://localhost:3000/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: origin },
    body: JSON.stringify({ query, variables }),
  });
  return response.json();
};
const saveState = (name, value) => fs.writeFileSync(`mt-state-${name}.json`, JSON.stringify(value, null, 2));
const loadState = (name) => JSON.parse(fs.readFileSync(`mt-state-${name}.json`, 'utf8'));
module.exports = { launch, dump, tokenFromContext, graphql, leaks, saveState, loadState };
