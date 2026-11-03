const { launch } = require('./mt-lib');
(async () => {
  const browser = await launch();
  const context = await browser.newContext({ storageState: 'mt-admin-bright.json' });
  const page = await context.newPage();
  await page.goto('http://bright.localhost:3000/objects/companies', { waitUntil: 'networkidle' });
  const result = await page.evaluate(async () => {
    const response = await fetch('/metadata', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'x-twenty-session-cookie': '1' },
      body: JSON.stringify({ query: 'mutation($emails: [String!]!) { sendInvitations(emails: $emails) { success errors } }', variables: { emails: ['client@brightelectrical.test'] } }) });
    return response.json();
  });
  console.log(JSON.stringify(result));
  await browser.close();
})();
