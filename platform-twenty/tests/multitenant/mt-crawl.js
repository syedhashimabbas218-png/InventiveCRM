const { launch } = require('./mt-lib');
const [stateFile, host] = process.argv.slice(2);
(async () => {
  const browser = await launch(); const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, storageState: stateFile }); const page = await context.newPage();
  const results = [];
  const visited = new Set();
  const queue = ['/objects/companies', '/objects/people', '/settings/general', '/settings/profile', '/settings/developers', '/settings/ai', '/settings/applications', '/settings/community'];
  const visit = async (path) => {
    if (visited.has(path) || visited.size >= 70) return;
    visited.add(path);
    await page.goto(`http://${host}:3000${path}`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(1800);
    const text = await page.innerText('body').catch(() => '');
    const cleaned = text.replace(/Built on Twenty[^]*?endorsed by Twenty\./g, '');
    const hits = cleaned.match(/.{0,60}\bTwenty\b.{0,60}/g) || [];
    const images = await page.evaluate(() => [...document.querySelectorAll('img')].map((image) => image.currentSrc || image.src));
    const externalTwentyLinks = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((anchor) => anchor.href).filter((href) => /twenty\.com|twentyhq|twentycrm|discord\.com\/invite/.test(href)));
    results.push({ path, title: await page.title(), hits, externalTwentyLinks: [...new Set(externalTwentyLinks)], images: images.filter((source) => /twenty/i.test(source) && !source.includes('/images/integrations/twenty-logo.svg')) });
    const links = await page.evaluate(() => [...document.querySelectorAll('a[href^="/settings"]')].map((anchor) => anchor.getAttribute('href').split('?')[0]));
    for (const link of links) if (!visited.has(link) && !queue.includes(link)) queue.push(link);
  };
  while (queue.length) await visit(queue.shift());
  for (const result of results) {
    const flag = result.hits.length || result.externalTwentyLinks.length || result.images.length ? 'LEAK' : 'ok  ';
    console.log(`${flag} ${result.path} | ${result.title}`);
    result.hits.forEach((hit) => console.log(`       text: ${hit.replace(/\n/g, ' ')}`));
    result.externalTwentyLinks.forEach((href) => console.log(`       link: ${href}`));
    result.images.forEach((source) => console.log(`       img: ${source}`));
  }
  console.log('PAGES', results.length);
  await browser.close();
})().catch((error) => { console.error(error.message.split('\n')[0]); process.exit(1); });
