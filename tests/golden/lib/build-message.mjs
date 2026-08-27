// Rebuilds the system prompt and user message the way runEval() does, from a
// case fixture instead of live app state.
//
// FIDELITY NOTE: this mirrors the *text assembly* in index.html runEval()
// (index.html:2138-2600) — SECTION_0 prepend, claim-type guidance, policy
// block, case header, and the mandatory-final-line footer. It deliberately
// does NOT reproduce the file-attachment path (base64 PDFs/images), the
// supplementary-evaluation context, or the duplicate-claim context. Fixtures
// therefore carry their document content as text under `documents`, which is
// how the app also ends up sending scanned text for non-PDF formats.
// A drift between this builder and runEval() weakens the harness, so any
// change to the wrapper in index.html should be reflected here.

import { extractPrompts } from './extract-prompt.mjs';

const NL = '\n';

// --- mirrors index.html runEval() _typeGuidance (index.html:2153-2170) ---
function typeGuidance(type) {
  if (type === 'nonmedclaim') {
    return '\n═══════════════════════════════════════════════\nCLAIM TYPE: NON-MEDICAL\n═══════════════════════════════════════════════\n'
      + 'This is a NON-MEDICAL claim (e.g. trip cancellation, baggage, travel disruption, personal liability) — there is no clinical presentation to assess.\n'
      + 'Sections II (Clinical Evaluation Layers) and VI items 5 (Clinical Assessment), 6 as a CLINICAL matter, and 10 (Medication Coverage) do not apply — write "N/A — non-medical claim" for each and move on; do not invent clinical content.\n'
      + 'Put your depth into: policy verification, coverage territory, notification timelines, the specific circumstances of the loss (cancellation reason, baggage loss/damage circumstances, liability facts), Section V travel-specific rules where relevant (72-hour notification, adventure/sports, alcohol/drugs, terrorism/political risk), applicable exclusions, and a full financial breakdown of the claimed items.\n';
  }
  if (type === 'ipmi_medical') {
    return '\n═══════════════════════════════════════════════\nCLAIM TYPE: IPMI (cross-border / expatriate medical)\n═══════════════════════════════════════════════\n'
      + 'This is an International Private Medical Insurance claim — cross-border or expatriate cover.\n'
      + 'Apply Section V (Travel Insurance Specific Rules) IN FULL where relevant to this claim: territorial restrictions and network status, EHIC/reciprocal healthcare if treatment was in the EU/EEA, fit-to-travel where applicable, policy activation dates.\n'
      + 'Apply the FULL clinical assessment (Section II, Layers A-C) and use the COUNTRY-SPECIFIC R&C benchmark from Section III that matches the actual country of treatment — not a generic average.\n';
  }
  return '\n═══════════════════════════════════════════════\nCLAIM TYPE: MEDICAL (domestic / in-network)\n═══════════════════════════════════════════════\n'
    + 'This is a medical claim, most likely treatment within the insured\'s home country or usual network rather than cross-border care.\n'
    + 'Apply the FULL clinical assessment (Section II, Layers A-C) and cost-containment (Section III / Layer C) — this is where your depth matters most here.\n'
    + 'Section V (Travel Insurance Specific Rules — EHIC, fit-to-travel, 72-hour notification, adventure sports) most likely does NOT apply. Only invoke it if the case facts actually indicate cross-border or travel-related care, and say so explicitly if you do.\n';
}

export async function buildSystemPrompt(fixture) {
  const { SECTION_0, SYS_EVAL } = await extractPrompts();
  let sys = SECTION_0 + '\n\n' + SYS_EVAL;
  sys = sys + '\n' + typeGuidance(fixture.case.type);
  if (fixture.policy && fixture.policy.wording) {
    sys += '\n\n=== POLICY: ' + (fixture.policy.name || 'Policy') + ' ===\n'
        +  fixture.policy.wording + '\n=== END POLICY ===\n';
  }
  return sys;
}

