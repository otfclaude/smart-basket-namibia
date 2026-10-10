// Opens every pamphlet on the Pamphlets page in the in-app reader, in WebKit (Safari's engine),
// and reports how many pages it shows. Run by .github/workflows/namshop-pamphlets.yml.
//   node reader_check.js http://127.0.0.1:8765/ [expected pages for every pamphlet]
const engine = require('playwright')[process.env.BROWSER || 'webkit'];

(async () => {
  const base = process.argv[2];
  const expect = Number(process.argv[3] || 0);
  const browser = await engine.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(base + '#/pamphlets');
  await page.waitForSelector('.pam, .empty', { timeout: 30000 });
  await page.waitForTimeout(6000);  // PDF covers are drawn as the cards come into view
  const cards = await page.$$eval('.pam', (els) => els.map((e) => ({
    store: e.dataset.open, chip: e.querySelector('.pam-chip').textContent.trim(), cover: !!e.querySelector('.pam-cover img:not(.loading)') })));
  console.log(`${cards.length} pamphlet card(s)`);
  let bad = 0;
  for (const c of cards) {
    await page.click(`.pam[data-open="${c.store}"]`);
    await page.waitForTimeout(5000);
    const first = await page.evaluate(() => ({
      counter: document.querySelector('#reader-page').textContent,
      pages: document.querySelectorAll('.rpage').length,
      drawn: document.querySelectorAll('.rpage canvas, .rpage img').length,
      fallback: !!document.querySelector('.reader-fallback'),
    }));
    await page.evaluate(() => { const s = document.querySelector('#reader-scroll'); s.scrollTop = s.scrollHeight; });
    await page.waitForTimeout(3000);
    const last = await page.evaluate(() => ({
      counter: document.querySelector('#reader-page').textContent,
      drawn: document.querySelectorAll('.rpage canvas, .rpage img').length,
    }));
    console.log(`${c.store}: card "${c.chip}" cover=${c.cover} | reader pages=${first.pages} drawn=${first.drawn} counter="${first.counter}"`
      + ` fallback=${first.fallback} | at the end: counter="${last.counter}" drawn=${last.drawn}`);
    if (first.fallback || (expect && first.pages !== expect) || (first.pages > 1 && last.counter.split(' / ')[0] === '1')) bad++;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  console.log('console errors:', errors.length ? '\n  ' + [...new Set(errors)].join('\n  ') : 'none');
  await browser.close();
  if (bad || (expect && !cards.length)) { console.log(`FAILED: ${bad} pamphlet(s) not shown in full`); process.exit(1); }
})();
