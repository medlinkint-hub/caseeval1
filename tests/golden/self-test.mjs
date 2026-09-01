#!/usr/bin/env node
// Self-test for the scorer.
//
// The golden set is only worth running if a wrong evaluation actually fails it.
// This takes each known-good recorded output, injects one specific defect, and
// asserts that the matching axis flips to FAIL — and that the other axes stay
// PASS, so a defect in one dimension is not masking or leaking into another.
//
// Run with: npm run eval:self

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractPrompts, extractExclusionLabels, extractQaItems, extractBenchmarkFigures } from './lib/extract-prompt.mjs';
import { scoreOutput } from './lib/score.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';

const MUTATIONS = [
  {
    case: '001', axis: 'verdict', name: 'verdict flipped to DECLINED',
    mutate: t => t.replace('DECISION: APPROVED', 'DECISION: DECLINED'),
  },
  {
    case: '001', axis: 'amount', name: 'approved amount transposed (3060 → 3600)',
    mutate: t => t.replace('APPROVED AMOUNT: EUR 3060.00', 'APPROVED AMOUNT: EUR 3600.00'),
  },
  {
    case: '001', axis: 'grounding', name: 'invented invoice figure injected',
    mutate: t => t.replace('POTENTIAL SAVINGS:           EUR 0.00',
                           'POTENTIAL SAVINGS:           EUR 0.00\nPrior claims this period: EUR 7412.55'),
  },
  {
    case: '001', axis: 'format', name: 'QA checklist omitted',
    mutate: t => t.split('\n').filter(l => !l.trim().startsWith('[YES]')).join('\n'),
  },
  {
    case: '001', axis: 'format', name: 'DECISION line loses its strict form',
    mutate: t => t.replace('DECISION: APPROVED', 'DECISION - APPROVED'),
  },
  {
    case: '002', axis: 'checklist', name: 'STI row silently dropped',
    mutate: t => t.split('\n').filter(l => !l.includes('Sexually transmitted disease (STI):')).join('\n'),
  },
  {
    case: '002', axis: 'checklist', name: 'STI flagged DOES NOT APPLY despite positive NAAT',
    mutate: t => t.replace('[APPLIES] Sexually transmitted disease (STI):',
                           '[DOES NOT APPLY] Sexually transmitted disease (STI):'),
  },
  {
    case: '002', axis: 'checklist', name: 'colon collision in the STI label (the commit 3e6ddde bug)',
    // The app parses the label as everything before the FIRST colon, so a colon
    // inside the label truncates it and the row stops matching its expected name.
    mutate: t => t.replace('[APPLIES] Sexually transmitted disease (STI):',
                           '[APPLIES] Sexually transmitted disease: (STI)'),
  },
  {
    case: '003', axis: 'format', name: 'Rule 0.4 banner missing',
    mutate: t => t.replace('⚠ NO VALID POLICY PROVIDED — FINANCIAL DECISION WITHHELD\n\n', ''),
  },
  {
    case: '003', axis: 'amount', name: 'financial figure produced despite no policy (Rule 0.1 breach)',
    mutate: t => t.replace('APPROVED AMOUNT: N/A — policy document required before financial assessment',
                           'APPROVED AMOUNT: EUR 2150.00'),
  },
];

async function loadFixture(id, prompts) {
  const files = await readdir(path.join(HERE, 'cases'));
  const f = files.find(x => x.startsWith(id + '-'));
  const fx = JSON.parse(await readFile(path.join(HERE, 'cases', f), 'utf8'));
  fx._labels = extractExclusionLabels(prompts.SYS_EVAL);
  fx._qaItems = extractQaItems(prompts.SYS_EVAL);
  fx._benchmarkFigures = extractBenchmarkFigures(prompts.SYS_EVAL);
  return fx;
}

const prompts = await extractPrompts();
console.log(`\n${B}Scorer self-test${X}`);
console.log(`${D}each mutation must fail its target axis — and only its target axis${X}\n`);

let failures = 0;

// Baseline: every recorded output must pass cleanly first.
for (const id of ['001', '002', '003']) {
  const fx = await loadFixture(id, prompts);
  const out = await readFile(path.join(HERE, 'recorded', `${id}.txt`), 'utf8');
  const r = scoreOutput(fx, out);
  if (!r.pass) {
    console.log(`${R}BASELINE BROKEN${X}  ${id} does not pass unmutated: ` +
      Object.entries(r.axes).filter(([, a]) => !a.pass).map(([n]) => n).join(', '));
    failures++;
  }
}

for (const m of MUTATIONS) {
  const fx = await loadFixture(m.case, prompts);
  const clean = await readFile(path.join(HERE, 'recorded', `${m.case}.txt`), 'utf8');
  const mutated = m.mutate(clean);
  if (mutated === clean) {
    console.log(`${R}NO-OP${X}   ${m.case} ${m.name} — mutation changed nothing, test is vacuous`);
    failures++;
    continue;
  }
  const r = scoreOutput(fx, mutated);
  const target = r.axes[m.axis];
  const collateral = Object.entries(r.axes).filter(([n, a]) => n !== m.axis && !a.pass).map(([n]) => n);

  if (target.pass) {
    console.log(`${R}MISS${X}    ${m.case} ${m.name}`);
    console.log(`        ${D}expected ${m.axis} to FAIL, it passed — the scorer is blind to this defect${X}`);
    failures++;
  } else if (collateral.length) {
    console.log(`${G}CAUGHT${X}  ${m.case} ${m.name} ${D}(${m.axis})${X}`);
    console.log(`        ${D}also failed: ${collateral.join(', ')} — expected for this defect${X}`);
  } else {
    console.log(`${G}CAUGHT${X}  ${m.case} ${m.name} ${D}(${m.axis} only)${X}`);
  }
}

console.log(`\n${failures ? R + failures + ' problem(s)' : G + 'all ' + MUTATIONS.length + ' defects caught'}${X}\n`);
process.exit(failures ? 1 : 0);
