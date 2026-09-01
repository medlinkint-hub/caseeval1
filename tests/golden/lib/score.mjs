// Scores one model output against one case fixture's expectations.
//
// Five axes, each independently pass/fail so a regression points at what broke:
//
//   verdict    — did it reach the right decision?
//   checklist  — are all 15 exclusion rows present AND parseable by the app's
//                own regex, with the expected ones flagged as APPLIES?
//   amount     — is the approved amount within tolerance?
//   format     — does the mandatory final block exist, with a strict-matching
//                DECISION line and the 5 QA rows?
//   grounding  — does every monetary figure in the output trace back to the
//                source documents (or to arithmetic over them)?
//
// grounding is the one that catches the dangerous failure: a confident,
// well-formatted evaluation built on an invented number.

import {
  parseDecision, verdictToStatus, parseExclusionRows, parseQaRows,
  parseApprovedAmount, parseField, extractMonetaryFigures,
} from './parse.mjs';

// Every value reachable by summing a subset of the source figures. Financial
// tables legitimately contain subtotals, so a figure that is the sum of real
// line items is grounded even though it appears nowhere verbatim.
//
// Percentages matter too: the mandatory financial table applies a co-payment
// percentage to a subtotal, so `3060` is perfectly grounded when the invoice
// totals 3900, the deductible is 500 and the co-pay is 10% — even though 3060
// is neither printed anywhere nor a sum of line items.
function derivableValues(sourceFigures, percents = [], maxTerms = 12) {
  const base = [...new Set(sourceFigures)].filter(v => v > 0).slice(0, maxTerms);
  const r2 = v => Math.round(v * 100) / 100;
  const sums = new Set([0]);
  for (const v of base) {
    for (const existing of [...sums]) sums.add(r2(existing + v));
  }
  // Differences cover the "LESS: non-covered / LESS: deductible" rows.
  for (const s of [...sums]) {
    for (const v of base) {
      const d = r2(s - v);
      if (d > 0) sums.add(d);
    }
  }
  // Percentage applications cover the co-payment row and its remainder.
  for (const pct of percents) {
    if (!(pct > 0 && pct < 100)) continue;
    for (const s of [...sums]) {
      if (s <= 0) continue;
      sums.add(r2(s * pct / 100));
      sums.add(r2(s * (100 - pct) / 100));
    }
  }
  return sums;
}

function near(a, b, tol) { return a !== null && b !== null && Math.abs(a - b) <= tol; }

