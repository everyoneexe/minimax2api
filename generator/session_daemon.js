/**
 * Session Pool Manager - Multi-Account Puppeteer Daemon
 *
 * Kullanım:
 *   node session_daemon.js                          # tek hesap: EMAIL + PASS env
 *   ACCOUNTS=accounts.json node session_daemon.js   # çoklu hesap
 *   node session_daemon.js --accounts accounts.json
 */
import puppeteer from 'puppeteer';
import fs from 'fs';
import crypto from 'crypto';

const POOL_FILE = process.env.POOL_FILE ||
  new URL('../minimax2api/pool_sessions.json', import.meta.url).pathname;
const POOL_TARGET = parseInt(process.env.POOL_SIZE || '15');
const MAX_ACCOUNTS = parseInt(process.env.MAX_ACCOUNTS || '0'); // 0 = all

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadPool() {
  try {
    if (fs.existsSync(POOL_FILE)) return JSON.parse(fs.readFileSync(POOL_FILE, 'utf-8'));
  } catch(e) {}
  return { sessions: [] };
}

function savePool(data) {
  const tmp = POOL_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, POOL_FILE);
}

function countValidSessions(pool) {
  const now = Date.now();
  return pool.sessions.filter(s => new Date(s.expires_at).getTime() > now).length;
}

function addSession(sessionInfo, email) {
  const pool = loadPool();
  pool.sessions.push({
    ...sessionInfo,
    account_email: email,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
  });
  pool.sessions = pool.sessions.filter(s => new Date(s.expires_at).getTime() > Date.now());
  savePool(pool);
}

async function login(browser, email, pass) {
  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);
    page.on('request', req => req.continue());

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
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Continue')?.click());
    await sleep(3000);

    await page.waitForSelector('input[type="password"]', { timeout: 5000 });
    await page.type('input[type="password"]', pass, { delay: 30 });
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Continue')?.click());

    // Hata sayfası olsa bile direkt /home'a git — cookie set edildi
    await sleep(3000);
    await page.goto('https://agent.minimax.io/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(3000);

    console.log(`[${email}] ✓ Login başarılı`);
    await page.close().catch(() => {});
    return true;
  } catch(e) {
    await page.close().catch(() => {});
    throw e;
  }
}

function markAccountDepleted(email) {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    for (const acc of cfg.accounts) {
      if (acc.email === email) {
        acc.is_active = false;
        // 7 gün cooldown
        acc.cooldown_until = Date.now() / 1000 + 7 * 86400;
        break;
      }
    }
    const tmp = CONFIG_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
    fs.renameSync(tmp, CONFIG_FILE);
    console.log(`[${email}] Config'e işlendi: 7 gün cooldown`);
  } catch(e) {
    console.error(`[${email}] markAccountDepleted hatası: ${e.message}`);
  }
}

async function captureNewSession(browser) {
  const page = await browser.newPage();

  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(async () => {
      await page.close().catch(() => {});
      reject(new Error('Session capture timeout'));
    }, 60000); // 60s timeout

    await page.setRequestInterception(true);
    page.on('request', req => req.continue());

    const onResponse = async (resp) => {
      const url = resp.url();
      if (url.includes('/agent/') && url.includes('/session?') && resp.request().method() === 'POST') {
        try {
          const text = await resp.text();
          const data = JSON.parse(text);
          if (data.session_id) {
            const req = resp.request();
            const headers = req.headers();
            const reqUrl = req.url();
            const params = new URL(reqUrl).searchParams;

            // Session açıldı, Credits uyarısı var mı kontrol et
            await sleep(3000); // Response'un render edilmesini bekle
            const hasNoCredits = await page.evaluate(() => {
              return document.body.innerText.includes('do not have enough Credits') ||
                     document.body.innerText.includes('Purchase Credits');
            }).catch(() => false);

            clearTimeout(timeout);
            page.off('response', onResponse);
            await page.close().catch(() => {});

            if (hasNoCredits) {
              reject(new Error('NO_CREDITS'));
              return;
            }

            resolve({
              session_id: data.session_id,
              token: headers['token'],
              user_id: params.get('user_id'),
              device_id: params.get('device_id'),
              uuid: params.get('uuid'),
              agent_id: reqUrl.match(/\/agent\/(\d+)\/session/)?.[1],
            });
          }
        } catch(e) {}
      }
    };
    page.on('response', onResponse);

    await page.goto('https://agent.minimax.io/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(5000); // Sunucuda daha uzun bekle

    // Input'u bekle
    try {
      await page.waitForSelector('[contenteditable="true"]', { timeout: 15000 });
    } catch(e) {}
    await sleep(1000);

    await page.evaluate(() => {
      const el = document.querySelector('[contenteditable="true"]');
      if (el) { el.focus(); document.execCommand('insertText', false, 'hi'); }
    });
    await page.keyboard.press('Enter');
  });
}

