/**
 * Lazy Session Server v7 - Production Grade
 *
 * Features:
 * - Tab pool per browser (configurable via MAX_BROWSERS and TABS_PER_BROWSER)
 * - Round-robin tab allocation across all browsers
 * - 24h cooldown for temporary credit exhaustion (NO_CREDITS)
 * - Permanent depletion for quota exceeded (QUOTA_EXCEEDED)
 * - Auto-recovery: cooldown expired accounts auto-rejoin pool
 * - Graceful error handling and browser lifecycle management
 * - Dynamic account addition (watches config every 30s)
 *
 * Environment variables:
 * - LAZY_PORT: Server port (default: 5005)
 * - MAX_BROWSERS: Max number of browsers (0 = use all available accounts)
 * - TABS_PER_BROWSER: Number of tabs per browser (default: 5)
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import httpPlain from 'http';
import { URL } from 'url';
import { getAvailableAccounts as getAvailableAccountsShared } from './shared_utils.js';

const CONFIG_FILE = new URL('../config.json', import.meta.url).pathname;
const PORT = parseInt(process.env.LAZY_PORT || '5005');
const MAX_BROWSERS = parseInt(process.env.MAX_BROWSERS || '0');
const TABS_PER_BROWSER = parseInt(process.env.TABS_PER_BROWSER || '5');

console.log(`[CONFIG] Port: ${PORT}, Max Browsers: ${MAX_BROWSERS || 'unlimited'}, Tabs per Browser: ${TABS_PER_BROWSER}`);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch(e) {
    console.error(`[Config] Failed to load: ${e.message}`);
    return { accounts: [] };
  }
}

function saveConfig(cfg) {
  try {
    const tmpFile = CONFIG_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(cfg, null, 2), 'utf-8');
    fs.renameSync(tmpFile, CONFIG_FILE);
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
        console.log(`[${email}] ⏰ Marked temporarily_no_credits - retry after 24h`);
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

// Browser pool: { browser, email, tabs: [{page, busy}], stopping: bool }
const browserPool = [];
const allBrowsers = [];
const openedEmails = new Set();

// Graceful shutdown
async function shutdown() {
  console.log('\n[Server] Shutting down...');
  for (const browser of allBrowsers) {
    try { await browser.close(); } catch(e) {}
  }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGHUP', shutdown);

// Interceptor script: captures chat response from fetch
const INTERCEPTOR_SCRIPT = `
window.__chatResult = null;
window.__chatDone = false;
window.__chatError = null;
window.__requestBody = null;

const origFetch = window.fetch;
window.fetch = async function(...args) {
  const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');

  // Capture request body for debugging
  if (url.includes('/session/') && url.includes('/message')) {
    const opts = args[1] || {};
    if (opts.body) {
      try {
        window.__requestBody = JSON.parse(opts.body);
      } catch(e) {}
    }
  }

  const resp = await origFetch(...args);

  if (url.includes('/session/') && url.includes('/message')) {
    const clone = resp.clone();
    (async () => {
      try {
        const reader = clone.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let finalContent = '', thinkingContent = '';

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

              // Type 6: streaming chunk
              if (ev.type === 6) {
                const c = ev.agent_message_chunk || {};
                if (c.msg_content) finalContent += c.msg_content;
                if (c.thinking_content) thinkingContent += c.thinking_content;

                if (c.finish_reason === 'error') {
                  window.__chatError = 'QUOTA_EXCEEDED';
                  window.__chatDone = true;
                  return;
                }

                if (c.finish) {
                  window.__chatResult = {
                    content: finalContent,
                    thinking: thinkingContent
                  };
                  window.__chatDone = true;
                }
              }
              // Type 2: complete message
              else if (ev.type === 2) {
                const msg = ev.agent_message || {};
                if (msg.role === 'assistant') {
                  if (msg.msg_content) finalContent = msg.msg_content;
                  if (msg.thinking_content) thinkingContent = msg.thinking_content;

                  if (msg.finish_reason === 'error') {
                    window.__chatError = 'QUOTA_EXCEEDED';
                    window.__chatDone = true;
                    return;
                  }

                  const u = msg.usage || {};
                  const inputTok = u.input_tokens || Math.max(0, (u.total_tokens || 0) - (u.output_tokens || 0));

                  if (!window.__chatDone) {
                    window.__chatResult = {
                      content: finalContent,
                      thinking: thinkingContent,
                      usage: {
                        prompt_tokens: inputTok,
                        completion_tokens: u.output_tokens || 0,
                        total_tokens: u.total_tokens || 0
                      }
                    };
                    window.__chatDone = true;
                  }
                }
              }
            } catch(e) {
              // Ignore parse errors
            }
          }
        }
      } catch(e) {
        // Ignore stream errors
      }
    })();
  }

  return resp;
};
`;

/**
 * Login browser and create tab pool
 */
