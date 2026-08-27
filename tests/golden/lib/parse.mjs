// Parsers that MIRROR the app's own regexes, character for character.
//
// This is deliberate and load-bearing. index.html parses model output with
// specific regexes to drive the UI (verdict badge, compliance checklist, case
// status). If model output drifts so that the app's parser stops matching, the
// app degrades silently — a checklist row vanishes, a verdict reads UNKNOWN.
// By reusing the identical patterns here, that drift shows up as a failing
// score instead of a support ticket.
//
// Each export names the index.html line it mirrors. If you change one there,
// change it here and note it in the case fixtures' expectations.

// --- mirrors index.html runEval(), "decMatchesStrict" (index.html:2814) ---
const DECISION_STRICT =
  /^\s*DECISION\s*:\s*(DECLINED|APPROVED|PARTIALLY APPROVED|PENDING INFORMATION)\b/gim;
// --- mirrors index.html runEval(), loose fallback (index.html:2818) ---
const DECISION_LOOSE = /DECISION\s*:?\s*([^\n]+)/gi;

export function parseDecision(text) {
  if (!text) return { verdict: 'UNKNOWN', matchedStrict: false };
  const strict = [...text.matchAll(DECISION_STRICT)];
  if (strict.length) {
    return { verdict: strict[strict.length - 1][1].trim(), matchedStrict: true };
  }
  const loose = [...text.matchAll(DECISION_LOOSE)];
  if (loose.length) {
    return { verdict: loose[loose.length - 1][1].trim(), matchedStrict: false };
  }
  return { verdict: 'UNKNOWN', matchedStrict: false };
}

// --- mirrors index.html runEval() status mapping (index.html:2824-2829) ---
export function verdictToStatus(verdict) {
  if (!verdict || verdict === 'UNKNOWN') return 'reviewing';
  const sd = verdict.toUpperCase();
  if (/^DECLIN|^DENIED|^NOT COVERED/.test(sd)) return 'declined';
  if (/^APPROV|^COVERED/.test(sd)) return 'approved';
  if (/^PARTIAL/.test(sd)) return 'partial';
  if (/^PENDING/.test(sd)) return 'reviewing';
  return 'reviewing';
}

// --- mirrors index.html renderEvalTxt() exclusions row (index.html:3966) ---
const EXCLUSION_ROW = /^\[(APPLIES|DOES NOT APPLY)\]\s*([^:]+):\s*(.+)$/i;

export function parseExclusionRows(text) {
  const rows = [];
  for (const raw of String(text || '').split('\n')) {
    const m = raw.trim().match(EXCLUSION_ROW);
    if (!m) continue;
    rows.push({
      applies: /^APPLIES$/i.test(m[1]),
      label: m[2].trim(),
      reason: m[3].trim(),
    });
  }
  return rows;
}

// --- mirrors index.html renderEvalTxt() QA row (index.html:3979) ---
const QA_ROW = /^\[(YES|NO)\]\s*(.+)$/i;

export function parseQaRows(text) {
  const rows = [];
  for (const raw of String(text || '').split('\n')) {
    const m = raw.trim().match(QA_ROW);
    if (!m) continue;
    rows.push({ yes: /^YES$/i.test(m[1]), item: m[2].trim() });
  }
  return rows;
}

// APPROVED AMOUNT line from SYS_EVAL section 13's mandatory format.
// Accepts "EUR 4200.00", "EUR 4,200", "4200", and the Rule 0.4 "N/A ..." form.
export function parseApprovedAmount(text) {
  const matches = [...String(text || '').matchAll(/^\s*APPROVED AMOUNT\s*:\s*([^\n]+)$/gim)];
  if (!matches.length) return { present: false, amount: null, raw: null };
  const raw = matches[matches.length - 1][1].trim();
  if (/^N\/A\b/i.test(raw)) return { present: true, amount: null, raw, notApplicable: true };
  const num = raw.replace(/[A-Za-z€$£\s]/g, '');
  const parsed = parseMoney(num);
  return { present: true, amount: parsed, raw };
}

// Handles both European (1.234,56) and US/UK (1,234.56) grouping.
export function parseMoney(s) {
  if (s === null || s === undefined) return null;
  let t = String(s).trim().replace(/\s/g, '');
  if (!t) return null;
  if (/\d\.\d{3},\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  const f = parseFloat(t);
  return Number.isFinite(f) ? f : null;
}

// Single-line fields from the mandatory final block.
export function parseField(text, name) {
  const re = new RegExp('^\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*([^\\n]+)$', 'gim');
  const matches = [...String(text || '').matchAll(re)];
  return matches.length ? matches[matches.length - 1][1].trim() : null;
}

// Every monetary figure that appears anywhere in the output. Used by the
// grounding scorer to hunt for invented amounts.
export function extractMonetaryFigures(text) {
  const out = [];
  const re = /(?:EUR|USD|GBP|THB|AED|CHF|€|\$|£)\s*([0-9][0-9.,]*)|([0-9][0-9.,]*)\s*(?:EUR|USD|GBP|€)/gi;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    const v = parseMoney(m[1] ?? m[2]);
    if (v !== null && v > 0) out.push(v);
  }
  return out;
}
