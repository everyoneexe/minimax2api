/**
 * Proxy olmadan token al - sadece Puppeteer
 */
import puppeteer from 'puppeteer';
import crypto from 'crypto';
import forge from 'node-forge';

const SECRET = 'I*7Cf%WZ#S&%1RlZJ&C2';
const BASE = 'https://account.minimax.io';

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDF5ndG2/UB4L5tbvQaNLHSoBTW
DKbrNBuOmUIP23eCmC2ELMx3kppEikxTp5cV8NxUZl6ii+KLwKugioAXApzypHXb
gXbq13kTKA7OCA1xtAoMdH9cltjBiFAUJlgmVjr0MuJCknhVAjWLjCVRHege+Atl
gkUBUeGa9O+cWcPEwQIDAQAB
-----END PUBLIC KEY-----`;

function md5(s) {
  return crypto.createHash('md5').update(s).digest('hex');
}

function deviceParams(deviceId, uuid, tsMs) {
  return new URLSearchParams({
    device_platform: 'web', biz_id: '3', app_id: '3001',
    version_code: '22201', unix: String(tsMs), timezone_offset: '10800',
    lang: 'en', sys_language: 'en', uuid, device_id: deviceId,
    os_name: 'h5', browser_name: 'chrome', device_memory: '8',
    cpu_core_num: '16', browser_language: 'en-US',
    browser_platform: 'Linux x86_64', screen_width: '1920',
    screen_height: '1080', client: 'web',
  }).toString();
}

(async () => {
  const [,, email, password] = process.argv;
  if (!email || !password) {
    console.error('Kullanım: node puppeteer_token.js EMAIL PASSWORD');
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();

    // Login kredensiyallerini hazırla
    const uuid = crypto.randomUUID();
    const deviceId = String(10000000 + Math.floor(Math.random() * 90000000));
    const tsMs = Date.now();
    const tsS = Math.floor(tsMs / 1000);
    const csrf = crypto.randomUUID();
    const state = JSON.stringify({ redirect_uri: 'https://agent.minimax.io/', csrf });
    const loginRedirect = `/oauth2/authorize?client_id=agent-minimax&redirect_uri=https%3A%2F%2Fagent.minimax.io%2Fauth%2Fcallback&response_type=code&source=agent_web&state=${encodeURIComponent(state)}`;

    const pubKey = forge.pki.publicKeyFromPem(PUBLIC_KEY);
    const encrypted = pubKey.encrypt(password, 'RSAES-PKCS1-V1_5');
    const authToken = forge.util.encode64(encrypted);

    const dp = deviceParams(deviceId, uuid, tsMs);
    const body = { loginType: '20', email, authToken, deviceID: deviceId, login_redirect: loginRedirect };
    const bodyStr = JSON.stringify(body);

    const loginUrl = `${BASE}/oauth2/login?${dp}`;
    const headers = {
      'Content-Type': 'application/json',
      'x-timestamp': String(tsS),
      'x-signature': md5(`${tsS}${SECRET}${bodyStr}`),
      'yy': md5(`${encodeURIComponent(`/oauth2/login?${dp}`)}_${bodyStr}${md5(String(tsMs))}ooui`),
    };

    console.log('[1] HTTP login yapılıyor...');

    // Puppeteer ile POST request
    const response = await page.evaluate(async (url, headers, body) => {
      const resp = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: body
      });
      return {
        status: resp.status,
        data: await resp.json()
      };
    }, loginUrl, headers, bodyStr);

    if (response.status !== 200 || response.data.code !== 0) {
      throw new Error(`Login failed: ${JSON.stringify(response.data)}`);
    }

    console.log('[1] ✓ Login başarılı');

    const redirectPath = response.data.data.login_redirect;
    const authorizeUrl = `${BASE}${redirectPath}`;

    console.log('[2] OAuth flow başlatılıyor...');

    // Authorize URL'e git
    await page.goto(authorizeUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 5000));

    console.log('[3] Token kontrol ediliyor...');
    const cookies = await page.cookies();
    const tokenCookie = cookies.find(c => c.name === '_token');

    if (tokenCookie) {
      const jwtToken = tokenCookie.value;
      const parts = jwtToken.split('.');
      let userId = '';
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        userId = payload?.user?.id || '';
      }

      console.log('\n' + '='.repeat(60));
      console.log('✓ BAŞARILI');
      console.log('='.repeat(60));
      console.log(email);
      console.log(`${userId}+${jwtToken}`);
      console.log('='.repeat(60));
    } else {
      console.log('✗ Token yok');
    }

  } catch (e) {
    console.error('✗', e.message);
  } finally {
    await browser.close();
  }
})();
