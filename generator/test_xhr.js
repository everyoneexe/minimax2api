import puppeteer from 'puppeteer';
const EMAIL = 'akxusclv@guerrillamailblock.com';
const PASS = 'Mme9582427730fd618!7';

async function test() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER:', msg.text().slice(0,200)));
  
  await page.evaluateOnNewDocument(() => {
    // Log all XHR and fetch calls
    const origXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(m, url, ...a) {
      if (url.includes('minimax') || url.includes('agent')) console.log('XHR:', m, url.slice(0,80));
      return origXHROpen.call(this, m, url, ...a);
    };
    const origFetch = window.fetch;
    window.fetch = async function(...args) {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (url.includes('minimax') || url.includes('agent')) console.log('FETCH:', url.slice(0,80));
      return origFetch(...args);
    };
  });

  // Login
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
  await new Promise(r => setTimeout(r, 15000));
  await browser.close();
}
test().catch(console.error);
