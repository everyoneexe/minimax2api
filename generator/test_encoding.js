import puppeteer from 'puppeteer';
const EMAIL = 'akxusclv@guerrillamailblock.com';
const PASS = 'Mme9582427730fd618!7';

async function test() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  // Login
  await page.goto('https://account.minimax.io/unified-login', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));
  await page.waitForSelector('input[type="email"]');
  await page.type('input[type="email"]', EMAIL, { delay: 30 });
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => { const btn = [...document.querySelectorAll('button')].find(b => b.querySelector('.rounded-full')); if (btn) btn.click(); });
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Continue')?.click());
  await new Promise(r => setTimeout(r, 3000));
  await page.waitForSelector('input[type="password"]');
  await page.type('input[type="password"]', PASS, { delay: 30 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Continue')?.click());
  await new Promise(r => setTimeout(r, 5000));
  await page.goto('https://agent.minimax.io/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 3000));

  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('/session/') && url.includes('/message')) {
      const raw = await resp.text();
      console.log('RAW bytes sample:', Buffer.from(raw.slice(0,100)).toString('hex'));
      console.log('As latin1->utf8:', Buffer.from(raw.slice(0,200), 'latin1').toString('utf8').slice(0,100));
      console.log('As utf8 direct:', raw.slice(0,100));
      await browser.close();
      process.exit(0);
    }
  });

  await page.setRequestInterception(true);
  page.on('request', r => r.continue());
  await page.waitForSelector('[contenteditable="true"]');
  await page.evaluate(() => { const el = document.querySelector('[contenteditable="true"]'); if (el) { el.focus(); document.execCommand('insertText', false, 'say hi with emoji 👋'); } });
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 30000));
  await browser.close();
}
test().catch(console.error);
