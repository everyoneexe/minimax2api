/**
 * Session Pool Daemon v7 - Production Grade
 *
 * Creates and maintains a pool of pre-authenticated MiniMax sessions for high-throughput API usage.
 *
 * Features:
 * - Multi-account session pool with configurable size
 * - Automatic session refresh (25min TTL)
 * - 24h cooldown for temporary credit exhaustion (NO_CREDITS)
 * - Permanent depletion for quota exceeded (QUOTA_EXCEEDED)
 * - Fair distribution: each account maintains equal share of pool
 * - Dynamic account addition (watches config every 60s)
 * - Graceful error handling and browser lifecycle
 *
 * Environment variables:
 * - POOL_SIZE: Target total session count (default: 15)
 * - MAX_ACCOUNTS: Max number of accounts to use (0 = unlimited, default: 0)
 * - POOL_FILE: Output file path (default: pool_sessions.json)
 * - HEADLESS: Run browsers in headless mode (default: true)
 *
 * Usage:
 *   node session_daemon.js
 *   POOL_SIZE=20 MAX_ACCOUNTS=3 node session_daemon.js
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import { getAvailableAccounts as getAvailableAccountsShared } from './shared_utils.js';

const POOL_FILE = process.env.POOL_FILE ||
  new URL('../pool_sessions.json', import.meta.url).pathname;
const CONFIG_FILE = new URL('../config.json', import.meta.url).pathname;
const POOL_TARGET = parseInt(process.env.POOL_SIZE || '15');
const MAX_ACCOUNTS = parseInt(process.env.MAX_ACCOUNTS || '0');
const HEADLESS = process.env.HEADLESS !== 'false';

console.log(`[CONFIG] Pool Target: ${POOL_TARGET}, Max Accounts: ${MAX_ACCOUNTS || 'unlimited'}, Headless: ${HEADLESS}`);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Pool file operations
 */
function loadPool() {
  try {
    if (fs.existsSync(POOL_FILE)) {
      return JSON.parse(fs.readFileSync(POOL_FILE, 'utf-8'));
    }
  } catch(e) {
    console.error(`[Pool] Failed to load: ${e.message}`);
  }
  return { sessions: [] };
}

function savePool(data) {
  try {
    const tmp = POOL_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, POOL_FILE);
  } catch(e) {
    console.error(`[Pool] Failed to save: ${e.message}`);
  }
}

function countValidSessions(pool, email = null) {
  const now = Date.now();
  return pool.sessions.filter(s => {
    const valid = new Date(s.expires_at).getTime() > now;
    return email ? (valid && s.account_email === email) : valid;
  }).length;
}

function addSession(sessionInfo, email) {
  const pool = loadPool();

  // Add new session
  pool.sessions.push({
    ...sessionInfo,
    account_email: email,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 25 * 60 * 1000).toISOString(), // 25min TTL
  });

  // Clean expired sessions
  const now = Date.now();
  pool.sessions = pool.sessions.filter(s => new Date(s.expires_at).getTime() > now);

  savePool(pool);
}

/**
 * Config file operations with caching
 */
let configCache = null;
let configCacheTime = 0;
const CONFIG_CACHE_TTL = 5000; // Cache for 5 seconds

function loadConfig() {
  try {
    const now = Date.now();
    // Use cache if recent
    if (configCache && (now - configCacheTime < CONFIG_CACHE_TTL)) {
      return configCache;
    }

    configCache = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    configCacheTime = now;
    return configCache;
  } catch(e) {
    console.error(`[Config] Failed to load: ${e.message}`);
    return { accounts: [] };
  }
}

function saveConfig(cfg) {
  try {
    const tmp = CONFIG_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf-8');
    fs.renameSync(tmp, CONFIG_FILE);
    // Invalidate cache on write
    configCache = cfg;
    configCacheTime = Date.now();
    return true;
  } catch(e) {
    console.error(`[Config] Failed to save: ${e.message}`);
    return false;
  }
}

function markAccountTemporarilyDepleted(email) {
  try {
    const cfg = loadConfig();
    let changed = false;

    for (const acc of cfg.accounts || []) {
      if (acc.email === email && !acc.temporarily_no_credits) {
        acc.temporarily_no_credits = true;
        // Use seconds (not milliseconds) to match Python time.time()
        acc.credits_check_after = Math.floor(Date.now() / 1000) + (24 * 60 * 60); // 24 hours in seconds
        changed = true;
        console.log(`[${email}] ⏰ Marked temporarily_no_credits - will retry after 24h`);
      }
    }

    if (changed) saveConfig(cfg);
  } catch(e) {
    console.error(`[${email}] Failed to mark temporarily_no_credits: ${e.message}`);
  }
}

