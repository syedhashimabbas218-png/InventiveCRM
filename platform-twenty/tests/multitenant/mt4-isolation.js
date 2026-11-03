const { launch } = require('./mt-lib');
const results = [];
const check = (name, passed, detail) => { results.push({ name, passed }); console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`); };
const inPage = (page, query, variables = {}) =>
  page.evaluate(async ({ query, variables }) => {
    const response = await fetch('/graphql', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'x-twenty-session-cookie': '1' }, body: JSON.stringify({ query, variables }) });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { query, variables });
const CREATE = 'mutation($name: String!) { createCompany(data: { name: $name }) { id name } }';
const LIST = '{ companies(first: 100) { edges { node { id name } } } }';
const BY_ID = 'query($id: UUID!) { companies(filter: { id: { eq: $id } }) { edges { node { id name } } } }';
const names = (result) => (result.body?.data?.companies?.edges ?? []).map((edge) => edge.node.name);
(async () => {
  const browser = await launch();
  const open = async (stateFile, host) => {
    const context = await browser.newContext({ storageState: stateFile });
    const page = await context.newPage();
    await page.goto(`http://${host}:3000/objects/companies`, { waitUntil: 'networkidle' });
    return { context, page };
  };
  const acme = await open('mt-admin.json', 'acme.localhost');
  const bright = await open('mt-admin-bright.json', 'bright.localhost');

  const acmeCreated = await inPage(acme.page, CREATE, { name: 'AcmeOnly Ltd' });
  const brightCreated = await inPage(bright.page, CREATE, { name: 'BrightOnly Ltd' });
  check('create record in Acme', !!acmeCreated.body?.data?.createCompany?.id, JSON.stringify(acmeCreated.body?.errors?.[0]?.message ?? ''));
  check('create record in Bright', !!brightCreated.body?.data?.createCompany?.id, JSON.stringify(brightCreated.body?.errors?.[0]?.message ?? ''));
  const acmeId = acmeCreated.body?.data?.createCompany?.id;
  const brightId = brightCreated.body?.data?.createCompany?.id;

  const acmeList = names(await inPage(acme.page, LIST));
  const brightList = names(await inPage(bright.page, LIST));
  console.log('  Acme sees:', acmeList.join(', '));
  console.log('  Bright sees:', brightList.join(', '));
  check('Acme sees its own record', acmeList.includes('AcmeOnly Ltd'));
  check('Acme does not see Bright record', !acmeList.includes('BrightOnly Ltd'));
  check('Bright sees its own record', brightList.includes('BrightOnly Ltd'));
  check('Bright does not see Acme record', !brightList.includes('AcmeOnly Ltd'));

  const crossRead = await inPage(bright.page, BY_ID, { id: acmeId });
  check('Bright cannot read Acme record by id', names(crossRead).length === 0, JSON.stringify(crossRead.body).slice(0, 160));
  const crossUpdate = await inPage(bright.page, 'mutation($id: UUID!) { updateCompany(id: $id, data: { name: "hacked" }) { id name } }', { id: acmeId });
  const acmeAfter = names(await inPage(acme.page, LIST));
  check('Bright cannot update Acme record', !acmeAfter.includes('hacked') && acmeAfter.includes('AcmeOnly Ltd'), (crossUpdate.body?.errors?.[0]?.message ?? JSON.stringify(crossUpdate.body)).slice(0, 160));
  const crossDelete = await inPage(bright.page, 'mutation($id: UUID!) { deleteCompany(id: $id) { id } }', { id: acmeId });
  check('Bright cannot delete Acme record', names(await inPage(acme.page, LIST)).includes('AcmeOnly Ltd'), (crossDelete.body?.errors?.[0]?.message ?? JSON.stringify(crossDelete.body)).slice(0, 160));

  // Replay Bright's session cookie against Acme's host, as an attacker who copies a cookie would.
  const brightCookie = (await bright.context.cookies('http://bright.localhost:3000')).find((cookie) => cookie.name === 'twenty-session');
  const rawRequest = (host, headers, body) => new Promise((resolve) => {
    const request = require('http').request({ host: '127.0.0.1', port: 3000, path: '/graphql', method: 'POST', headers: { Host: `${host}:3000`, 'Content-Type': 'application/json', ...headers } }, (response) => {
      let data = ''; response.on('data', (chunk) => (data += chunk)); response.on('end', () => { let parsed = null; try { parsed = JSON.parse(data); } catch {} resolve({ status: response.statusCode, body: parsed, raw: data.slice(0, 200) }); });
    });
    request.on('error', (error) => resolve({ error: error.message })); request.end(JSON.stringify(body));
  });
  const replay = await rawRequest('acme.localhost', { Cookie: `twenty-session=${brightCookie.value}`, Origin: 'http://acme.localhost:3000', 'x-twenty-session-cookie': '1' }, { query: LIST });
  const replayNames = names(replay);
  check('Bright cookie replayed on Acme host returns no Acme data', !replayNames.includes('AcmeOnly Ltd'), `status=${replay.status} names=[${replayNames.join(', ')}] ${(replay.body?.errors?.[0]?.message ?? replay.error ?? '').slice(0, 120)}`);

  const anonymous = await rawRequest('acme.localhost', { Origin: 'http://acme.localhost:3000' }, { query: LIST });
  check('unauthenticated request gets no data', names(anonymous).length === 0, `status=${anonymous.status} ${(anonymous.body?.errors?.[0]?.message ?? '').slice(0, 100)}`);
  const acmeCookie = (await acme.context.cookies('http://acme.localhost:3000')).find((cookie) => cookie.name === 'twenty-session');
  const forgedOrigin = await rawRequest('acme.localhost', { Cookie: `twenty-session=${acmeCookie.value}`, Origin: 'http://bright.localhost:3000', 'x-twenty-session-cookie': '1' }, { query: CREATE, variables: { name: 'csrf-from-bright' } });
  check('Acme cookie used from Bright origin is refused (CSRF)', !forgedOrigin.body?.data?.createCompany, `status=${forgedOrigin.status} ${(forgedOrigin.body?.error ?? forgedOrigin.body?.errors?.[0]?.message ?? forgedOrigin.raw ?? '').toString().slice(0, 100)}`);
  const ownReplay = await rawRequest('acme.localhost', { Cookie: `twenty-session=${acmeCookie.value}`, Origin: 'http://acme.localhost:3000', 'x-twenty-session-cookie': '1' }, { query: LIST });
  check('control: Acme cookie on Acme host does work', names(ownReplay).includes('AcmeOnly Ltd'), `status=${ownReplay.status}`);

  require('fs').writeFileSync('mt-ids.json', JSON.stringify({ acmeId, brightId }));
  await browser.close();
  console.log(`SUMMARY ${results.filter((result) => result.passed).length}/${results.length} passed`);
})().catch((error) => { console.error('ERROR', error.message.split('\n')[0]); process.exit(1); });
