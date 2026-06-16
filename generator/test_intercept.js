import puppeteer from 'puppeteer';
const EMAIL = 'akxusclv@guerrillamailblock.com';
const PASS = 'Mme9582427730fd618!7';

async function test() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  await page.evaluateOnNewDocument(() => {
    window.__requests = [];
    const origXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(m, url, ...a) {
      window.__requests.push({ type: 'xhr', method: m, url });
      return origXHROpen.call(this, m, url, ...a);
    };
    const origFetch = window.fetch;
    window.fetch = async function(...args) {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      window.__requests.push({ type: 'fetch', url });
      return origFetch(...args);
    };
  });

  await page.setRequestInterception(true);
  page.on('request', req => req.continue());

  // Login + navigate
  await page.goto('https://account.minimax.io/unified-login', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));
  await page.type('input[type="email"]', EMAIL, { delay: 30 });
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => { const btn = [...document.querySelectorAll('button')].find(b => b.querySelector('.rounded-full')); if (btn) btn.click(); });
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Continue')?.click());
  await new Promise(r => setTimeout(r, 3000));
  await page.type('input[type="password"]', PASS, { delay: 30 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Continue')?.click());
  await new Promise(r => setTimeout(r, 5000));
  await page.goto('https://agent.minimax.io/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 5000));
  
  // Type message
  await page.waitForSelector('[contenteditable="true"]');
  await page.evaluate(() => { const el = document.querySelector('[contenteditable="true"]'); if (el) { el.focus(); document.execCommand('insertText', false, 'hi'); } });
  await page.keyboard.press('Enter');
  
  await new Promise(r => setTimeout(r, 10000));
  
  // Check what requests were made
  const reqs = await page.evaluate(() => window.__requests);
  const filtered = reqs.filter(r => r.url && (r.url.includes('session') || r.url.includes('message') || r.url.includes('archon')));
  console.log('Session/message requests:');
  filtered.forEach(r => console.log(r.type, r.method || '-', r.url.slice(0,100)));
  
  await browser.close();
}
test().catch(console.error);