export function scoreOutput(fixture, output) {
  const exp = fixture.expected;
  const axes = {};

  // ── verdict ────────────────────────────────────────────────────────────
  const dec = parseDecision(output);
  axes.verdict = {
    pass: dec.verdict.toUpperCase() === String(exp.verdict).toUpperCase(),
    got: dec.verdict,
    want: exp.verdict,
    detail: dec.matchedStrict
      ? `status → ${verdictToStatus(dec.verdict)}`
      : 'NOT matched by the app\'s strict DECISION regex — app would fall back to loose parsing',
  };

  // ── checklist ──────────────────────────────────────────────────────────
  const rows = parseExclusionRows(output);
  const byLabel = new Map(rows.map(r => [r.label.toLowerCase(), r]));
  const missing = [];
  const wrongFlag = [];
  const expectedApplies = new Set((exp.exclusionsApply || []).map(s => s.toLowerCase()));
  for (const label of fixture._labels) {
    const row = byLabel.get(label.toLowerCase());
    if (!row) { missing.push(label); continue; }
    const shouldApply = expectedApplies.has(label.toLowerCase());
    if (row.applies !== shouldApply) {
      wrongFlag.push(`${label}: got ${row.applies ? 'APPLIES' : 'DOES NOT APPLY'}, want ${shouldApply ? 'APPLIES' : 'DOES NOT APPLY'}`);
    }
  }
  axes.checklist = {
    pass: missing.length === 0 && wrongFlag.length === 0,
    got: `${fixture._labels.length - missing.length}/${fixture._labels.length} rows parsed`,
    want: `${fixture._labels.length}/${fixture._labels.length} rows, correct APPLIES flags`,
    detail: [
      missing.length ? `unparseable/missing: ${missing.join(' | ')}` : null,
      wrongFlag.length ? `wrong flag: ${wrongFlag.join(' | ')}` : null,
    ].filter(Boolean).join('; ') || 'all rows parsed with correct flags',
  };

  // ── amount ─────────────────────────────────────────────────────────────
  const amt = parseApprovedAmount(output);
  const tol = exp.amountTolerance ?? 0.01;
  let amountPass;
  if (exp.approvedAmount === 'N/A') {
    amountPass = amt.present && amt.notApplicable === true;
  } else {
    amountPass = amt.present && near(amt.amount, exp.approvedAmount, tol);
  }
  axes.amount = {
    pass: amountPass,
    got: amt.present ? amt.raw : 'APPROVED AMOUNT line absent',
    want: exp.approvedAmount === 'N/A' ? 'N/A — policy required' : `EUR ${exp.approvedAmount} (±${tol})`,
    detail: amt.present ? '' : 'the app reads this line to populate the case financials',
  };

  // ── format ─────────────────────────────────────────────────────────────
  const qa = parseQaRows(output);
  const qaMatched = fixture._qaItems.filter(item =>
    qa.some(r => r.item.toLowerCase().startsWith(item.toLowerCase().slice(0, 40)))).length;
  const hasClause = !!parseField(output, 'POLICY CLAUSE');
  const hasReason = !!parseField(output, 'REASON');
  const formatIssues = [];
  if (!dec.matchedStrict) formatIssues.push('DECISION line does not match the strict regex');
  if (qaMatched < fixture._qaItems.length) formatIssues.push(`QA checklist ${qaMatched}/${fixture._qaItems.length}`);
  if (!hasClause) formatIssues.push('POLICY CLAUSE missing');
  if (!hasReason) formatIssues.push('REASON missing');
  if (exp.requireBanner && !output.includes(exp.requireBanner)) {
    formatIssues.push(`required banner absent: "${exp.requireBanner}"`);
  }
  axes.format = {
    pass: formatIssues.length === 0,
    got: formatIssues.length ? formatIssues.join('; ') : 'all mandatory fields present',
    want: 'strict DECISION line, POLICY CLAUSE, REASON, full QA checklist',
    detail: '',
  };

  // ── grounding ──────────────────────────────────────────────────────────
  const source = fixture.sourceFigures || [];
  const percents = [fixture.case.copayment].filter(v => typeof v === 'number');
  const derivable = derivableValues(source, percents);
  // Figures the model may legitimately cite that are NOT in the documents: the
  // R&C benchmark ranges baked into SYS_EVAL Section III. Quoting "appendectomy
  // benchmark EUR 2,500-7,000" is correct behaviour, not a hallucination.
  const benchmarks = fixture._benchmarkFigures || [];
  const figures = extractMonetaryFigures(output);
  const unsourced = [];
  for (const f of new Set(figures)) {
    const exact = source.some(s => near(s, f, 0.01));
    const derived = [...derivable].some(d => near(d, f, 0.01));
    const benchmark = benchmarks.some(b => near(b, f, 0.01));
    if (!exact && !derived && !benchmark) unsourced.push(f);
  }
  const maxUnsourced = exp.maxUnsourcedFigures ?? 0;
  axes.grounding = {
    pass: unsourced.length <= maxUnsourced,
    got: `${unsourced.length} unsourced figure(s)`,
    want: `≤ ${maxUnsourced}`,
    detail: unsourced.length
      ? `not traceable to source documents: ${unsourced.slice(0, 8).join(', ')}`
      : 'every monetary figure traces to the documents',
  };

  const passed = Object.values(axes).filter(a => a.pass).length;
  return {
    caseId: fixture.id,
    name: fixture.name,
    axes,
    passed,
    total: Object.keys(axes).length,
    pass: passed === Object.keys(axes).length,
  };
}