function markAccountPermanentlyDepleted(email) {
  try {
    const cfg = loadConfig();
    let changed = false;

    for (const acc of cfg.accounts || []) {
      if (acc.email === email && !acc.depleted) {
        acc.depleted = true;
        acc.is_active = false;
        changed = true;
        console.log(`[${email}] 🚫 Marked PERMANENTLY depleted`);
      }
    }

    if (changed) saveConfig(cfg);
  } catch(e) {
    console.error(`[${email}] Failed to mark depleted: ${e.message}`);
  }
}

function clearTemporaryFlag(email) {
  try {
    const cfg = loadConfig();
    let changed = false;

    for (const acc of cfg.accounts || []) {
      if (acc.email === email && acc.temporarily_no_credits) {
        acc.temporarily_no_credits = false;
        acc.credits_check_after = 0;
        changed = true;
        console.log(`[${email}] ✅ Cooldown expired - cleared temporarily_no_credits flag`);
      }
    }

    if (changed) saveConfig(cfg);
  } catch(e) {
    console.error(`[${email}] Failed to clear temporary flag: ${e.message}`);
  }
}

/**
 * Browser login
 */
async function loginBrowser(browser, email, pass) {
  console.log(`[${email}] 🔐 Logging in...`);

  const page = await browser.newPage();

  try {
    await page.goto('https://account.minimax.io/unified-login', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await sleep(2000);

    // Enter email
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', email, { delay: 30 });
    await sleep(300);

    // Click email continue
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.querySelector('.rounded-full'));
      if (btn) btn.click();
    });
    await sleep(300);

    await page.evaluate(() =>
      [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Continue')?.click()
    );
    await sleep(3000);

    // Enter password
    await page.waitForSelector('input[type="password"]', { timeout: 5000 });
    await page.type('input[type="password"]', pass, { delay: 30 });

    await page.evaluate(() =>
      [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Continue')?.click()
    );
    await sleep(3000);

    // Navigate to agent page
    await page.goto('https://agent.minimax.io/', {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });
    await sleep(3000);

    await page.close();
    console.log(`[${email}] ✅ Login successful`);
    return true;

  } catch(e) {
    await page.close().catch(() => {});
    throw new Error(`Login failed: ${e.message}`);
  }
}

/**
 * Capture new session by sending a test message
 */
async function captureNewSession(browser) {
  const page = await browser.newPage();

  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(async () => {
      await page.close().catch(() => {});
      reject(new Error('Session capture timeout (60s)'));
    }, 60000);

    try {
      await page.setRequestInterception(true);

      page.on('request', req => req.continue());

      const onResponse = async (resp) => {
        const url = resp.url();

        // Match session creation request: POST /agent/{id}/session?...
        if (url.includes('/agent/') && url.includes('/session?') && resp.request().method() === 'POST') {
          try {
            const text = await resp.text();
            const data = JSON.parse(text);

            if (data.session_id) {
              const req = resp.request();
              const headers = req.headers();
              const reqUrl = req.url();
              const params = new URL(reqUrl).searchParams;

              // Wait for page to render, check for credit warnings
              await sleep(3000);

              const hasNoCredits = await page.evaluate(() =>
                document.body.innerText.includes('do not have enough Credits') ||
                document.body.innerText.includes('Purchase Credits')
              ).catch(() => false);

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
          } catch(e) {
            // Ignore parse errors
          }
        }
      };

      page.on('response', onResponse);

      // Navigate and send test message
      await page.goto('https://agent.minimax.io/', {
        waitUntil: 'domcontentloaded',
        timeout: 20000
      });
      await sleep(5000);

      await page.waitForSelector('[contenteditable="true"]', { timeout: 15000 });
      await sleep(1000);

      await page.evaluate(() => {
        const el = document.querySelector('[contenteditable="true"]');
        if (el) {
          el.focus();
          document.execCommand('insertText', false, 'hi');
        }
      });

      await page.keyboard.press('Enter');

    } catch(e) {
      clearTimeout(timeout);
      await page.close().catch(() => {});
      reject(e);
    }
  });
}

/**
 * Run account session maintenance loop
 */