async function runAccount(email, pass) {
  console.log(`\n[${email}] Browser başlatılıyor...`);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    await login(browser, email, pass);

    while (true) {
      // Config'den hesabın aktif olup olmadığını kontrol et
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      const accountCfg = cfg.accounts.find(a => a.email === email);
      if (accountCfg && accountCfg.is_active === false) {
        console.log(`[${email}] Cooldown'a alındı, browser kapatılıyor...`);
        await browser.close().catch(() => {});
        return;
      }

      const pool = loadPool();
      const valid = countValidSessions(pool);
      const accountCount = Object.keys(accounts).length;
      // Bu hesaba düşen hedef: toplam hedef / hesap sayısı (yukarı yuvarla)
      const myTarget = Math.ceil(POOL_TARGET / accountCount);
      // Bu hesabın şu an pool'daki session sayısı
      const mySessions = pool.sessions.filter(s =>
        new Date(s.expires_at).getTime() > Date.now() && s.account_email === email
      ).length;

      console.log(`[${email}] Pool: ${valid}/${POOL_TARGET} | Benim: ${mySessions}/${myTarget}`);

      const needed = myTarget - mySessions;
      if (needed > 0) {
        console.log(`[${email}] ${needed} yeni session oluşturuluyor...`);
        const promises = Array.from({ length: needed }, () =>
          captureNewSession(browser)
            .then(info => {
              addSession(info, email);
              console.log(`[${email}] ✓ ${info.session_id}`);
            })
            .catch(e => {
              if (e.message === 'NO_CREDITS') {
                console.log(`[${email}] ✗ Kredi yok — hesap devre dışı bırakılıyor`);
                markAccountDepleted(email);
                return 'depleted';
              }
              console.error(`[${email}] ✗ ${e.message}`);
            })
        );

        // Eğer depleted olduysa browser'ı kapat ve döngüden çık
        const results = await Promise.all(promises);
        if (results.includes('depleted')) {
          console.log(`[${email}] Browser kapatılıyor (kredi yok)`);
          await browser.close().catch(() => {});
          return;
        }
        await Promise.all(promises);
      }

      await sleep(60000);
    }
  } catch(e) {
    console.error(`[${email}] Fatal: ${e.message}`);
    await browser.close().catch(() => {});
  }
}

// ── Hesap listesi ────────────────────────────────────────────────

const CONFIG_FILE = process.env.CONFIG_FILE ||
  new URL('../minimax2api/config.json', import.meta.url).pathname;
const LEGACY_ACCOUNTS_FILE = process.env.ACCOUNTS ||
  new URL('accounts.json', import.meta.url).pathname;

let accounts = {};

function loadAccounts() {
  const loaded = {};
  // 1. config.json'dan oku (birincil kaynak)
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      for (const a of (cfg.accounts || [])) {
        if (a.email && a.password) {
          loaded[a.email] = a.password;
        }
      }
      if (Object.keys(loaded).length > 0) {
        console.log(`${Object.keys(loaded).length} hesap config.json'dan yüklendi`);
        return loaded;
      }
    } catch(e) {
      console.error('config.json okunamadı:', e.message);
    }
  }
  // 2. Legacy accounts.json'dan oku (fallback)
  const accountsFile = process.env.ACCOUNTS || LEGACY_ACCOUNTS_FILE;
  if (fs.existsSync(accountsFile)) {
    try {
      const list = JSON.parse(fs.readFileSync(accountsFile, 'utf-8'));
      for (const a of list) {
        if (a.email && a.password) loaded[a.email] = a.password;
      }
      console.log(`${Object.keys(loaded).length} hesap ${accountsFile}'dan yüklendi`);
      return loaded;
    } catch(e) {}
  }
  // 3. ENV tek hesap
  if (process.env.EMAIL && process.env.PASS) {
    loaded[process.env.EMAIL] = process.env.PASS;
    console.log('Tek hesap modu: ' + process.env.EMAIL);
    return loaded;
  }
  return loaded;
}

accounts = loadAccounts();

// MAX_ACCOUNTS limiti uygula
if (MAX_ACCOUNTS > 0 && Object.keys(accounts).length > MAX_ACCOUNTS) {
  const entries = Object.entries(accounts).slice(0, MAX_ACCOUNTS);
  accounts = Object.fromEntries(entries);
  console.log(`MAX_ACCOUNTS=${MAX_ACCOUNTS} limiti uygulandı`);
}

if (Object.keys(accounts).length === 0) {
  console.error('Hesap bulunamadı! config.json accounts[] içine email+password ekleyin.');
  process.exit(1);
}

console.log('='.repeat(60));
console.log('SESSION POOL DAEMON — Multi-Account');
console.log('='.repeat(60));
console.log(`Accounts: ${Object.keys(accounts).length}`);
console.log(`Target pool: ${POOL_TARGET} sessions total`);
console.log(`Per account: ~${Math.ceil(POOL_TARGET / Math.max(Object.keys(accounts).length, 1))} sessions`);
console.log(`Pool file: ${POOL_FILE}`);

// Her hesabı aynı anda başlat
for (const [email, pass] of Object.entries(accounts)) {
  runAccount(email, pass);
}
