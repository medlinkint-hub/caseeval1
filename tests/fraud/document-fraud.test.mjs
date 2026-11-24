// Verifies the document and identity fraud detector against the real index.html.
//
// Two things are being proved, and the second matters more than the first:
//   1. Real tampering is caught.
//   2. Honest documents are left alone. A detector that cries forgery over a
//      poor scan or a missing middle name is worse than no detector, because
//      the team learns to ignore it.
//
//   npm run test:fraud

import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + path.resolve(HERE, '..', '..', 'index.html');
const LAUNCH = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', X = '\x1b[0m';

let failures = 0;
const check = (name, cond, detail) => cond
  ? console.log(`${G}PASS${X}  ${name}`)
  : (console.log(`${R}FAIL${X}  ${name}\n      ${D}${detail}${X}`), failures++);

// ICAO Doc 9303 specimen passport — genuine, every check digit correct.
const GENUINE_MRZ = [
  'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
  'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
];

const browser = await chromium.launch(LAUNCH);
const ctx = await browser.newContext();
const page = await ctx.newPage();
// The app must not reach the network during the test.
await page.route('**://*.gstatic.com/**', r => r.abort());
await page.route('**://*.jsdelivr.net/**', r => r.abort());
await page.route('**://*.googleapis.com/**', r => r.abort());
await page.route('**://cdnjs.cloudflare.com/**', r => r.abort());

const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(FILE, { waitUntil: 'load' });
await page.waitForTimeout(1500);

// Drive runDocumentFraudCheck with a case and its invoices.
async function run(testCase, invoices = [], otherCases = []) {
  return page.evaluate(({ testCase, invoices, otherCases }) => {
    CASES = [testCase, ...otherCases];
    try {
      localStorage.setItem('invs_' + testCase.id, JSON.stringify(invoices));
      for (const o of otherCases) localStorage.setItem('invs_' + o.id, JSON.stringify(o._invoices || []));
    } catch (e) {}
    const r = runDocumentFraudCheck(testCase);
    return { levels: r.findings.map(f => f.level), titles: r.findings.map(f => f.title),
             risk: r.riskLevel, checksRun: r.checksRun,
             mrzValid: (r.mrz || []).map(m => m.parsed.checks.every(c => c.valid)) };
  }, { testCase, invoices, otherCases });
}

// The ICAO specimen passport expires 2004-04-15, so any case carrying it is
// dated inside that validity. Using the real specimen is worth more than
// modern-looking dates: it is the only identity fixture whose check digits are
// independently known-good, straight out of Doc 9303.
const baseCase = (over = {}) => ({
  id: 'c1', caseNum: 'MAP-1000', patient: 'Anna Maria Eriksson',
  dol: '2003-06-01', admissionDate: '2003-06-01', dischargeDate: '2003-06-04', ...over,
});
const goodInvoice = (over = {}) => ({
  provider_name: 'Euromedica', invoice_number: 'INV-1', invoice_date: '2003-06-04',
  patient_name: 'Anna Maria Eriksson', currency: 'EUR', provider_tax_id: 'EL123456789',
  line_items: [{ total: 1000 }, { total: 500 }], tax: 0, discount: 0, total: 1500, ...over,
});

check('the page loads with no errors', errors.length === 0, errors.join(' | '));

// ── Honest claim: nothing should fire ───────────────────────────────────
{
  const r = await run(
    baseCase({ docIntegrity: { identity_documents: [{ file_name: 'passport.jpg', mrz_lines: GENUINE_MRZ }], tampering_observations: [] } }),
    [goodInvoice()]);
  check('clean case → no findings at all', r.levels.length === 0, `got: ${r.titles.join('; ')}`);
  check('clean case → risk reads clear', r.risk === 'clear', r.risk);
  check('genuine passport → check digits pass', r.mrzValid[0] === true, JSON.stringify(r.mrzValid));
  check('clean case → checks actually ran (not a vacuous pass)', r.checksRun > 0, `checksRun=${r.checksRun}`);
}

// ── A missing middle name is not fraud ──────────────────────────────────
{
  const r = await run(baseCase(), [goodInvoice({ patient_name: 'Anna Eriksson' })]);
  check('shortened patient name → not flagged', !r.titles.some(t => /different patient/i.test(t)), r.titles.join('; '));
}
// ── Reordered name with a title is not fraud ────────────────────────────
{
  const r = await run(baseCase(), [goodInvoice({ patient_name: 'ERIKSSON, Anna Maria (Mrs)' })]);
  check('reordered name with title → not flagged', !r.titles.some(t => /different patient/i.test(t)), r.titles.join('; '));
}
// ── Rounding noise is not an arithmetic failure ─────────────────────────
{
  const r = await run(baseCase(), [goodInvoice({ line_items: [{ total: 1000.00 }, { total: 499.99 }], total: 1500 })]);
  check('1 cent rounding → not flagged as bad arithmetic', !r.titles.some(t => /does not add up/i.test(t)), r.titles.join('; '));
}

// ── Tampered passport ───────────────────────────────────────────────────
{
  const tampered = [GENUINE_MRZ[0], GENUINE_MRZ[1].slice(0, 2) + '1' + GENUINE_MRZ[1].slice(3)];
  if (tampered[1] === GENUINE_MRZ[1]) throw new Error('vacuous MRZ mutation — test would prove nothing');
  const r = await run(baseCase({ docIntegrity: { identity_documents: [{ file_name: 'passport.jpg', mrz_lines: tampered }] } }), [goodInvoice()]);
  check('altered passport number → critical finding', r.levels.includes('critical'), JSON.stringify(r.levels));
  check('altered passport → named as a check-digit failure', r.titles.some(t => /check digits/i.test(t)), r.titles.join('; '));
  check('altered passport → risk is critical', r.risk === 'critical', r.risk);
}

// ── Identity document in someone else's name ────────────────────────────
{
  const r = await run(baseCase({ patient: 'Raymond Gray',
    docIntegrity: { identity_documents: [{ file_name: 'passport.jpg', mrz_lines: GENUINE_MRZ }] } }), []);
  check('passport in another name → critical finding', r.titles.some(t => /different name/i.test(t)), r.titles.join('; '));
}

// ── Expired on the date of loss ─────────────────────────────────────────
{
  const r = await run(baseCase({ dol: '2030-01-01', admissionDate: '2030-01-01', dischargeDate: '2030-01-04',
    docIntegrity: { identity_documents: [{ file_name: 'passport.jpg', mrz_lines: GENUINE_MRZ }] } }), []);
  check('document expired before date of loss → flagged', r.titles.some(t => /expired/i.test(t)), r.titles.join('; '));
}

// ── The wrong patient's medical report (the real incident) ──────────────
{
  const r = await run(baseCase({ patient: 'Raymond Gray' }), [goodInvoice({ patient_name: 'F Gibson' })]);
  check('document naming a different patient → flagged', r.titles.some(t => /different patient/i.test(t)), r.titles.join('; '));
}

// ── Invoice that does not add up ────────────────────────────────────────
{
  const r = await run(baseCase(), [goodInvoice({ line_items: [{ total: 1000 }, { total: 500 }], total: 9500 })]);
  check('altered total → flagged as not adding up', r.titles.some(t => /does not add up/i.test(t)), r.titles.join('; '));
}

// ── Duplicate invoice number inside one case ────────────────────────────
{
  const r = await run(baseCase(), [goodInvoice(), goodInvoice({ total: 2000, line_items: [{ total: 2000 }] })]);
  check('same invoice number twice → flagged', r.titles.some(t => /more than once/i.test(t)), r.titles.join('; '));
}

// ── Same invoice number on a different patient's case ───────────────────
{
  const other = { id: 'c2', caseNum: 'MAP-2000', patient: 'Someone Else',
    _invoices: [{ invoice_number: 'INV-1', provider_name: 'Euromedica', total: 1500 }] };
  const r = await run(baseCase(), [goodInvoice()], [other]);
  check('invoice number reused across patients → critical', r.levels.includes('critical'), JSON.stringify(r.levels));
}

// ── Future-dated document ───────────────────────────────────────────────
{
  const future = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const r = await run(baseCase(), [goodInvoice({ invoice_date: future })]);
  check('future-dated document → flagged', r.titles.some(t => /future/i.test(t)), r.titles.join('; '));
}

// ── AI observations stay advisory ───────────────────────────────────────
{
  const r = await run(baseCase({ docIntegrity: { identity_documents: [],
    tampering_observations: [{ file_name: 'inv.pdf', observation: 'The total is in a different font', confidence: 'high' }] } }), [goodInvoice()]);
  check('AI observation is reported', r.titles.some(t => /AI observation/i.test(t)), r.titles.join('; '));
  check('AI observation never reaches critical on its own', !r.levels.includes('critical'), JSON.stringify(r.levels));
}

await browser.close();
console.log(failures ? `\n${R}${failures} failure(s)${X}\n` : `\n${G}document fraud detection behaves correctly${X}\n`);
process.exit(failures ? 1 : 0);
