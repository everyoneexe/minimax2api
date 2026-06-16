/**
 * Lazy Session - Her istek için yeni chat açar, cevabı stdout'a yazar
 * Streaming destekler — her chunk ayrı JSON satırı olarak stdout'a yazılır
 *
 * Kullanım:
 *   node lazy_session.js --email E --pass P --message "mesaj" --model "MiniMax-M3"
 *
 * Çıktı:
 *   {"type":"chunk","content":"...","thinking":"..."}  (streaming chunks)
 *   {"type":"done","content":"...","thinking":"..."}   (final)
 *   {"type":"error","message":"..."}
 */
import puppeteer from 'puppeteer';
import crypto from 'crypto';
import { URL } from 'url';

const args = process.argv.slice(2);
const getArg = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };

const EMAIL   = getArg('--email');
const PASS    = getArg('--pass');
const MESSAGE = getArg('--message') || 'hi';
const MODEL   = getArg('--model') || 'MiniMax-M3';
const SECRET  = 'I*7Cf%WZ#S&%1RlZJ&C2';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }


async function run() {
  if (!EMAIL || !PASS) {
    log({ type: 'error', message: 'EMAIL and PASS required' });
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', req => req.continue());

    // Login
    await page.goto('https://account.minimax.io/unified-login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2000);
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', EMAIL, { delay: 30 });
    await sleep(300);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.querySelector('.rounded-full'));
      if (btn) btn.click();
    });
    await sleep(300);
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Continue')?.click());
    await sleep(3000);
    await page.waitForSelector('input[type="password"]', { timeout: 5000 });
    await page.type('input[type="password"]', PASS, { delay: 30 });
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Continue')?.click());
    await sleep(3000);
    await page.goto('https://agent.minimax.io/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(3000);

    // Check credits
    const noCredits = await page.evaluate(() =>
      document.body.innerText.includes('do not have enough Credits')
    ).catch(() => false);
    if (noCredits) { log({ type: 'error', message: 'NO_CREDITS' }); return; }

    // Capture session AND response in one go
    let sessionInfo = null;
    let finalContent = '';
    let thinkingContent = '';
    let isDone = false;

    const sessionPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Session timeout')), 60000);

      page.on('response', async (resp) => {
        const url = resp.url();

        // Capture session_id
        if (url.includes('/agent/') && url.includes('/session?') && resp.request().method() === 'POST') {
          try {
            const data = JSON.parse(await resp.text());
            if (data.session_id) {
              const reqUrl = resp.request().url();
              const params = new URL(reqUrl).searchParams;
              const headers = resp.request().headers();
              sessionInfo = {
                session_id: data.session_id,
                token: headers['token'],
                user_id: params.get('user_id'),
                device_id: params.get('device_id'),
                uuid: params.get('uuid'),
              };
              log({ type: 'session', session_id: sessionInfo.session_id });
            }
          } catch(e) {}
        }

        // Capture SSE stream response
        if (url.includes('/session/') && url.includes('/message') && resp.request().method() === 'POST') {
          try {
            const text = await resp.text();
            for (const line of text.split('\n')) {
              if (!line.startsWith('data:')) continue;
              const raw = line.slice(5).trim();
              if (!raw) continue;
              try {
                const event = JSON.parse(raw);
                if (event.type === 6) {
                  const c = event.agent_message_chunk || {};
                  if (c.msg_content) {
                    finalContent += c.msg_content;
                    log({ type: 'chunk', content: c.msg_content, thinking: '' });
                  }
                  if (c.thinking_content) {
                    thinkingContent += c.thinking_content;
                    log({ type: 'thinking', content: '', thinking: c.thinking_content });
                  }
                  if (c.finish_reason === 'error') { reject(new Error('QUOTA_EXCEEDED')); return; }
                  if (c.finish) { isDone = true; }
                } else if (event.type === 2) {
                  const msg = event.agent_message || {};
                  if (msg.role === 'assistant') {
                    if (msg.msg_content) finalContent = msg.msg_content;
                    if (msg.thinking_content) thinkingContent = msg.thinking_content;
                    if (msg.finish_reason !== 'error') isDone = true;
                    else { reject(new Error('QUOTA_EXCEEDED')); return; }
                  }
                }
              } catch(e) {}
            }
            if (isDone) {
              clearTimeout(timeout);
              resolve();
            }
          } catch(e) {}
        }
      });
    });

    // Type message to trigger session creation + response
    await page.waitForSelector('[contenteditable="true"]', { timeout: 15000 });
    await sleep(500);
    await page.evaluate((msg) => {
      const el = document.querySelector('[contenteditable="true"]');
      if (el) { el.focus(); document.execCommand('insertText', false, msg); }
    }, MESSAGE);
    await page.keyboard.press('Enter');

    await sessionPromise;
    log({ type: 'done', content: finalContent, thinking: thinkingContent });

  } catch(e) {
    log({ type: 'error', message: e.message });
  } finally {
    await browser.close();
  }
}

run();
