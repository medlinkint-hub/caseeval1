#!/usr/bin/env node
// CaseEval golden-set runner.
//
//   node tests/golden/run-eval.mjs --dry        score recorded outputs, no API calls
//   node tests/golden/run-eval.mjs              run the live prompt against the API
//   node tests/golden/run-eval.mjs --case=002   run one case
//   node tests/golden/run-eval.mjs --record     save live outputs into recorded/
//
// Live mode needs ANTHROPIC_API_KEY in the environment. Nothing here reads the
// browser localStorage key, and no key is ever written to disk.

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractPrompts, extractExclusionLabels, extractQaItems, extractBenchmarkFigures } from './lib/extract-prompt.mjs';
import { buildSystemPrompt, buildUserMessage } from './lib/build-message.mjs';
import { scoreOutput } from './lib/score.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = path.join(HERE, 'cases');
const RECORDED_DIR = path.join(HERE, 'recorded');
const REPORT_PATH = path.join(HERE, 'last-report.json');

const argv = process.argv.slice(2);
const flag = n => argv.includes('--' + n);
const opt = (n, d) => { const a = argv.find(x => x.startsWith('--' + n + '=')); return a ? a.split('=').slice(1).join('=') : d; };

const DRY = flag('dry');
const RECORD = flag('record');
const MODEL = opt('model', 'claude-sonnet-5');
const MAX_TOKENS = parseInt(opt('max-tokens', '8000'), 10);
const ONLY = opt('case', null);

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

async function loadFixtures(prompts) {
  const labels = extractExclusionLabels(prompts.SYS_EVAL);
  const qaItems = extractQaItems(prompts.SYS_EVAL);
  const benchmarks = extractBenchmarkFigures(prompts.SYS_EVAL);
  const files = (await readdir(CASES_DIR)).filter(f => f.endsWith('.json')).sort();
  const out = [];
  for (const f of files) {
    const fx = JSON.parse(await readFile(path.join(CASES_DIR, f), 'utf8'));
    if (ONLY && fx.id !== ONLY) continue;
    fx._file = f;
    fx._labels = labels;
    fx._qaItems = qaItems;
    fx._benchmarkFigures = benchmarks;
    out.push(fx);
  }
  if (!out.length) throw new Error(ONLY ? `No case with id ${ONLY}` : 'No case fixtures found.');
  return out;
}

async function callAnthropic(system, userText) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error('ANTHROPIC_API_KEY is not set. Export it, or run with --dry to score recorded outputs.');
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`API ${res.status}: ${(data.error && data.error.message) || 'unknown'}`);
  return {
    text: (data.content || []).map(b => b.text || '').join(''),
    usage: data.usage || {},
  };
}

function axisLine(name, axis) {
  const mark = axis.pass ? `${C.green}PASS${C.reset}` : `${C.red}FAIL${C.reset}`;
  let s = `    ${mark}  ${C.bold}${name.padEnd(10)}${C.reset} got: ${axis.got}`;
  if (!axis.pass) s += `\n           ${C.dim}want: ${axis.want}${C.reset}`;
  if (axis.detail && !axis.pass) s += `\n           ${C.dim}${axis.detail}${C.reset}`;
  return s;
}

async function main() {
  const prompts = await extractPrompts();
  const fixtures = await loadFixtures(prompts);

  console.log(`\n${C.bold}CaseEval golden set${C.reset}`);
  console.log(`${C.dim}prompt: SECTION_0 ${prompts.SECTION_0.length} chars + SYS_EVAL ${prompts.SYS_EVAL.length} chars, extracted live from index.html${C.reset}`);
  console.log(`${C.dim}mode:   ${DRY ? 'DRY (scoring recorded outputs, no API calls)' : `LIVE (${MODEL})`}${C.reset}`);
  console.log(`${C.dim}cases:  ${fixtures.length}${C.reset}\n`);

  const results = [];
  let totalCost = { input: 0, output: 0 };

  for (const fx of fixtures) {
    process.stdout.write(`${C.cyan}${fx.id}${C.reset}  ${fx.name}\n`);
    let output, usage = {};
    try {
      if (DRY) {
        const p = path.join(RECORDED_DIR, `${fx.id}.txt`);
        try {
          output = await readFile(p, 'utf8');
        } catch {
          console.log(`    ${C.yellow}SKIP${C.reset}  no recorded output at recorded/${fx.id}.txt`);
          console.log(`           ${C.dim}run without --dry --record to create one${C.reset}\n`);
          results.push({ caseId: fx.id, name: fx.name, skipped: true });
          continue;
        }
      } else {
        const system = await buildSystemPrompt(fx);
        const user = buildUserMessage(fx);
        const r = await callAnthropic(system, user);
        output = r.text;
        usage = r.usage;
        totalCost.input += usage.input_tokens || 0;
        totalCost.output += usage.output_tokens || 0;
        if (RECORD) {
          await mkdir(RECORDED_DIR, { recursive: true });
          await writeFile(path.join(RECORDED_DIR, `${fx.id}.txt`), output);
        }
      }
    } catch (e) {
      console.log(`    ${C.red}ERROR${C.reset} ${e.message}\n`);
      results.push({ caseId: fx.id, name: fx.name, error: e.message });
      continue;
    }

    const r = scoreOutput(fx, output);
    r.usage = usage;
    r.outputChars = output.length;
    for (const [name, axis] of Object.entries(r.axes)) console.log(axisLine(name, axis));
    const verdictMark = r.pass ? `${C.green}${r.passed}/${r.total}${C.reset}` : `${C.red}${r.passed}/${r.total}${C.reset}`;
    console.log(`    ${C.dim}────${C.reset} ${verdictMark} axes passed, ${output.length} chars\n`);
    results.push(r);
  }

  const scored = results.filter(r => !r.skipped && !r.error);
  const passedCases = scored.filter(r => r.pass).length;
  const axisTotals = {};
  for (const r of scored) {
    for (const [n, a] of Object.entries(r.axes)) {
      axisTotals[n] = axisTotals[n] || { pass: 0, total: 0 };
      axisTotals[n].total++;
      if (a.pass) axisTotals[n].pass++;
    }
  }

  console.log(`${C.bold}Summary${C.reset}`);
  console.log(`  cases fully passing: ${passedCases}/${scored.length}`);
  for (const [n, t] of Object.entries(axisTotals)) {
    const colour = t.pass === t.total ? C.green : C.red;
    console.log(`  ${n.padEnd(10)} ${colour}${t.pass}/${t.total}${C.reset}`);
  }
  if (!DRY && (totalCost.input || totalCost.output)) {
    console.log(`  ${C.dim}tokens: ${totalCost.input} in / ${totalCost.output} out${C.reset}`);
  }
  const skipped = results.filter(r => r.skipped).length;
  if (skipped) console.log(`  ${C.yellow}${skipped} case(s) skipped (no recorded output)${C.reset}`);

  await writeFile(REPORT_PATH, JSON.stringify({
    ranAt: new Date().toISOString(),
    mode: DRY ? 'dry' : 'live',
    model: DRY ? null : MODEL,
    promptSizes: { section0: prompts.SECTION_0.length, sysEval: prompts.SYS_EVAL.length },
    results,
  }, null, 2));
  console.log(`  ${C.dim}report → tests/golden/last-report.json${C.reset}\n`);

  const failed = scored.length - passedCases;
  process.exit(failed > 0 || results.some(r => r.error) ? 1 : 0);
}

main().catch(e => { console.error(`\n${C.red}${e.stack}${C.reset}\n`); process.exit(2); });
