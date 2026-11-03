const { launch, dump } = require('./mt-lib');
const results = [];
const check = (name, passed, detail) => { results.push(passed); console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`); };
const api = (page, path, query, variables = {}) => page.evaluate(async ({ path, query, variables }) => {
  const response = await fetch(path, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'x-twenty-session-cookie': '1' }, body: JSON.stringify({ query, variables }) });
  return { status: response.status, body: await response.json().catch(() => null) };
}, { path, query, variables });
const signIn = async (page, email, password) => {
  await page.getByText('Continue with Email').click({ timeout: 15000 }).catch(() => {});
  await page.getByPlaceholder(/email/i).fill(email);
  await page.keyboard.press('Enter');
  await page.getByPlaceholder(/password/i).fill(password);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(6000);
};
(async () => {
  const browser = await launch();
  const client = await browser.newContext({ storageState: 'mt-client.json', viewport: { width: 1280, height: 860 } });
  const page = await client.newPage();
  await page.goto('http://bright.localhost:3000/objects/companies', { waitUntil: 'networkidle' });
  const list = await api(page, '/graphql', '{ companies(first: 100) { edges { node { name } } } }');
  const names = (list.body?.data?.companies?.edges ?? []).map((edge) => edge.node.name);
  check('client sees Bright data', names.includes('BrightOnly Ltd'));
  check('client does not see Acme data', !names.includes('AcmeOnly Ltd'));
  const me = await api(page, '/metadata', '{ currentUser { email canAccessFullAdminPanel canImpersonate availableWorkspaces { availableWorkspacesForSignIn { displayName } availableWorkspacesForSignUp { displayName } } } }');
  const user = me.body?.data?.currentUser;
  console.log('  client currentUser:', JSON.stringify(user ?? me.body?.errors?.[0]?.message));
  check('client is not server admin', user && !user.canAccessFullAdminPanel && !user.canImpersonate);
  const clientWorkspaces = user ? [...user.availableWorkspaces.availableWorkspacesForSignIn, ...user.availableWorkspaces.availableWorkspacesForSignUp].map((workspace) => workspace.displayName) : [];
  check('client belongs only to Bright', clientWorkspaces.length === 1 && clientWorkspaces[0] === 'Bright Electrical', clientWorkspaces.join(', '));

  const acmePage = await client.newPage();
  await acmePage.goto('http://acme.localhost:3000/objects/companies', { waitUntil: 'networkidle' });
  await acmePage.waitForTimeout(2500);
  check('client session does not open Acme', !/objects\/companies/.test(acmePage.url()) || !(await acmePage.innerText('body')).includes('Acme Plumbing'), acmePage.url());
  await signIn(acmePage, 'client@brightelectrical.test', 'Client-Pass-1234!');
  const acmeText = await acmePage.innerText('body');
  await acmePage.screenshot({ path: 'mt-09-client-signin-acme.png' });
  check('client cannot sign in to Acme', !/objects\//.test(acmePage.url()) || !acmeText.includes('AcmeOnly'), `${acmePage.url()} | ${acmeText.replace(/\n+/g, ' | ').slice(0, 160)}`);

  const createPage = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  await createPage.goto('http://app.localhost:3000/welcome?action=create-new-workspace', { waitUntil: 'networkidle' });
  await signIn(createPage, 'client@brightelectrical.test', 'Client-Pass-1234!');
  await createPage.screenshot({ path: 'mt-10-client-create-workspace.png' });
  const createText = await createPage.innerText('body');
  const sawForm = createText.includes('Create your workspace');
  let createdSomething = false;
  if (sawForm) {
    const fields = createPage.locator('input:visible');
    await fields.nth(0).fill('Sneaky Client Co'); await fields.nth(1).fill('sneaky');
    await createPage.getByRole('button', { name: /Create workspace/i }).click();
    await createPage.waitForTimeout(6000);
    createdSomething = /sneaky\.localhost/.test(createPage.url());
    console.log('  after submit:', createPage.url(), (await createPage.innerText('body')).replace(/\n+/g, ' | ').slice(0, 200));
  } else console.log('  page:', createPage.url(), createText.replace(/\n+/g, ' | ').slice(0, 200));
  check('client cannot create a workspace', !createdSomething);

  const adminPanel = await client.newPage();
  await adminPanel.goto('http://bright.localhost:3000/settings/admin-panel', { waitUntil: 'networkidle' });
  await adminPanel.waitForTimeout(2500);
  check('client cannot open admin panel', !(await adminPanel.innerText('body')).match(/Feature Flags|Impersonate|Health Status|Config Variables/), adminPanel.url());

  const admin = await browser.newContext({ storageState: 'mt-admin.json' });
  const adminPage = await admin.newPage();
  await adminPage.goto('http://acme.localhost:3000/objects/companies', { waitUntil: 'networkidle' });
  const adminMe = await api(adminPage, '/metadata', '{ currentUser { email canAccessFullAdminPanel canImpersonate availableWorkspaces { availableWorkspacesForSignIn { displayName } availableWorkspacesForSignUp { displayName } } } }');
  console.log('  admin currentUser:', JSON.stringify(adminMe.body?.data?.currentUser));
  const adminUser = adminMe.body?.data?.currentUser; const adminWorkspaces = adminUser ? [...adminUser.availableWorkspaces.availableWorkspacesForSignIn, ...adminUser.availableWorkspaces.availableWorkspacesForSignUp].map((workspace) => workspace.displayName) : [];
  check('control: admin is server admin and in both workspaces', adminUser?.canAccessFullAdminPanel && adminWorkspaces.length === 2, adminWorkspaces.join(', ') || JSON.stringify(adminMe.body?.errors?.[0]?.message));
  await browser.close();
  console.log(`SUMMARY ${results.filter(Boolean).length}/${results.length} passed`);
})().catch((error) => { console.error('ERROR', error.message.split('\n')[0]); process.exit(1); });
