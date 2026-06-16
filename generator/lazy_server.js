/**
 * Lazy Session Server v5
 * - Browser'lar açık kalır (login state)
 * - Her request için yeni tab açılır, cevap alındıktan sonra KAPATILIR
 * - Tab birikimi yok, memory leak yok
 */
import puppeteer from 'puppeteer';
import fs from 'fs';
import httpPlain from 'http';
import { URL } from 'url';

const CONFIG_FILE = new URL('../minimax2api/config.json', import.meta.url).pathname;
const PORT = parseInt(process.env.LAZY_PORT || '5005');
const MAX_BROWSERS = parseInt(process.env.MAX_BROWSERS || '0');
const TABS_PER_BROWSER = parseInt(process.env.TABS_PER_BROWSER || '5');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); }
  catch(e) { return { accounts: [] }; }
}
function markAccountDepleted(email) {
  try {
    const cfg = loadConfig();
    let changed = false;
    for (const acc of cfg.accounts || []) {
      if (acc.email === email && !acc.depleted) {
        acc.depleted = true;
        acc.is_active = false;
        changed = true;
      }
    }
    if (changed) {
      const tmpFile = CONFIG_FILE + '.tmp';
      fs.writeFileSync(tmpFile, JSON.stringify(cfg, null, 2), 'utf-8');
      fs.renameSync(tmpFile, CONFIG_FILE);
    }
  } catch(e) { console.error(`[${email}] Config depleted yazılamadı: ${e.message}`); }
}

// Browser pool: { browser, email, tabs: [{page, busy}] }
const browserPool = [];
let accounts = [];
const allBrowsers = [];
const openedEmails = new Set();

