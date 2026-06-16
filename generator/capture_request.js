#!/usr/bin/env node
/**
 * Capture real MiniMax API request format
 */

const puppeteer = require('puppeteer');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function captureRequest() {
  console.log('🚀 Launching browser...');

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Enable request interception
  await page.setRequestInterception(true);

  page.on('request', req => {
    const url = req.url();

    // Capture message requests
    if (url.includes('/session/') && url.includes('/message') && req.method() === 'POST') {
      console.log('\n=== CAPTURED REQUEST ===');
      console.log('URL:', url);
      console.log('Method:', req.method());
      console.log('Headers:', JSON.stringify(req.headers(), null, 2));
      console.log('Body:', req.postData());
      console.log('======================\n');
    }

    req.continue();
  });

  try {
    // Login
    console.log('🔐 Please login manually...');
    await page.goto('https://account.minimax.io/unified-login', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    await sleep(3000);

    console.log('⏳ Waiting 60 seconds for you to:');
    console.log('   1. Login');
    console.log('   2. Navigate to https://agent.minimax.io/');
    console.log('   3. Send a test message');
    console.log('\n   The request body will be captured automatically.\n');

    await sleep(60000);

    console.log('✅ Capture window closed');

  } catch(e) {
    console.error('❌ Error:', e.message);
  } finally {
    await browser.close();
  }
}

captureRequest();
