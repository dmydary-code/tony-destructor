// Headless smoke test of the built Angular app.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, 'dist/tony-ng/browser');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let p = path.join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(p)) p = path.join(root, 'index.html');
  res.setHeader('Content-Type', types[path.extname(p)] || 'application/octet-stream');
  res.end(fs.readFileSync(p));
});

(async () => {
  await new Promise((r) => server.listen(8899, r));
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:8899/');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'shots/40-start.png' });
  await page.click('button');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'shots/41-play.png' });
  const ev = (fn) => page.evaluate(fn);
  const waitFor = (fn, ms = 25000) => page.waitForFunction(fn, null, { timeout: ms, polling: 100 }).catch(() => console.log('TIMEOUT'));
  const state = () => ev(() => { const t = window.__tony; return { time: +t.time.toFixed(1), score: t.score, carrying: t.tony.carrying && t.tony.carrying.name, humans: t.humans.map(h => [h.name, h.state, h.doing]), puddles: t.puddles.map(p => [+p.size.toFixed(2), p.discovered]) }; });

  await ev(() => { const t = window.__tony; t.dtScale = 8; t.humans.forEach(h => { h.state = 'idle'; h.stateTimer = 1000; h.target = null; h.pos.set(5.2, 0, 3); }); });
  // steal
  await ev(() => { const t = window.__tony; const m = t.humans[0]; m.pos.set(-2, 0, -1.8); m.heading = Math.PI; t.tony.pos.set(-2, 0, -1.05); t.tony.heading = Math.PI; });
  await page.waitForTimeout(400);
  await page.keyboard.down('KeyE');
  await waitFor(() => window.__tony.tony.carrying);
  await page.keyboard.up('KeyE');
  console.log('steal', JSON.stringify(await state()));
  // hide
  await ev(() => { window.__tony.tony.pos.set(-4.2, 0, 2.3); });
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(600);
  console.log('hide', JSON.stringify(await state()));
  // grab + chew
  await ev(() => { const t = window.__tony; t.humans.forEach(h => { h.state = 'idle'; h.stateTimer = 1000; h.pos.set(5.2, 0, 3); }); const it = t.items.find(i => i.state === 'placed'); t.tony.pos.set(it.holder.position.x + 0.3, 0, it.holder.position.z); });
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyE');
  await waitFor(() => window.__tony.tony.carrying);
  console.log('grab', JSON.stringify(await state()));
  await page.keyboard.down('KeyF');
  await waitFor(() => !window.__tony.tony.carrying);
  await page.keyboard.up('KeyF');
  console.log('chew', JSON.stringify(await state()));
  // pee + slip
  await ev(() => { const t = window.__tony; t.bladder = 1; t.tony.pos.set(-3, 0, 0); t.tony.heading = 0; });
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyQ');
  await waitFor(() => window.__tony.puddles.length && window.__tony.puddles[0].size >= 1);
  await ev(() => { const t = window.__tony; t.tony.pos.set(-5, 0, 0); const m = t.humans[0]; m.pos.set(-3, 0, -2.5); m.heading = 0; m.state = 'walk'; m.path = [{ x: -3, z: 2.5, label: 'x' }]; m.target = m.path[0]; });
  await waitFor(() => window.__tony.humans[0].state === 'slip');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shots/42-slip.png' });
  console.log('slip', JSON.stringify(await state()));
  console.log('errors', errors);
  await browser.close();
  server.close();
})();