// --- mirrors index.html runEval() mandatoryEnd (index.html:2575-2589) ---
const MANDATORY_END = '\n\n=== MANDATORY FINAL LINE ===\n'
  + 'Your response MUST end with one of these lines on its own line:\n'
  + 'DECISION: DECLINED\n'
  + 'DECISION: APPROVED\n'
  + 'DECISION: PARTIALLY APPROVED\n'
  + 'DECISION: PENDING INFORMATION\n'
  + 'Write ALL 13 sections in full — you have a large output budget, so skipping or abbreviating sections '
  + '8-12 should not be necessary. Only skip directly to section 13 if you are genuinely about to run out of '
  + 'output space; this should be rare. '
  + 'DO NOT end your response without a DECISION: line.\n\n';

export function buildUserMessage(fixture) {
  const c = fixture.case;
  const docs = fixture.documents || [];

  let docManifest = '';
  if (docs.length) {
    docManifest = '\nDOCUMENTS SUBMITTED:\n'
      + docs.map(d => '  • ' + d.name).join('\n')
      + '\nRULE: Every document listed above is already provided in this evaluation. '
      + 'Do NOT request resubmission of any listed document. '
      + 'If additional information is needed, specify the exact document type required and the reason it is needed.\n\n';
  }

  const line = (label, val) => (val === undefined || val === null || val === '' ? '' : label + ': ' + val + NL);

  let header = 'CASE: ' + (c.caseNum || '-') + NL
    + line('CLAIM TYPE', c.type)
    + line('COUNTRY OF TREATMENT', c.country)
    + line('COUNTRY OF RESIDENCE', c.countryOfResidence)
    + line('INSURER', c.insurer)
    + line('POLICY NUMBER', c.policyNumber)
    + ((c.policyStart && c.policyEnd) ? 'POLICY PERIOD: ' + c.policyStart + ' to ' + c.policyEnd + NL : '')
    + line('DATE OF LOSS', c.dol)
    + line('DEDUCTIBLE', c.deductible === undefined ? '' : 'EUR ' + c.deductible)
    + line('CO-PAYMENT', c.copayment === undefined ? '' : c.copayment + '%')
    + line('PRIMARY DIAGNOSIS', c.diagnosis)
    + 'AMOUNT CLAIMED: ' + (c.amountClaimed ? (c.currency || 'EUR') + ' ' + c.amountClaimed : 'Not provided') + NL
    + NL + 'DESCRIPTION:' + NL + (c.desc || '') + NL + NL
    + 'ICD CODES: ' + (c.icdCodes && c.icdCodes.length ? c.icdCodes.join(', ') : 'not specified') + NL
    + 'PA NUMBER: ' + (c.paNumber || 'none') + ' STATUS: ' + (c.paStatus || 'not set') + NL;

  let docText = '';
  for (const d of docs) {
    docText += '\n=== DOCUMENT: ' + d.name + ' ===\n' + d.text + '\n=== END DOCUMENT ===\n';
  }

  const instructions = NL + 'INSTRUCTION: Write the ENTIRE evaluation in ENGLISH.' + NL
    + 'EVALUATION INSTRUCTIONS:' + NL
    + 'You are evaluating case ' + (c.caseNum || '-') + ' for patient ' + (c.patient || 'unknown') + '.' + NL
    + 'Provide a DEFINITIVE and FINAL evaluation. This evaluation cannot be changed later.' + NL
    + 'Base your decision ONLY on the facts provided above and the policy wording.' + NL
    + 'Do NOT consider possibilities or alternatives not stated in the case facts.' + NL
    + 'Complete all 12 sections. The DECISION must be one of: APPROVED / PARTIALLY APPROVED / DECLINED / PENDING INFORMATION.' + NL
    + 'PENDING INFORMATION is only allowed if critical documents are explicitly missing.' + NL
    + 'Format the last section EXACTLY as:' + NL
    + 'DECISION: [verdict]' + NL
    + 'APPROVED AMOUNT: EUR [number]' + NL
    + 'POLICY CLAUSE: [clause]' + NL
    + 'REASON: [one sentence]' + NL
    + 'NEXT STEPS: [action]';

  return docManifest + header + docText + instructions + MANDATORY_END;
}
