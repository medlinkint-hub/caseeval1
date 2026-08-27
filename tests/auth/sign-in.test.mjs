// Verifies the gate OPENS for an approved member — and for nobody else.
//
// Companion to gate-closed.test.mjs. That file proves the gate stays shut when
// things break; this one proves it opens when it should, and that each way of
// being unauthorised (no membership record, approval revoked, membership
// lookup failing) still ends with the application hidden and the user signed
// back out. Firebase is replaced with a mock so every branch can be driven.
//
//   npm run test:auth

import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + path.resolve(HERE, '..', '..', 'index.html');
const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', X = '\x1b[0m';
let failures = 0;
const check = (n, c, d) => c
  ? console.log(`${G}PASS${X}  ${n}`)
  : (console.log(`${R}FAIL${X}  ${n}\n      ${D}${d}${X}`), failures++);

function mockScript(scenario) {
  return `
  (() => {
    const SCENARIO = ${JSON.stringify(scenario)};
    window.__signOutCalls = 0;
    const emptySnap = { forEach(){}, docs: [], empty: true };
    const docRef = (collName, id) => ({
      get: async () => {
        if (collName === 'team') {
          if (SCENARIO.team === 'missing') return { exists: false, data: () => ({}) };
          if (SCENARIO.team === 'error') throw new Error('permission-denied');
          return { exists: true, data: () => ({ approved: SCENARIO.team === 'approved', name: 'Dr Test', role: 'Claims Lead' }) };
        }
        return { exists: false, data: () => ({}) };
      },
      set: async () => {}, delete: async () => {},
      collection: (sub) => collRef(sub),
    });
    const collRef = (name) => ({
      doc: (id) => docRef(name, id),
      get: async () => emptySnap,
      onSnapshot: () => () => {},
      limit: () => ({ get: async () => emptySnap }),
    });
    let authCb = null;
    const auth = () => ({
      setPersistence: async () => {},
      onAuthStateChanged: (cb) => { authCb = cb; setTimeout(() => cb(SCENARIO.user), 10); },
      signOut: async () => { window.__signOutCalls++; if (authCb) authCb(null); },
      signInWithPopup: async () => ({ user: SCENARIO.user }),
      signInWithEmailAndPassword: async () => ({ user: SCENARIO.user }),
    });
    auth.Auth = { Persistence: { LOCAL: 'local', SESSION: 'session' } };
    auth.GoogleAuthProvider = function () { this.addScope = () => {}; };
    window.firebase = {
      auth,
      firestore: () => ({ collection: collRef, settings(){}, enablePersistence: async()=>{} }),
      app: () => { throw new Error('no app'); },
      initializeApp: () => ({}),
    };
  })();
  `;
}

// CHROMIUM_PATH lets a sandbox pin a specific binary; normally unset.
const LAUNCH_OPTS = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const browser = await chromium.launch(LAUNCH_OPTS);

async function run(scenario) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route('**://*.gstatic.com/**', r => r.abort());
  await page.route('**://*.jsdelivr.net/**', r => r.abort());
  await page.route('**://*.googleapis.com/**', r => r.abort());
  await page.addInitScript(mockScript(scenario));
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const state = await page.evaluate(() => ({
    app: getComputedStyle(document.querySelector('.app')).visibility,
    err: (document.getElementById('pw-err') || {}).textContent || '',
    detail: (document.getElementById('auth-signed-in-as') || {}).textContent || '',
    signOuts: window.__signOutCalls,
    user: window.CURRENT_USER ? window.CURRENT_USER.email : null,
  }));
  await ctx.close();
  return { state, errs };
}

const USER = { uid: 'uid-123', email: 'sami@example.com', displayName: 'Dr Sami' };

// 1. Approved member
{
  const { state, errs } = await run({ user: USER, team: 'approved' });
  check('approved member → app becomes visible', state.app === 'visible', `visibility "${state.app}"`);
  check('approved member → no errors', errs.length === 0, errs.join(' | '));
}

// 2. Signed in, but no team record
{
  const { state } = await run({ user: USER, team: 'missing' });
  check('unapproved account → app stays hidden', state.app === 'hidden', `visibility "${state.app}"`);
  check('unapproved account → is signed back out', state.signOuts >= 1, `signOut called ${state.signOuts}x`);
  check('unapproved account → told who to ask about', /sami@example.com/.test(state.detail), `detail "${state.detail}"`);
}

// 3. team record exists but approved:false
{
  const { state } = await run({ user: USER, team: 'revoked' });
  check('revoked member → app stays hidden', state.app === 'hidden', `visibility "${state.app}"`);
  check('revoked member → is signed back out', state.signOuts >= 1, `signOut called ${state.signOuts}x`);
}

// 4. Membership lookup fails (network / rules error) — must not assume approval
{
  const { state } = await run({ user: USER, team: 'error' });
  check('membership check errors → app stays hidden', state.app === 'hidden', `visibility "${state.app}"`);
  check('membership check errors → is signed back out', state.signOuts >= 1, `signOut called ${state.signOuts}x`);
}

// 5. Nobody signed in
{
  const { state } = await run({ user: null, team: 'approved' });
  check('no user → app stays hidden', state.app === 'hidden', `visibility "${state.app}"`);
}

await browser.close();
console.log(failures ? `\n${R}${failures} failure(s)${X}\n` : `\n${G}sign-in paths all behave correctly${X}\n`);
process.exit(failures ? 1 : 0);