async function loginBrowser(email, pass) {
  console.log(`[${email}] 🚀 Launching browser...`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  allBrowsers.push(browser);

  // Step 1: Login
  console.log(`[${email}] 🔐 Logging in...`);
  const loginPage = await browser.newPage();

  try {
    await loginPage.goto('https://account.minimax.io/unified-login', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await sleep(2000);

    // Enter email
    await loginPage.waitForSelector('input[type="email"]', { timeout: 10000 });
    await loginPage.type('input[type="email"]', email, { delay: 30 });
    await sleep(300);

    // Click email continue button
    await loginPage.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.querySelector('.rounded-full'));
      if (btn) btn.click();
    });
    await sleep(300);

    await loginPage.evaluate(() =>
      [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Continue')?.click()
    );
    await sleep(3000);

    // Enter password
    await loginPage.waitForSelector('input[type="password"]', { timeout: 5000 });
    await loginPage.type('input[type="password"]', pass, { delay: 30 });

    await loginPage.evaluate(() =>
      [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Continue')?.click()
    );
    await sleep(3000);

    // Navigate to agent page
    await loginPage.goto('https://agent.minimax.io/', {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });
    await sleep(3000);

    await loginPage.close();
    console.log(`[${email}] ✅ Login successful`);
  } catch(e) {
    await loginPage.close().catch(() => {});
    throw new Error(`Login failed: ${e.message}`);
  }

  // Step 2: Create tab pool
  console.log(`[${email}] 📑 Creating ${TABS_PER_BROWSER} tabs...`);
  const tabs = [];

  for (let i = 0; i < TABS_PER_BROWSER; i++) {
    try {
      const page = await browser.newPage();

      // Inject interceptor before navigation
      await page.evaluateOnNewDocument((script) => { eval(script); }, INTERCEPTOR_SCRIPT);

      await page.goto('https://agent.minimax.io/', {
        waitUntil: 'domcontentloaded',
        timeout: 20000
      });
      await sleep(1500);

      tabs.push({ page, busy: false });
      console.log(`[${email}]   Tab ${i + 1}/${TABS_PER_BROWSER} ✓`);
    } catch(e) {
      console.error(`[${email}]   Tab ${i + 1}/${TABS_PER_BROWSER} ✗ ${e.message}`);
    }
  }

  if (tabs.length === 0) {
    throw new Error('No tabs initialized');
  }

  console.log(`[${email}] ✅ Browser ready with ${tabs.length} tabs`);
  return { browser, tabs };
}

/**
 * Generate random browser fingerprint
 */
function generateFingerprint() {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ];

  const webglVendors = ['Intel Inc.', 'Google Inc.', 'NVIDIA Corporation', 'AMD'];
  const webglRenderers = [
    'Intel Iris OpenGL Engine',
    'ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.1)',
    'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650, OpenGL 4.5)',
    'ANGLE (AMD, AMD Radeon Pro 5500M, OpenGL 4.5)',
  ];

  const screens = [
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
    { width: 1366, height: 768 },
    { width: 1536, height: 864 },
  ];

  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const screen = rand(screens);

  return {
    userAgent: rand(userAgents),
    viewport: { width: screen.width, height: screen.height - 100 },
    screen: screen,
    webgl: {
      vendor: rand(webglVendors),
      renderer: rand(webglRenderers),
    },
    hardwareConcurrency: [4, 8, 12, 16][Math.floor(Math.random() * 4)],
    deviceMemory: [4, 8, 16, 32][Math.floor(Math.random() * 4)],
    platform: ['Win32', 'MacIntel', 'Linux x86_64'][Math.floor(Math.random() * 3)],
  };
}

