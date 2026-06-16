/**
 * MiniMax saf HTTP kayıt scripti
 *
 * İmza algoritmaları (HAR'dan doğrulandı):
 *   x-signature = MD5(ts_seconds + "I*7Cf%WZ#S&%1RlZJ&C2" + body_json)
 *   yy           = MD5(encodeURIComponent(path?query) + "_" + body_json + MD5(ts_ms) + "ooui")
 *
 * authToken = RSA_PKCS1v15_encrypt(password, PUBLIC_KEY) → hex → base64
 *
 * Kullanım:
 *   node register.js                        # rastgele email
 *   node register.js --email x@domain.com
 *   node register.js --count 5 --out accounts.json
 */

import crypto from 'crypto';
import https  from 'https';
import http   from 'http';
import { URL } from 'url';
import fs     from 'fs';
import forge  from 'node-forge';
import puppeteer from 'puppeteer';

// ── Sabitler ──────────────────────────────────────────────────────────────────

const SECRET     = 'I*7Cf%WZ#S&%1RlZJ&C2';
const BASE       = 'https://account.minimax.io';
const GUERRILLA  = 'https://www.guerrillamail.com/ajax.php';

// Proxy: env'dan al (REGISTER_PROXY_URL)
const PROXY_URL = process.env.REGISTER_PROXY_URL;
if (!PROXY_URL) {
  console.error('ERROR: REGISTER_PROXY_URL environment variable is required for account registration.');
  console.error('Set it in your shell or .env file: export REGISTER_PROXY_URL="http://user:pass@host:port"');
  process.exit(1);
}
const _proxyUrl = new URL(PROXY_URL);
const PROXY = { host: _proxyUrl.hostname, port: parseInt(_proxyUrl.port), user: _proxyUrl.username, pass: _proxyUrl.password };
const PUBLIC_KEY =
  '-----BEGIN PUBLIC KEY-----\n' +
  'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDF5ndG2/UB4L5tbvQaNLHSoBTW\n' +
  'DKbrNBuOmUIP23eCmC2ELMx3kppEikxTp5cV8NxUZl6ii+KLwKugioAXApzypHXb\n' +
  'gXbq13kTKA7OCA1xtAoMdH9cltjBiFAUJlgmVjr0MuJCknhVAjWLjCVRHege+Atl\n' +
  'gkUBUeGa9O+cWcPEwQIDAQAB\n' +
  '-----END PUBLIC KEY-----';

// ── Kripto ────────────────────────────────────────────────────────────────────

function md5(s) {
  return crypto.createHash('md5').update(s).digest('hex');
}

function xSignature(tsSeconds, bodyStr) {
  return md5(`${tsSeconds}${SECRET}${bodyStr}`);
}

function yyHeader(pathAndQuery, bodyStr, tsMs) {
  return md5(`${encodeURIComponent(pathAndQuery)}_${bodyStr}${md5(String(tsMs))}ooui`);
}

// RSA PKCS1v15 encrypt → hex string → base64 (JS'teki davranışla aynı)
function rsaEncrypt(plaintext) {
  const pubKey = forge.pki.publicKeyFromPem(PUBLIC_KEY);
  const encrypted = pubKey.encrypt(plaintext, 'RSAES-PKCS1-V1_5');
  // forge hex → base64
  return forge.util.encode64(encrypted);
}

// ── Akamai Cookie Alma ───────────────────────────────────────────────────────

