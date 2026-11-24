// Re-adding a document must replace the earlier copy, not sit beside it.
//
// Two identical rows are not only untidy: both are listed as case documents
// and both are sent to the AI, so the same invoice gets read twice. This was
// seen in the field as the same 131KB file appearing twice on one case.
//
// The opposite error matters too. Two different documents that happen to
// share a filename — two providers both sending "invoice.pdf" — must both
// survive, so the match requires name AND size.
//
//   npm run test:files
//
// Also covers case isolation: the file list must never show documents that
// belong to a different case. A patient's medical report appearing under
// another patient's claim is a confidentiality failure, not a display glitch.

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

const browser = await chromium.launch(LAUNCH);
const ctx = await browser.newContext();
const page = await ctx.newPage();
for (const h of ['**://*.gstatic.com/**', '**://*.jsdelivr.net/**', '**://*.googleapis.com/**', '**://cdnjs.cloudflare.com/**'])
  await page.route(h, r => r.abort());
await page.goto(FILE, { waitUntil: 'load' });
await page.waitForTimeout(1200);

// Drive addFiles with real File objects and read back what the case holds.
async function addThenRead(files) {
  return page.evaluate(async (specs) => {
    const caseId = 'dup-test';
    CASES = [{ id: caseId, caseNum: 'DUP-1', patient: 'Test Patient', filesData: [] }];
    window._currentCaseId = caseId;
    FILES = [];
    _filesForCaseId = caseId;

    for (const spec of specs) {
      const blob = new File([new Uint8Array(spec.size)], spec.name, { type: 'application/pdf' });
      addFiles([blob], caseId);
      // addFiles reads asynchronously via FileReader; let each settle.
      await new Promise(r => setTimeout(r, 250));
    }
    const c = CASES.find(x => x.id === caseId);
    return {
      inFILES: FILES.map(f => `${f.name}:${f.size}`),
      inCase: ((c && c.filesData) || []).map(f => `${f.name}:${f.size}`),
    };
  }, files);
}

// Same file added twice.
{
  const r = await addThenRead([{ name: 'zd.docx', size: 1024 }, { name: 'zd.docx', size: 1024 }]);
  check('same file added twice → one row in the file list', r.inFILES.length === 1, JSON.stringify(r.inFILES));
  check('same file added twice → one row saved on the case', r.inCase.length === 1, JSON.stringify(r.inCase));
}

// Different documents that share a filename.
{
  const r = await addThenRead([{ name: 'invoice.pdf', size: 1024 }, { name: 'invoice.pdf', size: 4096 }]);
  check('same name, different size → both kept in the file list', r.inFILES.length === 2, JSON.stringify(r.inFILES));
  check('same name, different size → both kept on the case', r.inCase.length === 2, JSON.stringify(r.inCase));
}

// Ordinary case: two distinct documents.
{
  const r = await addThenRead([{ name: 'a.pdf', size: 100 }, { name: 'b.pdf', size: 200 }]);
  check('two distinct documents → both kept', r.inFILES.length === 2 && r.inCase.length === 2,
    `FILES=${JSON.stringify(r.inFILES)} case=${JSON.stringify(r.inCase)}`);
}

// ── Case isolation ──────────────────────────────────────────────────────
// renderFL_C reads the single global FILES array. If that array belongs to
// another case, the list must not render it.
{
  const r = await page.evaluate(async () => {
    // Case A owns FILES and holds one document.
    CASES = [
      { id: 'caseA', caseNum: 'A-1', patient: 'Patient A', filesData: [] },
      { id: 'caseB', caseNum: 'B-1', patient: 'Patient B', filesData: [] },
    ];
    window._currentCaseId = 'caseA';
    FILES = [];
    _filesForCaseId = 'caseA';
    const blob = new File([new Uint8Array(2048)], 'patientA-report.pdf', { type: 'application/pdf' });
    addFiles([blob], 'caseA');
    await new Promise(r => setTimeout(r, 300));

    const ownedByA = FILES.length;

    // Now the user opens case B. A stale caller tries to render the list for
    // B while FILES still belongs to A.
    window._currentCaseId = 'caseB';
    let el = document.getElementById('fl_c');
    if (!el) { el = document.createElement('div'); el.id = 'fl_c'; document.body.appendChild(el); }
    el.innerHTML = '';
    renderFL_C('caseB');
    await new Promise(r => setTimeout(r, 250));

    return { ownedByA, bodyShowsAsFile: (document.getElementById('fl_c') || {}).innerHTML.includes('patientA-report.pdf'),
             filesOwner: _filesForCaseId };
  });
  check('case A document was actually added (fixture is real)', r.ownedByA === 1, `FILES had ${r.ownedByA}`);
  check("case B's list does not show case A's document", r.bodyShowsAsFile === false,
    "another case's document rendered under this case");
}

await browser.close();
console.log(failures ? `\n${R}${failures} failure(s)${X}\n` : `\n${G}duplicate handling correct${X}\n`);
process.exit(failures ? 1 : 0);
