// Pulls the LIVE evaluation prompt out of index.html.
//
// The whole point of this harness is to test the prompt the app actually ships,
// so the prompt text is never copied into the test tree — it is extracted from
// index.html on every run. If someone edits SYS_EVAL, the next `npm run eval`
// scores the edited version. If the extraction stops matching (e.g. the const
// is renamed or converted to a normal string), we throw loudly rather than
// silently scoring a stale copy.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const INDEX_HTML = path.resolve(HERE, '..', '..', '..', 'index.html');

// Both prompts are plain template literals with no interpolation and no
// embedded backticks (asserted below), so a non-greedy match to the next
// backtick is exact.
function grabTemplateLiteral(src, constName) {
  const re = new RegExp('const\\s+' + constName + '\\s*=\\s*`([\\s\\S]*?)`\\s*;');
  const m = src.match(re);
  if (!m) {
    throw new Error(
      `Could not extract ${constName} from index.html.\n` +
      `The harness looks for: const ${constName} = \`...\`;\n` +
      `If the prompt was renamed or restructured, update lib/extract-prompt.mjs — ` +
      `do NOT paste a copy of the prompt into the test tree.`
    );
  }
  if (m[1].includes('${')) {
    throw new Error(
      `${constName} now contains a \${...} interpolation. The harness extracts it as ` +
      `literal text and would score the raw \${...} placeholder. Update the extractor.`
    );
  }
  return m[1];
}

export async function extractPrompts() {
  const src = await readFile(INDEX_HTML, 'utf8');
  const SECTION_0 = grabTemplateLiteral(src, 'SECTION_0');
  const SYS_EVAL  = grabTemplateLiteral(src, 'SYS_EVAL');
  return { SECTION_0, SYS_EVAL, indexHtmlBytes: src.length };
}

// The 13 standard-exclusion labels from SYS_EVAL Section VI item 7, read out of
// the prompt itself rather than hardcoded — so adding a label to the prompt
// automatically widens what the checklist scorer requires.
export function extractExclusionLabels(SYS_EVAL) {
  const start = SYS_EVAL.indexOf('Pre-existing conditions (apply Section IV apportionment)');
  if (start === -1) throw new Error('Could not locate the exclusion label block in SYS_EVAL.');
  const end = SYS_EVAL.indexOf('\n\n8. BENEFIT LIMITS', start);
  if (end === -1) throw new Error('Could not locate the end of the exclusion label block in SYS_EVAL.');
  const labels = SYS_EVAL.slice(start, end).split('\n').map(s => s.trim()).filter(Boolean);
  if (labels.length < 5) throw new Error(`Extracted only ${labels.length} exclusion labels — extraction is wrong.`);
  return labels;
}

// The 5 QA checklist items from SYS_EVAL Section VI item 13.
export function extractQaItems(SYS_EVAL) {
  const start = SYS_EVAL.indexOf('Items (use this exact wording, one per line):');
  if (start === -1) throw new Error('Could not locate the QA checklist item block in SYS_EVAL.');
  const after = SYS_EVAL.slice(start).split('\n').slice(1);
  const items = [];
  for (const line of after) {
    const t = line.trim();
    if (!t) break;
    if (t.startsWith('═')) break;
    items.push(t);
  }
  if (items.length < 3) throw new Error(`Extracted only ${items.length} QA items — extraction is wrong.`);
  return items;
}

// Every monetary figure quoted in SYS_EVAL Section III (the R&C benchmark
// tables). The model is instructed to cite these, so the grounding scorer must
// treat them as legitimate rather than as invented amounts.
export function extractBenchmarkFigures(SYS_EVAL) {
  const start = SYS_EVAL.indexOf('SECTION III — REASONABLE & CUSTOMARY COST BENCHMARKS');
  if (start === -1) throw new Error('Could not locate Section III in SYS_EVAL.');
  const end = SYS_EVAL.indexOf('SECTION IV —', start);
  if (end === -1) throw new Error('Could not locate the end of Section III in SYS_EVAL.');
  const block = SYS_EVAL.slice(start, end);
  const figures = new Set();
  const re = /([0-9][0-9,.]*)/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    const v = parseFloat(m[1].replace(/,/g, ''));
    if (Number.isFinite(v) && v > 0) figures.add(v);
  }
  // 150 comes from "flag any charge >150% of the HIGH end"; percentages and
  // small integers are noise here but harmless — they only ever widen what
  // counts as grounded, and every real invoice figure is checked against the
  // documents first.
  return [...figures];
}