async function getAkamaiCookie() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:151.0) Gecko/20100101 Firefox/151.0');

    await page.goto('https://account.minimax.io/unified-login', {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    // Akamai cookie'sinin oluşması için daha uzun bekle + etkileşim yap
    await new Promise(r => setTimeout(r, 2000));

    // Sayfayla etkileşim kur (Akamai bot detection için)
    await page.mouse.move(100, 100);
    await new Promise(r => setTimeout(r, 1000));
    await page.mouse.move(200, 200);
    await new Promise(r => setTimeout(r, 2000));

    const cookies = await page.cookies();

    // Tüm cookie'leri logla
    console.log(`[DEBUG] Tüm cookies: ${cookies.map(c => c.name).join(', ')}`);

    const akamaiCookie = cookies.find(c =>
      c.name.startsWith('ak_bmsc') ||
      c.name.startsWith('bm_') ||
      c.name.startsWith('_abck')
    );

    await browser.close();

    if (akamaiCookie) {
      // Tüm Akamai/bot detection cookie'lerini birleştir
      const allAkamaiCookies = cookies
        .filter(c => c.name.startsWith('ak_bmsc') || c.name.startsWith('bm_') || c.name.startsWith('_abck'))
        .map(c => `${c.name}=${c.value}`)
        .join('; ');

      return allAkamaiCookies;
    }

    return null;
  } catch (err) {
    await browser.close();
    throw err;
  }
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

// HTTPS CONNECT tüneli üzerinden istek
function tunnel(targetUrl, method, headers, bodyStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const connectReq = http.request({
      host: PROXY.host,
      port: PROXY.port,
      method: 'CONNECT',
      path: `${u.hostname}:443`,
      headers: {
        'Proxy-Authorization': 'Basic ' + Buffer.from(`${PROXY.user}:${PROXY.pass}`).toString('base64'),
        'Host': `${u.hostname}:443`,
      },
    });
    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Proxy CONNECT failed: ${res.statusCode}`));
        return;
      }
      const req = https.request({
        host: u.hostname,
        port: 443,
        path: u.pathname + u.search,
        method,
        headers,
        socket,
        agent: false,
      }, r => {
        let data = '';
        r.on('data', d => (data += d));
        r.on('end', () => {
          try   { resolve({ status: r.statusCode, headers: r.headers, body: JSON.parse(data) }); }
          catch { resolve({ status: r.statusCode, headers: r.headers, body: data }); }
        });
      });
      req.on('error', reject);
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
    connectReq.on('error', reject);
    connectReq.end();
  });
}

function httpRequest(method, url, body, akamaiCookie = null) {
  const u       = new URL(url);
  const bodyStr = body != null ? JSON.stringify(body) : '';
  const tsMs    = Date.now();
  const tsS     = Math.floor(tsMs / 1000);

  // unix query parametresini tsMs ile güncelle (senkronizasyon)
  u.searchParams.set('unix', String(tsMs));

  const headers = {
    'User-Agent'     : 'Mozilla/5.0 (X11; Linux x86_64; rv:151.0) Gecko/20100101 Firefox/151.0',
    'Accept'         : 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Content-Type'   : 'application/json',
    'Origin'         : BASE,
    'Referer'        : `${BASE}/unified-login`,
    'Host'           : u.hostname,
    'x-timestamp'    : String(tsS),
    'x-signature'    : xSignature(tsS, bodyStr),
    'yy'             : yyHeader(u.pathname + u.search, bodyStr, tsMs),
  };
  if (akamaiCookie) {
    headers['Cookie'] = akamaiCookie;
  }
  if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);

  return tunnel(url, method, headers, bodyStr);
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    // Guerrilla Mail HTTP(S) — proxy üzerinden
    const connectReq = http.request({
      host: PROXY.host,
      port: PROXY.port,
      method: 'CONNECT',
      path: `${u.hostname}:443`,
      headers: {
        'Proxy-Authorization': 'Basic ' + Buffer.from(`${PROXY.user}:${PROXY.pass}`).toString('base64'),
        'Host': `${u.hostname}:443`,
      },
    });
    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { reject(new Error(`Proxy CONNECT failed: ${res.statusCode}`)); return; }
      const req = https.request({
        host: u.hostname, port: 443,
        path: u.pathname + u.search,
        method: 'GET',
        headers: { 'Host': u.hostname, 'User-Agent': 'node' },
        socket, agent: false,
      }, r => {
        let d = '';
        r.on('data', c => (d += c));
        r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
      });
      req.on('error', reject);
      req.end();
    });
    connectReq.on('error', reject);
    connectReq.end();
  });
}

// Ham GET — redirect takip etmez, status + headers + body döner
function httpGetRaw(url, cookie = '') {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const connectReq = http.request({
      host: PROXY.host, port: PROXY.port,
      method: 'CONNECT', path: `${u.hostname}:443`,
      headers: {
        'Proxy-Authorization': 'Basic ' + Buffer.from(`${PROXY.user}:${PROXY.pass}`).toString('base64'),
        'Host': `${u.hostname}:443`,
      },
    });
    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { reject(new Error(`Proxy CONNECT: ${res.statusCode}`)); return; }
      const reqHeaders = {
        'Host': u.hostname,
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:151.0) Gecko/20100101 Firefox/151.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
      };
      if (cookie) reqHeaders['Cookie'] = cookie;
      if (u.hostname === 'agent.minimax.io') {
        reqHeaders['Referer'] = 'https://account.minimax.io/';
        reqHeaders['Origin'] = 'https://account.minimax.io';
      }
      const req = https.request({
        host: u.hostname, port: 443,
        path: u.pathname + u.search,
        method: 'GET',
        headers: reqHeaders,
        socket, agent: false,
      }, r => {
        const chunks = [];
        r.on('data', c => chunks.push(c));
        r.on('end', () => {
          let body = Buffer.concat(chunks);
          // Decompress if gzipped
          const encoding = r.headers['content-encoding'];
          if (encoding === 'gzip' || encoding === 'deflate') {
            try {
              const zlib = require('zlib');
              body = encoding === 'gzip' ? zlib.gunzipSync(body) : zlib.inflateSync(body);
            } catch (e) {
              // If decompression fails, use raw
            }
          }
          resolve({ status: r.statusCode, headers: r.headers, body: body.toString('utf8') });
        });
      });
      req.on('error', reject);
      req.end();
    });
    connectReq.on('error', reject);
    connectReq.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function curlGet(url, cookie = '') {
  const cookieArg = cookie ? `-H "Cookie: ${cookie}"` : '';
  const cmd = `curl -s -L -w "\\n__STATUS__%{http_code}__HEADERS__%{header_json}" --max-redirs 5 -A "Mozilla/5.0 (X11; Linux x86_64; rv:151.0) Gecko/20100101 Firefox/151.0" ${cookieArg} "${url}"`;
  try {
    const out = execSync(cmd, { maxBuffer: 10 * 1024 * 1024 }).toString();
    const statusMatch = out.match(/__STATUS__(\d+)__HEADERS__(.*)/s);
    if (!statusMatch) return { status: 0, body: out, headers: {} };
    const body = out.slice(0, out.lastIndexOf('\n__STATUS__'));
    return { status: parseInt(statusMatch[1]), body, headers: {} };
  } catch (e) {
    return { status: 0, body: e.message, headers: {} };
  }
}

// ── Device params ─────────────────────────────────────────────────────────────

function deviceParams(deviceId, uuid, tsMs) {
  return new URLSearchParams({
    device_platform : 'web',
    biz_id          : '3',
    app_id          : '3001',
    version_code    : '22201',
    unix            : String(tsMs || Date.now()),
    timezone_offset : '10800',
    lang            : 'en',
    sys_language    : 'en',
    uuid,
    device_id       : deviceId,
    os_name         : 'h5',
    browser_name    : 'firefox',
    cpu_core_num    : '8',
    browser_language: 'en-US',
    browser_platform: 'Linux x86_64',
    screen_width    : '1920',
    screen_height   : '1080',
    client          : 'web',
  }).toString();
}

// ── Guerrilla Mail ────────────────────────────────────────────────────────────

async function createEmail() {
  // 直接用API，测试原始域名是否被封
  const data = await httpGet(`${GUERRILLA}?f=get_email_address`);
  if (!data?.sid_token) throw new Error('Guerrilla Mail session failed');

  const email = data.email_addr;  // 使用API原始返回的email（不修改域名）
  console.log(`[DEBUG] Guerrilla Mail API email: ${email}, domain: ${email.split('@')[1]}`);

  return { email, sid: data.sid_token };
}

async function waitForOTP(sid, maxMs = 90_000, browserMethod = false) {
  if (browserMethod) {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      const page = await browser.newPage();

      await page.setCookie({
        name: 'PHPSESSID',
        value: sid,
        domain: '.guerrillamail.com',
        path: '/'
      });

      const deadline = Date.now() + maxMs;
      let checkCount = 0;
      let backoffMs = 2000;

      while (Date.now() < deadline) {
        checkCount++;
        await page.goto('https://www.guerrillamail.com', { waitUntil: 'networkidle0' });
        await new Promise(r => setTimeout(r, Math.min(backoffMs, 5000)));
        backoffMs = Math.min(backoffMs * 1.5, 8000);

        // Debug: 当前显示的email地址
        const currentEmail = await page.$eval('#email-widget', el => el.value).catch(() => 'unknown');
        console.log(`[OTP CHECK ${checkCount}] Current email: ${currentEmail}`);

        // Email listesini kontrol et - mail_id'yi de al
        const emails = await page.$$eval('table tr', rows => {
          return rows.map(row => {
            const from = row.querySelector('td:nth-child(2)')?.textContent || '';
            const subject = row.querySelector('td:nth-child(3)')?.textContent || '';
            const link = row.querySelector('a')?.href || '';
            const mailIdMatch = link.match(/mail_id=(\d+)/);
            return { from, subject, mailId: mailIdMatch ? mailIdMatch[1] : null };
          }).filter(e => e.mailId);
        }).catch(() => []);

        console.log(`[OTP CHECK ${checkCount}] Inbox has ${emails.length} emails`);
        if (emails.length > 0) {
          console.log(`[OTP CHECK ${checkCount}] First email from: ${emails[0].from}`);
        }

        const minimaxEmails = emails.filter(e =>
          e.from.includes('minimax') ||
          e.from.includes('noreply') ||
          e.from.includes('no_reply') ||
          e.subject.includes('OTP') ||
          e.subject.includes('code')
        );

        if (minimaxEmails.length > 0) {
          console.log(`[OTP CHECK ${checkCount}] Found MiniMax email (ID: ${minimaxEmails[0].mailId}), opening...`);

          // 直接导航到邮件URL
          await page.goto(`https://www.guerrillamail.com/inbox?mail_id=${minimaxEmails[0].mailId}`, {
            waitUntil: 'networkidle0'
          });
          await new Promise(r => setTimeout(r, 1000));

          // Email body'den OTP çıkar
          const body = await page.$eval('#email_body', el => el.textContent).catch(() => '');
          console.log(`[OTP CHECK ${checkCount}] Email body length: ${body.length}, preview: ${body.slice(0, 200)}`);

          const match = body.match(/\b(\d{6})\b/);

          if (match) {
            console.log(`[OTP CHECK ${checkCount}] ✓ Found OTP: ${match[1]}`);
            await browser.close();
            return match[1];
          } else {
            console.log(`[OTP CHECK ${checkCount}] No OTP found in body`);
          }
        }

        await new Promise(r => setTimeout(r, 3000));
      }

      console.log(`[OTP] Timeout after ${checkCount} checks`);
      await browser.close();
      return null;
    } catch (err) {
      console.log(`[OTP] Error: ${err.message}`);
      await browser.close();
      throw err;
    }
  }

  // Fallback: API metodu (eski kod)
  const deadline = Date.now() + maxMs;
  process.stdout.write(`[OTP] Bekleniyor (max ${maxMs / 1000}s)`);
  let seq = 0;
  while (Date.now() < deadline) {
    const data = await httpGet(`${GUERRILLA}?f=check_email&seq=${seq}&sid_token=${sid}`).catch(() => null);
    if (data?.list?.length) {
      for (const mail of data.list) {
        const text = (mail.mail_body || '') + (mail.mail_excerpt || '') + (mail.mail_subject || '');
        const m = text.match(/\b(\d{6})\b/);
        if (m) { process.stdout.write('\n'); return m[1]; }
      }
      seq = data.list[data.list.length - 1].mail_id;
    }
    process.stdout.write('.');
    await sleep(3000);
  }
  process.stdout.write('\n');
  return null;
}

