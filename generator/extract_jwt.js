/**
 * Login yap, session yarat, JWT token + cookies + session_id yakala
 */

import puppeteer from 'puppeteer';

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  process.stdout.write(JSON.stringify({ success: false, error: 'Usage: node extract_jwt.js <email> <password>' }));
  process.exit(1);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function extractJWT(email, password) {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  let result = null;

  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = req.url();
    const headers = req.headers();
    if (url.includes('/agent/') && url.includes('/session') && headers['token'] && !result) {
      try {
        const params = new URL(url).searchParams;
        const agent_id = url.match(/\/agent\/(\d+)\/session/)?.[1] || '';
        result = {
          token: headers['token'],
          user_id: params.get('user_id') || '',
          device_id: params.get('device_id') || '',
          uuid: params.get('uuid') || '',
          agent_id: agent_id,
          cookies: headers['cookie'] || '',
        };
      } catch(e) {}
    }
    req.continue();
  });

  try {
    // Login
    await page.goto('https://account.minimax.io/unified-login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2000);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', email, { delay: 30 });
    await sleep(300);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.querySelector('.rounded-full'));
      if (btn) btn.click();
    });
    await sleep(300);
    await page.evaluate(() =>
      [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Continue')?.click()
    );
    await sleep(3000);

    await page.waitForSelector('input[type="password"]', { timeout: 5000 });
    await page.type('input[type="password"]', password, { delay: 30 });
    await page.evaluate(() =>
      [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Continue')?.click()
    );
    await sleep(3000);

    // agent.minimax.io'ya git
    await page.goto('https://agent.minimax.io/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(5000);

    // "hi" gönder — bu session request'ini tetikler, token o request'te görünür
    await page.waitForSelector('[contenteditable="true"]', { timeout: 15000 });
    await sleep(1000);
    await page.evaluate(() => {
      const el = document.querySelector('[contenteditable="true"]');
      if (el) { el.focus(); document.execCommand('insertText', false, 'hi'); }
    });
    await page.keyboard.press('Enter');

    // Token yakalanana kadar bekle
    for (let i = 0; i < 30; i++) {
      if (result) break;
      await sleep(500);
    }

    // Puppeteer cookie'lerini de al (Akamai dahil)
    const pageCookies = await page.cookies();
    const cookieStr = pageCookies.map(c => `${c.name}=${c.value}`).join('; ');

    await browser.close();

    if (!result) {
      process.stdout.write(JSON.stringify({ success: false, error: 'Token not captured after sending message' }));
      process.exit(1);
    }

    // Request header cookie'si ile Puppeteer cookie'lerini birleştir — Puppeteer daha kapsamlı
    process.stdout.write(JSON.stringify({
      success: true,
      token: result.token,
      user_id: result.user_id,
      device_id: result.device_id,
      uuid: result.uuid,
      agent_id: result.agent_id,
      cookies: cookieStr,
    }));

  } catch(e) {
    await browser.close().catch(() => {});
    process.stdout.write(JSON.stringify({ success: false, error: e.message }));
    process.exit(1);
  }
}

extractJWT(email, password);