async function runAccount(email, pass, accountCount) {
  console.log(`\n[${email}] 🚀 Starting browser...`);

  const browser = await puppeteer.launch({
    headless: HEADLESS ? 'new' : false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  try {
    await loginBrowser(browser, email, pass);

    while (true) {
      // Check if account is still active
      const cfg = loadConfig();
      const accountCfg = cfg.accounts.find(a => a.email === email);

      if (accountCfg && (accountCfg.is_active === false || accountCfg.depleted)) {
        console.log(`[${email}] Account deactivated, shutting down browser...`);
        await browser.close().catch(() => {});
        return;
      }

      // Calculate this account's target share
      const pool = loadPool();
      const totalValid = countValidSessions(pool);
      const myTarget = Math.ceil(POOL_TARGET / accountCount);
      const mySessions = countValidSessions(pool, email);

      console.log(`[${email}] Pool: ${totalValid}/${POOL_TARGET} | My quota: ${mySessions}/${myTarget}`);

      const needed = myTarget - mySessions;

      if (needed > 0) {
        console.log(`[${email}] Creating ${needed} new session(s)...`);

        // Create sessions sequentially to avoid race conditions
        for (let i = 0; i < needed; i++) {
          try {
            const sessionInfo = await captureNewSession(browser);
            addSession(sessionInfo, email);
            console.log(`[${email}]   ✓ Session ${i + 1}/${needed}: ${sessionInfo.session_id}`);
            await sleep(1000);

          } catch(e) {
            if (e.message === 'NO_CREDITS') {
              console.log(`[${email}]   ✗ Temporary credit exhaustion - 24h cooldown activated`);
              markAccountTemporarilyDepleted(email);
              await browser.close().catch(() => {});
              return;

            } else if (e.message === 'QUOTA_EXCEEDED') {
              console.log(`[${email}]   ✗ Permanent quota exceeded`);
              markAccountPermanentlyDepleted(email);
              await browser.close().catch(() => {});
              return;

            } else {
              console.error(`[${email}]   ✗ ${e.message}`);
            }
          }
        }
      }

      // Wait before next check (60s)
      await sleep(60000);
    }

  } catch(e) {
    console.error(`[${email}] Fatal error: ${e.message}`);
    await browser.close().catch(() => {});
  }
}

/**
 * Get available accounts from config (wrapper for shared utility)
 */
function getAvailableAccounts() {
  // Use shared utility with seconds-based time comparison
  const accounts = getAvailableAccountsShared(loadConfig, true);

  // Clear expired cooldown flags
  accounts.forEach(acc => {
    if (acc.temporarily_no_credits && acc.credits_check_after) {
      const now = Math.floor(Date.now() / 1000);
      if (now >= acc.credits_check_after) {
        clearTemporaryFlag(acc.email);
      }
    }
  });

  return accounts;
}

/**
 * Main
 */
(async () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║  Session Pool Daemon v7 - Production Grade                ║
╚═══════════════════════════════════════════════════════════╝
  Target Pool Size: ${POOL_TARGET} sessions
  Max Accounts: ${MAX_ACCOUNTS || 'Unlimited'}
  Pool File: ${POOL_FILE}
  Headless: ${HEADLESS}

  Features:
  ✓ Multi-account fair distribution
  ✓ 25-minute session TTL with auto-refresh
  ✓ 24h cooldown for temporary credit exhaustion
  ✓ Permanent depletion for quota exceeded
  ✓ Dynamic account monitoring (60s refresh)
`);

  let accounts = getAvailableAccounts();

  if (MAX_ACCOUNTS > 0 && accounts.length > MAX_ACCOUNTS) {
    accounts = accounts.slice(0, MAX_ACCOUNTS);
  }

  if (accounts.length === 0) {
    console.error('❌ No available accounts found in config.json');
    console.error('   Add accounts with email + password to config.json');
    process.exit(1);
  }

  console.log(`[Init] Found ${accounts.length} available account(s)`);
  console.log(`[Init] Per-account target: ~${Math.ceil(POOL_TARGET / accounts.length)} sessions\n`);

  const accountCount = accounts.length;
  const runningAccounts = new Set();

  // Start all account loops
  for (const acc of accounts) {
    runningAccounts.add(acc.email);
    runAccount(acc.email, acc.password, accountCount).then(() => {
      runningAccounts.delete(acc.email);
      console.log(`[${acc.email}] Account loop ended`);
    });

    await sleep(3000); // Stagger browser launches
  }

  // Watch for new accounts
  setInterval(async () => {
    try {
      const newAccounts = getAvailableAccounts().filter(acc =>
        !runningAccounts.has(acc.email)
      );

      if (newAccounts.length > 0) {
        console.log(`\n[Watcher] Found ${newAccounts.length} new account(s)`);

        for (const acc of newAccounts) {
          runningAccounts.add(acc.email);
          runAccount(acc.email, acc.password, runningAccounts.size).then(() => {
            runningAccounts.delete(acc.email);
            console.log(`[${acc.email}] Account loop ended`);
          });

          await sleep(3000);
        }
      }
    } catch(e) {
      console.error(`[Watcher] Error: ${e.message}`);
    }
  }, 60000); // Check every 60s

  console.log(`[Daemon] ✅ Running with ${accounts.length} account(s)\n`);
})();