// Graceful shutdown
async function shutdown() {
  console.log('Shutting down...');
  for (const browser of allBrowsers) {
    try { await browser.close(); } catch(e) {}
  }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGHUP', shutdown);

const INTERCEPTOR_SCRIPT = `
window.__chatResult = null;
window.__chatDone = false;
window.__chatError = null;
const origFetch = window.fetch;
window.fetch = async function(...args) {
  const resp = await origFetch(...args);
  const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
  if (url.includes('/session/') && url.includes('/message')) {
    const clone = resp.clone();
    (async () => {
      try {
        const reader = clone.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let fc = '', tc = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split('\\n')) {
            if (!line.startsWith('data:')) continue;
            const raw = line.slice(5).trim();
            if (!raw) continue;
            try {
              const ev = JSON.parse(raw);
              if (ev.type === 6) {
                const c = ev.agent_message_chunk || {};
                if (c.msg_content) fc += c.msg_content;
                if (c.thinking_content) tc += c.thinking_content;
                if (c.finish_reason === 'error') { window.__chatError = 'QUOTA_EXCEEDED'; window.__chatDone = true; return; }
                if (c.finish) { window.__chatResult = { content: fc, thinking: tc }; window.__chatDone = true; }
              } else if (ev.type === 2) {
                const msg = ev.agent_message || {};
                if (msg.role === 'assistant') {
                  if (msg.msg_content) fc = msg.msg_content;
                  if (msg.thinking_content) tc = msg.thinking_content;
                  if (msg.finish_reason === 'error') { window.__chatError = 'QUOTA_EXCEEDED'; window.__chatDone = true; return; }
                  const u = msg.usage || {};
                  const inputTok = u.input_tokens || Math.max(0, (u.total_tokens || 0) - (u.output_tokens || 0));
                  if (!window.__chatDone) {
                    window.__chatResult = { content: fc, thinking: tc, usage: { prompt_tokens: inputTok, completion_tokens: u.output_tokens || 0, total_tokens: u.total_tokens || 0 } };
                    window.__chatDone = true;
                  }
                }
              }
            } catch(e) {}
          }
        }
      } catch(e) {}
    })();
  }
  return resp;
};
`;

async function loginBrowser(email, pass) {
  console.log(`[${email}] Browser başlatılıyor...`);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  allBrowsers.push(browser);

  const loginPage = await browser.newPage();
  await loginPage.goto('https://account.minimax.io/unified-login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(2000);
  await loginPage.waitForSelector('input[type="email"]', { timeout: 10000 });
  await loginPage.type('input[type="email"]', email, { delay: 30 });
  await sleep(300);
  await loginPage.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.querySelector('.rounded-full'));
    if (btn) btn.click();
  });
  await sleep(300);
  await loginPage.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Continue')?.click());
  await sleep(3000);
  await loginPage.waitForSelector('input[type="password"]', { timeout: 5000 });
  await loginPage.type('input[type="password"]', pass, { delay: 30 });
  await loginPage.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Continue')?.click());
  await sleep(3000);
  await loginPage.goto('https://agent.minimax.io/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await sleep(3000);
  await loginPage.close();
  console.log(`[${email}] ✓ Login başarılı`);

  // Open tab pool
  const tabs = [];
  for (let i = 0; i < TABS_PER_BROWSER; i++) {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument((script) => { eval(script); }, INTERCEPTOR_SCRIPT);
    await page.goto('https://agent.minimax.io/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(1000);
    tabs.push({ page, busy: false });
    console.log(`[${email}] Tab ${i + 1}/${TABS_PER_BROWSER} hazır`);
  }

  return { browser, tabs };
}

async function chatWithTab(tabEntry, message) {
  const { page } = tabEntry;

  // Reset interceptor state
  await page.evaluate(() => {
    window.__chatDone = false;
    window.__chatResult = null;
    window.__chatError = null;
  });

  // Check credits
  const noCredits = await page.evaluate(() =>
    document.body.innerText.includes('do not have enough Credits')
  ).catch(() => false);
  if (noCredits) throw new Error('NO_CREDITS');

  // Type message
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await sleep(300);
  await page.evaluate((msg) => {
    const el = document.querySelector('[contenteditable="true"]');
    if (el) { el.focus(); document.execCommand('insertText', false, msg); }
  }, message);
  await page.keyboard.press('Enter');

  // Wait for result
  await page.waitForFunction(
    () => window.__chatDone === true,
    { timeout: 60000, polling: 300 }
  );

  const result = await page.evaluate(() => ({
    result: window.__chatResult,
    error: window.__chatError,
  }));

  if (result.error) throw new Error(result.error);
  if (!result.result) throw new Error('Empty response');

  // Start new task — reset state BEFORE click to avoid stale __chatDone from background fetches
  await page.evaluate(() => {
    window.__chatDone = false;
    window.__chatResult = null;
    window.__chatError = null;
  });

  // Start new task (no page reload — instant reset)
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => b.textContent?.trim() === 'New task');
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (!clicked) {
    // Fallback: full page reload if button not found
    await page.goto('https://agent.minimax.io/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  }

  return result.result;
}

// Round-robin tab selection across all browsers
let tabIndex = 0;
function pickTab() {
  // Flatten all free tabs from all browsers
  const freeTabs = [];
  for (const entry of browserPool) {
    for (const tab of entry.tabs) {
      if (!tab.busy) freeTabs.push({ entry, tab });
    }
  }
  if (!freeTabs.length) return null;
  const chosen = freeTabs[tabIndex % freeTabs.length];
  tabIndex++;
  chosen.tab.busy = true;
  return chosen;
}

// HTTP server
const server = httpPlain.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/status') {
    const totalSlots = browserPool.reduce((s, b) => s + b.tabs.length, 0);
    const usedSlots = browserPool.reduce((s, b) => s + b.tabs.filter(t => t.busy).length, 0);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ tabs_available: totalSlots - usedSlots, tabs_total: totalSlots, accounts: browserPool.length }), 'utf8');
    return;
  }

  if (req.method !== 'POST' || req.url !== '/chat') {
    res.writeHead(404); res.end('Not found'); return;
  }

  let body = '';
  req.on('data', d => body += d);
  req.on('end', async () => {
    try {
      const { message } = JSON.parse(body);

      // Wait for available tab
      const start = Date.now();
      let picked = null;
      while (!picked && Date.now() - start < 30000) {
        picked = pickTab();
        if (!picked) await sleep(200);
      }

      if (!picked) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'No browsers available' }), 'utf8');
        return;
      }

      const { entry, tab } = picked;
      try {
        const result = await chatWithTab(tab, message);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ...result, account_email: entry.email }), 'utf8');
      } catch(e) {
        if (e.message === 'NO_CREDITS' || e.message === 'QUOTA_EXCEEDED') {
          console.log(`[${entry.email}] Kredi yok — browser kapatılıyor`);
          markAccountDepleted(entry.email);
          // Remove from pool immediately so no new requests are routed here
          const idx = browserPool.indexOf(entry);
          if (idx > -1) browserPool.splice(idx, 1);
          openedEmails.delete(entry.email);
          // Wait for all in-flight tabs to finish before closing browser
          const waitClose = async () => {
            while (entry.tabs.some(t => t.busy)) await sleep(200);
            await entry.browser.close().catch(() => {});
            const aidx = allBrowsers.indexOf(entry.browser);
            if (aidx > -1) allBrowsers.splice(aidx, 1);
          };
          waitClose().catch(() => {});
        }
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: e.message, account_email: entry.email }), 'utf8');
      } finally {
        tab.busy = false;
      }
    } catch(e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

accounts = loadConfig().accounts.filter(a => a.email && a.password && !a.depleted && a.is_active !== false);
if (MAX_BROWSERS > 0) accounts = accounts.slice(0, MAX_BROWSERS);
console.log(`Lazy Server v6: ${accounts.length} aktif hesap, port ${PORT}, hesap başı ${TABS_PER_BROWSER} tab (pool mode)`);
console.log('Tab pool — tab\'lar goto ile sıfırlanır, açılıp kapanmaz');

server.listen(PORT, () => console.log(`Lazy Session Server: http://localhost:${PORT}`));

// Init browsers
(async () => {
  for (const acc of accounts) {
    try {
      const { browser, tabs } = await loginBrowser(acc.email, acc.password);
      browserPool.push({ browser, email: acc.email, tabs });
      openedEmails.add(acc.email);
      console.log(`[${acc.email}] Browser pool'a eklendi (${tabs.length} tab). Toplam: ${browserPool.length}`);
    } catch(e) {
      console.error(`[${acc.email}] Login hatası: ${e.message}`);
    }
    await sleep(1000);
  }
  console.log(`✓ ${browserPool.length} browser, ${browserPool.reduce((s,b) => s+b.tabs.length, 0)} tab hazır`);

  // Watch for new accounts
  setInterval(async () => {
    try {
      const cfg = loadConfig();
      const newAccounts = cfg.accounts.filter(a =>
        a.email && a.password && !a.depleted && a.is_active !== false && !openedEmails.has(a.email)
      );
      for (const acc of newAccounts) {
        try {
          const { browser, tabs } = await loginBrowser(acc.email, acc.password);
          openedEmails.add(acc.email);
          browserPool.push({ browser, email: acc.email, tabs });
          console.log(`[${acc.email}] Yeni hesap eklendi. Toplam: ${browserPool.length}`);
        } catch(e) {
          console.error(`[${acc.email}] Yeni hesap hatası: ${e.message}`);
        }
      }
    } catch(e) {}
  }, 30000);
})();
