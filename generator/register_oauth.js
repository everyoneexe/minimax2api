/**
 * OAuth (Google/Github) ile MiniMax kayıt
 * Email doğrulama gerektirmez
 */

import puppeteer from 'puppeteer';
import fs from 'fs';

async function registerWithOAuth(provider = 'google', count = 1, outputFile = null) {
  const browser = await puppeteer.launch({
    headless: false,  // OAuth için gerçek tarayıcı gerekli
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const accounts = [];

  for (let i = 0; i < count; i++) {
    console.log(`\n[${i + 1}/${count}] ${provider} ile kayıt başlıyor...`);

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });

      await page.goto('https://account.minimax.io/unified-login', {
        waitUntil: 'networkidle0',
        timeout: 30000
      });

      await new Promise(r => setTimeout(r, 2000));

      // OAuth butonunu bul ve tıkla
      const buttons = await page.$$('button');
      let oauthButton = null;

      for (const btn of buttons) {
        const text = await page.evaluate(el => el.textContent.trim(), btn);
        if (provider === 'google' && text.includes('Google')) {
          oauthButton = btn;
          break;
        } else if (provider === 'github' && text.includes('Github')) {
          oauthButton = btn;
          break;
        }
      }

      if (!oauthButton) throw new Error(`${provider} butonu bulunamadı`);

      console.log(`${provider} butonu bulundu, tıklanıyor...`);
      await oauthButton.click();

      // Kullanıcı manuel olarak OAuth flow'unu tamamlamasını bekle
      console.log(`\n${provider} ile giriş yapın. Tamamlandığında tarayıcı otomatik devam edecek...`);

      // agent.minimax.io'ya yönlendirilene kadar bekle
      await page.waitForFunction(
        () => window.location.href.includes('agent.minimax.io'),
        { timeout: 300000 }  // 5 dakika timeout
      );

      console.log('✓ OAuth başarılı, hesap bilgileri alınıyor...');

      // Cookie'lerden bilgi al
      const cookies = await page.cookies();
      const sessionCookie = cookies.find(c => c.name.includes('session') || c.name.includes('token'));

      accounts.push({
        provider,
        session_cookie: sessionCookie ? `${sessionCookie.name}=${sessionCookie.value}` : null,
        status: 'success',
        timestamp: new Date().toISOString(),
        note: 'OAuth kayıt — email ve password yok, cookie kullan'
      });

      console.log(`✓ ${provider} hesabı eklendi`);

      await page.close();

    } catch (err) {
      console.error(`✗ Hata: ${err.message}`);
      accounts.push({
        provider,
        status: 'failed',
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }

    if (i < count - 1) {
      console.log('\n5 saniye bekleniyor...');
      await new Promise(r => setTimeout(r, 5000));
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
  const provider = args.find(a => ['google', 'github'].includes(a)) || 'google';
  const countArg = args.find(a => /^\d+$/.test(a));
  const count = countArg ? parseInt(countArg) : 1;
  const outArg = args.find(a => a.startsWith('--out='));
  const output = outArg ? outArg.slice(6) : 'accounts_oauth.json';

  console.log(`\n${provider} OAuth ile ${count} hesap kaydedilecek`);
  console.log('Not: Her hesap için tarayıcıda manuel giriş yapmanız gerekecek\n');

  registerWithOAuth(provider, count, output).catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}

export { registerWithOAuth };
