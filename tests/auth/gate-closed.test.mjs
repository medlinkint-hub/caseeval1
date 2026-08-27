// Verifies the authentication gate FAILS CLOSED.
//
// The one property that matters more than any other: the application must never
// become visible without an approved sign-in. Reasoning about that from reading
// the code is not enough, so this drives a real browser at the real index.html
// and checks the property under each way the sign-in service can fail.
//
//   npm run test:auth
//
// Requires Chromium. If Playwright cannot find a browser, run:
//   npx playwright install chromium

import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + path.resolve(HERE, '..', '..', 'index.html');
const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', X = '\x1b[0m';

let failures = 0;
function check(name, condition, detail) {
  if (condition) console.log(`${G}PASS${X}  ${name}`);
  else { console.log(`${R}FAIL${X}  ${name}\n      ${D}${detail}${X}`); failures++; }
}

async function appVisible(page) {
  return page.evaluate(() => {
    const app = document.querySelector('.app');
    if (!app) return 'no-app-element';
    return getComputedStyle(app).visibility;
  });
}
async function gateVisible(page) {
  return page.evaluate(() => {
    const s = document.getElementById('pw-screen');
    if (!s) return 'no-gate-element';
    return getComputedStyle(s).display;
  });
}

// CHROMIUM_PATH lets a sandbox pin a specific binary; normally unset.
const LAUNCH_OPTS = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const browser = await chromium.launch(LAUNCH_OPTS);

// ── Scenario 1: Firebase CDNs unreachable (offline, ad-blocker, firewall) ──
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route('**://*.gstatic.com/**', r => r.abort());
  await page.route('**://*.jsdelivr.net/**', r => r.abort());
  await page.route('**://*.googleapis.com/**', r => r.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(3000);

  check('SDK blocked → app stays hidden', (await appVisible(page)) === 'hidden',
    `visibility was "${await appVisible(page)}"`);
  check('SDK blocked → gate stays on screen', (await gateVisible(page)) === 'flex',
    `display was "${await gateVisible(page)}"`);
  const msg = await page.evaluate(() => (document.getElementById('pw-err')||{}).textContent || '');
  check('SDK blocked → user sees an explanation', /could not load/i.test(msg), `message was "${msg}"`);
  check('SDK blocked → no uncaught page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ── Scenario 2: the old bypass. Can the app be revealed from the console? ──
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route('**://*.gstatic.com/**', r => r.abort());
  await page.route('**://*.jsdelivr.net/**', r => r.abort());
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(2000);

  const removedHelpers = await page.evaluate(() => ({
    hideLoginScreen: typeof window.hideLoginScreen,
    checkPassword:   typeof window.checkPassword,
    changePassword:  typeof window.changePassword,
    pwHash:          typeof window.PW_HASH,
  }));
  check('hideLoginScreen() no longer exists', removedHelpers.hideLoginScreen === 'undefined',
    `typeof was "${removedHelpers.hideLoginScreen}"`);
  check('checkPassword() no longer exists', removedHelpers.checkPassword === 'undefined',
    `typeof was "${removedHelpers.checkPassword}"`);
  check('PW_HASH no longer exists', removedHelpers.pwHash === 'undefined',
    `typeof was "${removedHelpers.pwHash}"`);

  const srcHasHash = await page.evaluate(() =>
    document.documentElement.outerHTML.includes('ee4d4aa76b2e56c0b48d78c616384114ac946b97ff0b3411c63a6c3642cb3977'));
  check('published password hash is gone from the page', srcHasHash === false,
    'the old SHA-256 hash is still present in the served HTML');

  const srcHasDefaultPw = await page.evaluate(() =>
    document.documentElement.outerHTML.includes('HealthWatch2025!'));
  check('default password no longer printed in the page', srcHasDefaultPw === false,
    'the plaintext default password is still in the served HTML');
  await ctx.close();
}

// ── Scenario 3: forged sign-in state must not reveal the app ──
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route('**://*.gstatic.com/**', r => r.abort());
  await page.route('**://*.jsdelivr.net/**', r => r.abort());
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(2000);

  // The old gate trusted this key. Setting it must now achieve nothing.
  await page.evaluate(() => { try { sessionStorage.setItem('hw_session_ok_v2', '1'); } catch(e){} });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);
  check('forged session flag does not unlock the app', (await appVisible(page)) === 'hidden',
    `visibility was "${await appVisible(page)}"`);
  await ctx.close();
}

await browser.close();
console.log(failures ? `\n${R}${failures} failure(s)${X}\n` : `\n${G}gate holds closed in every scenario${X}\n`);
process.exit(failures ? 1 : 0);