// ── Kayıt akışı ───────────────────────────────────────────────────────────────

async function register(emailArg) {
  const password = 'Mm' + crypto.randomBytes(8).toString('hex') + '!7';
  const uuid     = crypto.randomUUID();

  // Akamai cookie不是必需的（测试证明没有也能成功）
  const akamaiCookie = null;

  // Email + Guerrilla Mail oturumu
  let email, sid;
  if (emailArg) {
    email = emailArg;
    const g = await createEmail();
    sid = g.sid;
    // oturumu verilen adrese yönlendir
    await httpGet(`${GUERRILLA}?f=set_email_user&email_user=${encodeURIComponent(emailArg.split('@')[0])}&sid_token=${sid}`).catch(() => {});
  } else {
    const g = await createEmail();
    email = g.email;
    sid   = g.sid;
  }

  console.log('\n' + '='.repeat(60));
  console.log('MiniMax Kayıt');
  console.log('='.repeat(60));
  console.log(`Email   : ${email}`);
  console.log(`Password: ${password}`);

  // authToken = RSA(password)
  const authToken = rsaEncrypt(password);
  console.log(`AuthTok : ${authToken.slice(0, 30)}...`);

  // 1. Device register
  console.log('\n[1/5] Device register...');
  const dp1 = deviceParams('0', uuid);
  const r1  = await httpRequest('POST', `${BASE}/v1/api/user/device/register?${dp1}`, { uuid });
  if (r1.body?.statusInfo?.code !== 0) {
    console.error(`[HATA] device/register: ${JSON.stringify(r1.body?.statusInfo)}`);
    return null;
  }
  const deviceId = r1.body.data.deviceIDStr;
  console.log(`[OK] deviceID: ${deviceId}`);

  // 2. Email kontrol (yeni kullanıcı doğrula → 1200056 beklenir)
  console.log('\n[2/5] Email kontrol...');
  const csrf = crypto.randomUUID();
  const state = JSON.stringify({ redirect_uri: 'https://agent.minimax.io/', csrf });
  const loginRedirect = `/oauth2/authorize?client_id=agent-minimax&redirect_uri=https%3A%2F%2Fagent.minimax.io%2Fauth%2Fcallback&response_type=code&source=agent_web&state=${encodeURIComponent(state)}`;
  const dp2 = deviceParams(deviceId, uuid);
  const r2  = await httpRequest('POST', `${BASE}/oauth2/login?${dp2}`, {
    loginType: '20',
    email,
    authToken: null,
    deviceID : deviceId,
    login_redirect: loginRedirect,
  });
  const code2 = r2.body?.statusInfo?.code;
  if (code2 !== 0 && code2 !== 1200056) {
    console.error(`[HATA] email check: ${JSON.stringify(r2.body?.statusInfo)}`);
    return null;
  }
  console.log(`[OK] code: ${code2} — ${r2.body?.statusInfo?.message}`);

  // 3. OTP gönder
  console.log('\n[3/5] OTP gönderiliyor...');
  await sleep(3000); // SMS rate limit bypass
  const dp3 = deviceParams(deviceId, uuid);
  const smsBody = { email, phone: '' };
  console.log(`[DEBUG] sms/send URL params: ${dp3.slice(0,100)}`);
  console.log(`[DEBUG] sms/send body: ${JSON.stringify(smsBody)}`);

  // Akamai cookie ile request gönder
  const smsUrl = `${BASE}/v1/api/user/login/sms/send?${dp3}`;
  const r3 = await httpRequest('POST', smsUrl, smsBody, akamaiCookie);

  console.log(`[DEBUG] sms/send resp: ${JSON.stringify(r3.body)}`);
  if (r3.body?.statusInfo?.code !== 0) {
    console.error(`[HATA] sms/send: ${JSON.stringify(r3.body?.statusInfo)}`);
    return null;
  }
  console.log('[OK] OTP gönderildi');

  // 4. OTP bekle
  console.log('\n[4/5] OTP bekleniyor...');
  const otp = await waitForOTP(sid, 90000, false);  // 用API方法，不用Puppeteer
  if (!otp) {
    console.error('[HATA] OTP timeout');
    return null;
  }
  console.log(`[OK] OTP: ${otp}`);

  // 5. Kayıt tamamla
  console.log('\n[5/5] Kayıt tamamlanıyor...');
  const dp5 = deviceParams(deviceId, uuid);
  const r5  = await httpRequest('POST', `${BASE}/oauth2/login?${dp5}`, {
    loginType: '20',
    email,
    authToken,
    code     : otp,
    deviceID : deviceId,
    login_redirect: loginRedirect,
  });

  // Set-Cookie headerlarını topla
  const setCookies = r5.headers?.['set-cookie'] || [];
  const cookieStr = (Array.isArray(setCookies) ? setCookies : [setCookies])
    .map(c => c.split(';')[0]).join('; ');
  console.log(`[OK] Cookies: ${cookieStr.slice(0, 80) || '(yok)'}`);

  // Başarı koşulu: statusInfo.code=0 VEYA top-level code=0
  const ok = r5.body?.statusInfo?.code === 0 || r5.body?.code === 0;
  if (!ok) {
    console.error(`[HATA] register: ${JSON.stringify(r5.body?.statusInfo || r5.body)}`);
    return null;
  }

  console.log('\n' + '='.repeat(60));
  console.log('KAYIT BAŞARILI');
  console.log('='.repeat(60));
  console.log(`Email   : ${email}`);
  console.log(`Password: ${password}`);
  const d = r5.body?.data;
  if (d) console.log('Data:', JSON.stringify(d, null, 2));

  return { email, password, deviceId, uuid, data: d, jwtToken: null, realUserId: null, token: null };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const args     = process.argv.slice(2);
const getArg   = f => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
const email    = getArg('--email');
const count    = parseInt(getArg('--count') || '1', 10);
const outFile  = getArg('--out');
const parallel = args.includes('--parallel');

const accounts = [];

if (parallel && count > 1) {
  console.log(`Paralel mod: ${count} hesap aynı anda oluşturuluyor...`);
  const results = await Promise.all(
    Array.from({ length: count }, (_, i) => {
      console.log(`[${i+1}] Başlatılıyor...`);
      return register(email).then(r => {
        if (r) { accounts.push(r); console.log(`[${i+1}] ✓ ${r.email}`); }
        else console.log(`[${i+1}] ✗ Başarısız`);
        return r;
      }).catch(e => { console.log(`[${i+1}] ✗ ${e.message}`); return null; });
    })
  );
} else {
  for (let i = 0; i < count; i++) {
    if (count > 1) console.log(`\n${'#'.repeat(40)}\nHesap ${i + 1}/${count}\n${'#'.repeat(40)}`);
    const result = await register(email);
    if (result) accounts.push(result);
    else console.log(`\n✗ Hesap ${i + 1} başarısız`);
    if (i < count - 1) { console.log('\n15s bekleniyor...'); await sleep(15000); }
  }
}

if (outFile && accounts.length) {
  fs.writeFileSync(outFile, JSON.stringify(accounts, null, 2));
  console.log(`\n✓ ${accounts.length} hesap kaydedildi: ${outFile}`);
}

console.log(`\nSonuç: ${accounts.length}/${count} başarılı`);