/**
 * Apply fingerprint to page
 */
async function applyFingerprint(page, fingerprint) {
  // Set user agent
  await page.setUserAgent(fingerprint.userAgent);

  // Set viewport
  await page.setViewport(fingerprint.viewport);

  // Override navigator and screen properties
  await page.evaluateOnNewDocument((fp) => {
    // Override navigator
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => fp.hardwareConcurrency });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => fp.deviceMemory });
    Object.defineProperty(navigator, 'platform', { get: () => fp.platform });

    // Override screen
    Object.defineProperty(screen, 'width', { get: () => fp.screen.width });
    Object.defineProperty(screen, 'height', { get: () => fp.screen.height });
    Object.defineProperty(screen, 'availWidth', { get: () => fp.screen.width });
    Object.defineProperty(screen, 'availHeight', { get: () => fp.screen.height - 40 });

    // Override WebGL
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) return fp.webgl.vendor;
      if (parameter === 37446) return fp.webgl.renderer;
      return getParameter.apply(this, arguments);
    };

    // Randomize canvas fingerprint
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    const toDataURL = HTMLCanvasElement.prototype.toDataURL;
    const getImageData = CanvasRenderingContext2D.prototype.getImageData;

    const noisify = (data) => {
      for (let i = 0; i < data.length; i += 4) {
        data[i] = data[i] + Math.floor(Math.random() * 3) - 1;
        data[i + 1] = data[i + 1] + Math.floor(Math.random() * 3) - 1;
        data[i + 2] = data[i + 2] + Math.floor(Math.random() * 3) - 1;
      }
      return data;
    };

    CanvasRenderingContext2D.prototype.getImageData = function() {
      const imageData = getImageData.apply(this, arguments);
      noisify(imageData.data);
      return imageData;
    };
  }, fingerprint);

  console.log(`[Tab] ✓ Fingerprint applied: ${fingerprint.platform}, ${fingerprint.hardwareConcurrency} cores`);
}

/**
 * Switch account in existing tab (without closing browser)
 */
