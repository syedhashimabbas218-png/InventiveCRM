const { launch, dump, leaks } = require('./mt-lib');
const [stateFile, url, firstName, lastName] = process.argv.slice(2);
(async () => {
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, storageState: stateFile });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  for (let wait = 0; wait < 60 && /workspace-activation/.test(page.url()); wait++) await page.waitForTimeout(2000);
  for (let step = 0; step < 6; step++) {
    await page.waitForTimeout(2500);
    const current = page.url();
    if (current.includes('/create/profile')) {
      const inputs = page.locator('input:visible');
      await inputs.nth(0).fill(firstName); await inputs.nth(1).fill(lastName);
      await page.getByRole('button', { name: 'Continue' }).click();
    } else if (current.includes('/invite-team')) {
      await page.getByRole('button', { name: 'Skip' }).click();
    } else if (/sync-emails|import-contacts|book-call|plan-required/.test(current)) {
      await dump(page, `onboarding-${current.split('/').pop()}`);
      const skip = page.getByText(/^Skip|Continue without|Later/).first();
      if (await skip.isVisible().catch(() => false)) await skip.click(); else break;
    } else break;
  }
  await dump(page, `home-${new URL(page.url()).hostname.split('.')[0]}`);
  await context.storageState({ path: stateFile });
  await browser.close();
  console.log('LEAKS', JSON.stringify(leaks));
})().catch((error) => { console.error('FAIL', error.message.split('\n')[0]); process.exit(1); });
