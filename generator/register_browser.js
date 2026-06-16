/**
 * Puppeteer 驱动的 MiniMax 注册（绕过 Akamai bot 检测）
 * 使用真实浏览器完成整个流程
 */

import puppeteer from 'puppeteer';
import crypto from 'crypto';
import https from 'https';
import fs from 'fs';

const GUERRILLA = 'https://api.guerrillamail.com/ajax.php';

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function createGuerrillaEmail() {
  const data = await httpGet(`${GUERRILLA}?f=get_email_address`);
  if (!data?.sid_token) throw new Error('Failed to get Guerrilla Mail session');

  // 直接使用 API 返回的 email，不改 domain
  return { email: data.email_addr, sid: data.sid_token };
}

async function waitForOTP(sid, maxWait = 90000) {
  const deadline = Date.now() + maxWait;
  let seq = 1;

  while (Date.now() < deadline) {
    try {
      const data = await httpGet(`${GUERRILLA}?f=check_email&seq=${seq}&sid_token=${sid}`);

      if (data.list && data.list.length > 0) {
        for (const mail of data.list) {
          if (mail.mail_from && (mail.mail_from.includes('minimax') || mail.mail_from.includes('noreply'))) {
            // Fetch mail body
            const body = await httpGet(`${GUERRILLA}?f=fetch_email&email_id=${mail.mail_id}&sid_token=${sid}`);
            const text = body.mail_body || '';

            // Extract 6-digit OTP
            const match = text.match(/\b(\d{6})\b/);
            if (match) return match[1];
          }
        }
        seq = data.seq + 1;
      }
    } catch(e) {}

    await new Promise(r => setTimeout(r, 3000));
  }

  throw new Error('OTP timeout');
}

async function registerWithBrowser(email, password, sid) {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:151.0) Gecko/20100101 Firefox/151.0');

    console.log('访问注册页面...');
    await page.goto('https://account.minimax.io/unified-login', {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    await new Promise(r => setTimeout(r, 2000));

    // 点击 Email 注册 tab
    try {
      await page.click('[data-testid="email-tab"], button[role="tab"]:nth-child(2)');
      await new Promise(r => setTimeout(r, 1000));
    } catch(e) {
      console.log('无需切换到 Email tab');
    }

    // 输入 email
    console.log(`输入 email: ${email}`);
    const emailInput = await page.$('input[type="email"]');
    if (!emailInput) throw new Error('找不到 email 输入框');

    await emailInput.type(email, { delay: 50 });
    await new Promise(r => setTimeout(r, 500));

    // 点击 Continue 按钮
    console.log('点击 Continue...');
    const buttons = await page.$$('button');
    let clicked = false;
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.textContent.trim(), btn);
      if (text === 'Continue') {
        await btn.click();
        clicked = true;
        break;
      }
    }
    if (!clicked) throw new Error('找不到 Continue 按钮');

    await new Promise(r => setTimeout(r, 3000));

    // 等待 OTP
    console.log('等待 OTP（最多 90 秒）...');
    const otp = await waitForOTP(sid, 90000);
    console.log(`收到 OTP: ${otp}`);

    // 输入 OTP
    const otpInput = await page.$('input[placeholder*="code"], input[placeholder*="Code"], input[placeholder*="验证码"]');
    if (!otpInput) throw new Error('找不到 OTP 输入框');

    await otpInput.type(otp, { delay: 50 });
    await new Promise(r => setTimeout(r, 500));

    // 输入密码
    console.log('输入密码...');
    const passwordInputs = await page.$$('input[type="password"]');
    if (passwordInputs.length === 0) throw new Error('找不到密码输入框');

    for (const pwdInput of passwordInputs) {
      await pwdInput.type(password, { delay: 50 });
      await new Promise(r => setTimeout(r, 300));
    }

    // 提交
    console.log('提交注册...');
    const submitButtons = await page.$$('button[type="submit"]');
    if (submitButtons.length > 0) {
      await submitButtons[0].click();
    } else {
      // 尝试找包含"Register"或"Sign up"文本的按钮
      for (const btn of buttons) {
        const text = await page.evaluate(el => el.textContent, btn);
        if (text && (text.includes('Register') || text.includes('Sign up') || text.includes('注册'))) {
          await btn.click();
          break;
        }
      }
    }

    await new Promise(r => setTimeout(r, 5000));

    // 检查是否成功
    const url = page.url();
    if (url.includes('agent.minimax.io') || url.includes('dashboard') || !url.includes('unified-login')) {
      console.log('✓ 注册成功');
      return true;
    }

    // 检查是否有错误消息
    const pageText = await page.evaluate(() => document.body.textContent);
    if (pageText.includes('error') || pageText.includes('Error') || pageText.includes('错误')) {
      throw new Error('注册失败：页面显示错误');
    }

    throw new Error('注册状态未知');

  } finally {
    await browser.close();
  }
}

async function register(count = 1, outputFile = null) {
  const accounts = [];

  for (let i = 0; i < count; i++) {
    console.log(`\n[${i + 1}/${count}] ============================================================`);

    try {
      // 生成 email 和 password
      const { email, sid } = await createGuerrillaEmail();
      const password = 'Mm' + crypto.randomBytes(8).toString('hex') + '!7';

      console.log(`Email: ${email}`);
      console.log(`Password: ${password}`);

      // 使用浏览器注册
      await registerWithBrowser(email, password, sid);

      accounts.push({
        email,
        password,
        status: 'success',
        timestamp: new Date().toISOString(),
      });

      console.log(`✓ ${email} 注册成功`);

    } catch (err) {
      console.error(`✗ 失败: ${err.message}`);
      accounts.push({
        status: 'failed',
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }

    if (i < count - 1) {
      console.log('\n等待 5 秒再继续...');
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  if (outputFile) {
    fs.writeFileSync(outputFile, JSON.stringify(accounts, null, 2));
    console.log(`\n结果已保存: ${outputFile}`);
  }

  const success = accounts.filter(a => a.status === 'success').length;
  console.log(`\n最终结果: ${success}/${count} 成功`);

  return accounts;
}

// CLI
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const args = process.argv.slice(2);
  const countArg = args.find(a => /^\d+$/.test(a));
  const count = countArg ? parseInt(countArg) : 1;
  const outArg = args.find(a => a.startsWith('--out='));
  const output = outArg ? outArg.slice(6) : 'accounts_browser.json';

  register(count, output).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

export { register };