async function switchAccountInTab(page, newEmail, newPass) {
  console.log(`[Tab] 🔄 Switching account to: ${newEmail}`);

  try {
    // Step 1: Generate new fingerprint
    const fingerprint = generateFingerprint();
    await applyFingerprint(page, fingerprint);

    // Step 2: Clear session data
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    // Step 3: Clear cookies via CDP
    const client = await page.target().createCDPSession();
    await client.send('Network.clearBrowserCookies');
    await client.send('Network.clearBrowserCache');
    await client.detach();

    console.log(`[Tab] ✓ Cleared session data`);

    // Step 3: Navigate to login page
    await page.goto('https://account.minimax.io/unified-login', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await sleep(2000);

    // Step 4: Perform login
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', newEmail, { delay: 30 });
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
    await page.type('input[type="password"]', newPass, { delay: 30 });

    await page.evaluate(() =>
      [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Continue')?.click()
    );
    await sleep(3000);

    // Step 5: Navigate to agent page
    await page.goto('https://agent.minimax.io/', {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });
    await sleep(3000);

    // Step 6: Re-setup response interceptor
    await page.evaluateOnNewDocument((script) => { eval(script); }, INTERCEPTOR_SCRIPT);

    console.log(`[Tab] ✅ Account switched successfully: ${newEmail}`);
    return true;

  } catch(e) {
    console.error(`[Tab] ❌ Account switch failed: ${e.message}`);
    throw e;
  }
}
async function selectModel(page, modelName) {
  // Map API model names to UI names
  const modelMap = {
    'MiniMax-M3': 'MiniMax-M3',
    'MiniMax-M3-thinking': 'MiniMax-M3', // Same UI name, thinking is separate
    'MiniMax-M2.7': 'MiniMax-M2.7',
    'MiniMax-M2.7-highspeed': 'MiniMax-M2.7 HighSpeed' // UI has space + capital H and S
  };

  const uiModelName = modelMap[modelName] || modelName;

  // Retry up to 3 times
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[Tab] Model selection attempt ${attempt}/3: ${uiModelName}`);

      // Click model selector trigger
      const triggerClicked = await page.evaluate(() => {
        const trigger = document.querySelector('[data-testid="model-selector-trigger"]');
        if (!trigger) return false;

        ['mousedown', 'mouseup', 'click'].forEach(type =>
          trigger.dispatchEvent(new MouseEvent(type, { bubbles: true }))
        );
        return true;
      });

      if (!triggerClicked) {
        throw new Error('Model selector trigger not found');
      }

      await sleep(300); // Wait for menu animation

      // Wait for menu to appear (max 2 seconds)
      await page.waitForSelector('[data-testid="model-selector-menu"]', { timeout: 2000 });

      // Select the model
      const modelSelected = await page.evaluate((targetModel) => {
        const menu = document.querySelector('[data-testid="model-selector-menu"]');
        if (!menu) return false;

        const buttons = Array.from(menu.querySelectorAll('button'));
        const targetButton = buttons.find(btn => btn.innerText.includes(targetModel));

        if (targetButton) {
          targetButton.click();
          return true;
        }
        return false;
      }, uiModelName);

      if (!modelSelected) {
        throw new Error(`Model "${uiModelName}" not found in menu`);
      }

      await sleep(500); // Wait for model to switch
      console.log(`[Tab] ✓ Model selected: ${uiModelName}`);
      return true;

    } catch(e) {
      console.warn(`[Tab] Model selection attempt ${attempt} failed: ${e.message}`);

      if (attempt === 3) {
        throw new Error(`Failed to select model "${uiModelName}" after 3 attempts: ${e.message}`);
      }

      // Close any open menu before retry
      await page.evaluate(() => {
        const menu = document.querySelector('[data-testid="model-selector-menu"]');
        if (menu) {
          document.body.click(); // Click outside to close menu
        }
      }).catch(() => {});

      await sleep(1000); // Wait before retry
    }
  }
}

/**
 * Chat with a tab
 */
async function chatWithTab(tabEntry, message, model = 'MiniMax-M3') {
  const { page } = tabEntry;

  console.log(`[Tab] Received model: "${model}"`);

  // Reset interceptor state
  await page.evaluate(() => {
    window.__chatDone = false;
    window.__chatResult = null;
    window.__chatError = null;
  });

  // Check for credit exhaustion message
  const noCredits = await page.evaluate(() =>
    document.body.innerText.includes('do not have enough Credits')
  ).catch(() => false);

  if (noCredits) {
    throw new Error('NO_CREDITS');
  }

  // ── Step 1: Select Model in UI ──
  await selectModel(page, model);

  // ── Step 2: Thinking Mode Control (only for M3) ──
  // M2.7 and M2.7-highspeed: Always have thinking (no toggle)
  // MiniMax-M3-thinking → thinking ON
  // MiniMax-M3 → thinking OFF
  const needsThinking = model === 'MiniMax-M3-thinking';
  const isM3 = model === 'MiniMax-M3' || model === 'MiniMax-M3-thinking';

  if (isM3) {
    try {
      // Check current thinking status
      const currentThinking = await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="model-thinking-trigger-toggle"]');
        if (!btn) return null;
        return btn.getAttribute('aria-checked') === 'true';
      }).catch(() => null);

      console.log(`[Tab] Current thinking: ${currentThinking}, needs: ${needsThinking}`);

      // Toggle if needed
      if (currentThinking !== null && currentThinking !== needsThinking) {
        await page.evaluate(() => {
          const btn = document.querySelector('[data-testid="model-thinking-trigger-toggle"]');
          if (btn) {
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          }
        });
        await sleep(800);

        // Verify
        const afterToggle = await page.evaluate(() => {
          const btn = document.querySelector('[data-testid="model-thinking-trigger-toggle"]');
          return btn ? btn.getAttribute('aria-checked') === 'true' : null;
        }).catch(() => null);

        console.log(`[Tab] Thinking toggled: ${needsThinking ? 'ON' : 'OFF'} (verified: ${afterToggle})`);
      } else {
        console.log(`[Tab] Thinking already correct: ${needsThinking ? 'ON' : 'OFF'}`);
      }
    } catch(e) {
      console.warn(`[Tab] Thinking toggle failed: ${e.message}`);
    }
  }

  // Type message
  await page.waitForSelector('[contenteditable="true"]', { timeout: 10000 });
  await sleep(300);

  await page.evaluate((msg) => {
    const el = document.querySelector('[contenteditable="true"]');
    if (el) {
      el.focus();
      document.execCommand('insertText', false, msg);
    }
  }, message);

  await page.keyboard.press('Enter');

  // Wait for result
  await page.waitForFunction(
    () => window.__chatDone === true,
    { timeout: 120000, polling: 300 }
  );

  const result = await page.evaluate(() => ({
    result: window.__chatResult,
    error: window.__chatError,
    requestBody: window.__requestBody,
  }));

  if (result.error === 'QUOTA_EXCEEDED') {
    throw new Error('QUOTA_EXCEEDED');
  }

  if (!result.result) {
    throw new Error('Empty response');
  }

  // Reset for next task
  await page.evaluate(() => {
    window.__chatDone = false;
    window.__chatResult = null;
    window.__chatError = null;
  });

  // Click "New task" button to reset state
  const clicked = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    const newTaskBtn = buttons.find(btn => {
      const svg = btn.querySelector('svg');
      const span = btn.querySelector('span');
      return svg && span?.textContent?.trim() === 'New task';
    });
    if (newTaskBtn) {
      newTaskBtn.click();
      return true;
    }
    return false;
  }).catch(() => false);

  if (!clicked) {
    // Fallback: reload page
    await page.goto('https://agent.minimax.io/', {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    }).catch(() => {});
    await sleep(1000);
  }

  return result.result;
}

/**
 * Round-robin tab selection
 */
let tabIndex = 0;
function pickTab() {
  const freeTabs = [];

  for (const entry of browserPool) {
    if (entry.stopping) continue; // Skip browsers being removed

    for (const tab of entry.tabs) {
      if (!tab.busy) {
        freeTabs.push({ entry, tab });
      }
    }
  }

  if (freeTabs.length === 0) return null;

  const chosen = freeTabs[tabIndex % freeTabs.length];
  tabIndex++;
  chosen.tab.busy = true;

  return chosen;
}

/**
 * Handle account switching with atomic openedEmails tracking
 * Returns { success: true, account } or { success: false }
 */
async function tryAccountSwitch(entry, tab, errorType) {
  const availableAccounts = getAvailableAccounts();
  const nextAccount = availableAccounts.find(acc =>
    acc.email !== entry.email && !openedEmails.has(acc.email)
  );

  if (!nextAccount) {
    return { success: false };
  }

  // Reserve account atomically BEFORE switching
  openedEmails.add(nextAccount.email);
  const oldEmail = entry.email;

  try {
    console.log(`[${oldEmail}] 🔄 Switching to alternative account: ${nextAccount.email}`);

    await switchAccountInTab(tab.page, nextAccount.email, nextAccount.password);

    // Update pool entry and release old email atomically
    entry.email = nextAccount.email;
    openedEmails.delete(oldEmail);

    console.log(`[${nextAccount.email}] ✅ Account switch successful, browser reused (zero memory spike!)`);

    return {
      success: true,
      account: nextAccount,
      errorType: errorType
    };

  } catch(switchError) {
    // Rollback: release the reserved account, restore old email
    openedEmails.delete(nextAccount.email);
    openedEmails.add(oldEmail);

    console.error(`[${oldEmail}] ❌ Account switch failed: ${switchError.message}`);
    return { success: false, error: switchError };
  }
}

/**
 * Remove browser from pool
 */
async function removeBrowser(entry, reason) {
  console.log(`[${entry.email}] 🔻 Removing from pool: ${reason}`);

  entry.stopping = true;
  const idx = browserPool.indexOf(entry);
  if (idx > -1) browserPool.splice(idx, 1);
  openedEmails.delete(entry.email);

  // Wait for all tabs to finish, then close
  const closeAsync = async () => {
    while (entry.tabs.some(t => t.busy)) {
      await sleep(500);
    }

    try {
      await entry.browser.close();
      const aidx = allBrowsers.indexOf(entry.browser);
      if (aidx > -1) allBrowsers.splice(aidx, 1);
      console.log(`[${entry.email}] ✓ Browser closed`);
    } catch(e) {
      console.error(`[${entry.email}] Failed to close browser: ${e.message}`);
    }
  };

  closeAsync().catch(() => {});
}

/**
 * HTTP server
 */
const server = httpPlain.createServer(async (req, res) => {
  // Status endpoint
  if (req.method === 'GET' && req.url === '/status') {
    const totalSlots = browserPool.reduce((s, b) => s + b.tabs.length, 0);
    const usedSlots = browserPool.reduce((s, b) => s + b.tabs.filter(t => t.busy).length, 0);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      tabs_available: totalSlots - usedSlots,
      tabs_total: totalSlots,
      accounts: browserPool.length,
      emails: browserPool.map(b => b.email),
    }), 'utf8');
    return;
  }

  // Chat endpoint
  if (req.method !== 'POST' || req.url !== '/chat') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  let body = '';
  req.on('data', d => body += d);
  req.on('end', async () => {
    try {
      const { message, model } = JSON.parse(body);

      // Wait for available tab (max 30s)
      const start = Date.now();
      let picked = null;

      while (!picked && Date.now() - start < 30000) {
        picked = pickTab();
        if (!picked) await sleep(200);
      }

      if (!picked) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'No tabs available' }), 'utf8');
        return;
      }

      const { entry, tab } = picked;

      try {
        const result = await chatWithTab(tab, message, model || 'MiniMax-M3');

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          ...result,
          account_email: entry.email
        }), 'utf8');

      } catch(e) {
        const errorType = e.message;

        if (errorType === 'NO_CREDITS') {
          markAccountTemporarilyDepleted(entry.email);

          const switchResult = await tryAccountSwitch(entry, tab, errorType);

          if (switchResult.success) {
            res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
              error: 'NO_CREDITS',
              message: 'Switched to alternative account, please retry',
              account_email: switchResult.account.email,
              switched: true
            }), 'utf8');
          } else {
            // No alternative or switch failed, close browser
            console.log(`[${entry.email}] ❌ No alternative account available, closing browser`);
            await removeBrowser(entry, 'Temporary credit exhaustion (24h cooldown), no alternative');

            res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
              error: errorType,
              account_email: entry.email
            }), 'utf8');
          }

        } else if (errorType === 'QUOTA_EXCEEDED') {
          markAccountPermanentlyDepleted(entry.email);

          const switchResult = await tryAccountSwitch(entry, tab, errorType);

          if (switchResult.success) {
            res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
              error: 'QUOTA_EXCEEDED',
              message: 'Switched to alternative account, please retry',
              account_email: switchResult.account.email,
              switched: true
            }), 'utf8');
          } else {
            console.log(`[${entry.email}] ❌ Quota exceeded, no alternative account`);
            await removeBrowser(entry, 'Permanent quota exceeded, no alternative');

            res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
              error: errorType,
              account_email: entry.email
            }), 'utf8');
          }
        } else {
          // Other errors: just return error
          res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            error: errorType,
            account_email: entry.email
          }), 'utf8');
        }

      } finally {
        tab.busy = false;
      }

    } catch(e) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }), 'utf8');
    }
  });
});

/**
 * Get available accounts (filter out depleted and in-cooldown)
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
 * Initialize browsers
 */
async function initBrowsers() {
  let accounts = getAvailableAccounts();

  if (MAX_BROWSERS > 0) {
    accounts = accounts.slice(0, MAX_BROWSERS);
  }

  console.log(`\n[Init] Found ${accounts.length} available accounts`);

  if (accounts.length === 0) {
    console.log('[Init] ⚠️  No accounts available - server running in standby mode');
    return;
  }

  for (const acc of accounts) {
    try {
      const { browser, tabs } = await loginBrowser(acc.email, acc.password);
      browserPool.push({ browser, email: acc.email, tabs, stopping: false });
      openedEmails.add(acc.email);

      console.log(`[Init] ✅ ${acc.email} added to pool (${tabs.length} tabs)`);
    } catch(e) {
      console.error(`[Init] ❌ ${acc.email} failed: ${e.message}`);
    }

    await sleep(2000); // Stagger browser launches
  }

  const totalTabs = browserPool.reduce((s, b) => s + b.tabs.length, 0);
  console.log(`\n[Init] ✅ ${browserPool.length} browsers ready with ${totalTabs} total tabs\n`);
}

/**
 * Watch for new accounts
 */
function startAccountWatcher() {
  setInterval(async () => {
    try {
      const newAccounts = getAvailableAccounts().filter(acc =>
        !openedEmails.has(acc.email)
      );

      if (newAccounts.length === 0) return;

      console.log(`[Watcher] Found ${newAccounts.length} new account(s)`);

      for (const acc of newAccounts) {
        try {
          const { browser, tabs } = await loginBrowser(acc.email, acc.password);
          browserPool.push({ browser, email: acc.email, tabs, stopping: false });
          openedEmails.add(acc.email);

          console.log(`[Watcher] ✅ ${acc.email} added (${tabs.length} tabs). Total browsers: ${browserPool.length}`);
        } catch(e) {
          console.error(`[Watcher] ❌ ${acc.email} failed: ${e.message}`);
        }

        await sleep(2000);
      }
    } catch(e) {
      console.error(`[Watcher] Error: ${e.message}`);
    }
  }, 30000); // Check every 30s
}

/**
 * Main
 */
(async () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║  Lazy Session Server v7 - Production Grade                ║
╚═══════════════════════════════════════════════════════════╝
  Port: ${PORT}
  Max Browsers: ${MAX_BROWSERS || 'Unlimited'}
  Tabs per Browser: ${TABS_PER_BROWSER}

  Features:
  ✓ Tab pool with round-robin allocation
  ✓ 24h cooldown for temporary credit exhaustion
  ✓ Permanent depletion for quota exceeded
  ✓ Auto-recovery when cooldown expires
  ✓ Dynamic account addition (30s refresh)
`);

  server.listen(PORT, () => {
    console.log(`[Server] Listening on http://localhost:${PORT}`);
    console.log(`[Server] Status: http://localhost:${PORT}/status\n`);
  });

  await initBrowsers();
  startAccountWatcher();
})();
