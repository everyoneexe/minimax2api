/**
 * Puppeteer ile MiniMax UI kayıt
 * API yerine gerçek tarayıcıda account.minimax.io üzerinden kayıt yapar
 */

import puppeteer from 'puppeteer';
import crypto from 'crypto';
import fs from 'fs';

const GUERRILLA_SITE = 'https://www.guerrillamail.com';
const MINIMAX_REGISTER = 'https://account.minimax.io/unified-login';

async function getGuerrillaEmail(page) {
  await page.goto(GUERRILLA_SITE, { waitUntil: 'networkidle0' });

  // Rastgele prefix + guerrillamail.com
  const prefix = crypto.randomBytes(6).toString('hex');
  await page.type('#email-widget', prefix);

  // Set butonuna tıkla
  await page.click('button:has-text("Set")').catch(() => {});
  await page.waitForTimeout(2000);

  // Email adresini al
  const email = await page.$eval('#email-widget', el => el.value).catch(() => null);
  if (!email || !email.includes('@')) {
    throw new Error('Guerrilla Mail email alınamadı');
  }

  console.log(`Email: ${email}`);
  return email;
}

async function waitForOTP(page, maxWait = 90000) {
  const deadline = Date.now() + maxWait;

  while (Date.now() < deadline) {
    // Inbox'u kontrol et
    await page.goto(GUERRILLA_SITE + '/inbox', { waitUntil: 'networkidle0' });

    // MiniMax'ten gelen mail var mı
    const emails = await page.$$eval('table tr', rows => {
      return rows.map(row => {
        const from = row.querySelector('td:nth-child(2)')?.textContent || '';
        const subject = row.querySelector('td:nth-child(3)')?.textContent || '';
        const id = row.querySelector('a')?.href.match(/mail_id=(\d+)/)?.[1];
        return { from, subject, id };
      }).filter(e => e.from.includes('minimax') || e.subject.includes('minimax'));
    });

    if (emails.length > 0) {
      // İlk maili aç
      await page.goto(`${GUERRILLA_SITE}/inbox?mail_id=${emails[0].id}`, { waitUntil: 'networkidle0' });

      // Email body'den OTP kodu çıkar (6 haneli sayı)
      const body = await page.$eval('#email_body', el => el.textContent).catch(() => '');
      const otpMatch = body.match(/\b(\d{6})\b/);

      if (otpMatch) {
        console.log(`OTP: ${otpMatch[1]}`);
        return otpMatch[1];
      }
    }

    await page.waitForTimeout(3000);
  }

  throw new Error('OTP timeout');
}

async function registerMiniMax(page, email, password) {
  await page.goto(MINIMAX_REGISTER, { waitUntil: 'networkidle0' });

  // Email ile kayıt sekmesine geç
  await page.click('button:has-text("Email"), a:has-text("Email")').catch(() => {});
  await page.waitForTimeout(1000);

  // Email gir
  await page.type('input[type="email"], input[placeholder*="email"]', email);
  await page.waitForTimeout(500);

  // "Get code" / "Send OTP" butonuna tıkla
  await page.click('button:has-text("Get"), button:has-text("Send"), button:has-text("code")');
  await page.waitForTimeout(3000);

  console.log('OTP bekleniyor...');

  // Guerrilla Mail'de OTP bekle
  const newPage = await page.browser().newPage();
  const otp = await waitForOTP(newPage, 90000);
  await newPage.close();

  // OTP gir
  await page.type('input[placeholder*="code"], input[type="text"]:not([type="email"])', otp);
  await page.waitForTimeout(500);

  // Şifre gir (iki kez)
  const passwordFields = await page.$$('input[type="password"]');
  for (const field of passwordFields) {
    await field.type(password);
    await page.waitForTimeout(300);
  }

  // Kayıt butonuna tıkla
  await page.click('button[type="submit"], button:has-text("Register"), button:has-text("Sign up")');
  await page.waitForTimeout(5000);

  // Başarılı mı kontrol et
  const url = page.url();
  if (url.includes('agent.minimax.io') || url.includes('dashboard')) {
    console.log('Kayıt başarılı!');
    return true;
  }

  throw new Error('Kayıt başarısız');
}

async function register(count = 1, outputFile = null) {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const accounts = [];

  for (let i = 0; i < count; i++) {
    console.log(`\n[${i + 1}/${count}] Kayıt başlıyor...`);

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });

      // Email al
      const email = await getGuerrillaEmail(page);
      const password = 'Mm' + crypto.randomBytes(8).toString('hex') + '!7';

      console.log(`Password: ${password}`);

      // MiniMax'e kayıt yap
      await registerMiniMax(page, email, password);

      accounts.push({
        email,
        password,
        status: 'success',
        timestamp: new Date().toISOString(),
      });

      console.log(`✓ ${email}`);

      await page.close();
    } catch (err) {
      console.error(`✗ Hata: ${err.message}`);
      accounts.push({ status: 'failed', error: err.message });
    }
  }

  await browser.close();

  if (outputFile) {
    fs.writeFileSync(outputFile, JSON.stringify(accounts, null, 2));
    console.log(`\nSonuçlar: ${outputFile}`);
  }

  const success = accounts.filter(a => a.status === 'success').length;
  console.log(`\nToplam: ${success}/${count} başarılı`);

  return accounts;
}

// CLI
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const args = process.argv.slice(2);
  const count = parseInt(args.find(a => a.match(/^\d+$/)) || '1');
  const output = args.find(a => a.startsWith('--out='))?.slice(6) || 'accounts_ui.json';

  register(count, output).catch(console.error);
}

export { register };
