# CaseEval golden set

A regression harness for the claims-evaluation prompt.

`index.html` contains ~28,000 characters of clinical and legal instructions
(`SECTION_0` + `SYS_EVAL`) that decide whether real claims are approved,
declined or held. Before this harness the only automated check on the whole
repository was `node --check` — which verifies that the JavaScript parses, and
nothing about whether the evaluations are correct. A prompt edit could silently
change verdicts and nobody would know until an insurer complained.

This turns a prompt change into a measurement.

## Running it

```bash
npm run eval:dry      # score the recorded outputs — no API calls, no key, instant
npm run eval:self     # prove the scorer catches defects (see "Self-test" below)
npm test              # syntax check + self-test + dry run — what CI runs

export ANTHROPIC_API_KEY=sk-ant-...
npm run eval                    # run the live prompt against the API
npm run eval -- --case=002      # one case
npm run eval -- --model=claude-opus-5
npm run eval:record             # run live and save outputs as the new recordings
```

Exit code is 0 only when every case passes every axis, so it drops straight
into CI or a pre-push hook.

## The prompt is never copied

`lib/extract-prompt.mjs` pulls `SECTION_0` and `SYS_EVAL` out of `index.html`
at run time. There is no second copy of the prompt to drift out of sync — edit
the prompt, re-run, see the effect. The same extractor also reads the 15
standard-exclusion labels, the 5 QA checklist items, and the Section III R&C
benchmark figures directly from the prompt text, so adding an exclusion label
automatically widens what the checklist scorer demands.

If the extraction ever stops matching, the harness throws loudly rather than
scoring a stale copy.

## The five axes

Each case is scored on five independent axes, so a failure names what broke.

| Axis | What it catches |
|---|---|
| `verdict` | The decision itself — APPROVED / DECLINED / PARTIALLY APPROVED / PENDING INFORMATION. |
| `checklist` | All 15 standard-exclusion rows present, parseable, and flagged correctly. |
| `amount` | `APPROVED AMOUNT` within tolerance, including the Rule 0.4 `N/A` form. |
| `format` | Strict `DECISION:` line, `POLICY CLAUSE`, `REASON`, full QA checklist, required banners. |
| `grounding` | Monetary figures that trace to no source document — i.e. invented amounts. |

### The parsers are the app's parsers

`lib/parse.mjs` mirrors the regexes in `index.html` character for character,
each annotated with the line it came from. This is deliberate. The app drives
its UI off these patterns — the verdict badge, the compliance checklist, the
case status. When model output drifts so the app's parser stops matching, the
app degrades *silently*: a checklist row vanishes, a verdict reads UNKNOWN.
Reusing the identical patterns here turns that into a failing score.

Commit `3e6ddde` fixed a colon collision in the STI label found by hand. Case
002 now covers that exact failure.

### How `grounding` works

A figure counts as grounded if it is printed in a source document, is a subset
sum of source figures (financial tables contain subtotals), follows from
deductible or co-payment arithmetic, or is one of the R&C benchmark figures
quoted in `SYS_EVAL` Section III — the model is *instructed* to cite those.

Anything left over is a number the model made up. Tolerance is zero. Raise it
only with a written justification per figure.

## Self-test

A scorer that only ever reports PASS is worthless, so `self-test.mjs` takes each
known-good output, injects one specific defect, and asserts the matching axis
flips to FAIL — and that unrelated axes stay PASS.

The ten defects include a transposed amount, an omitted QA checklist, a
silently dropped STI row, the `3e6ddde` colon collision, a missing Rule 0.4
banner, and a financial figure produced with no policy on file (a Rule 0.1
breach — the app approving money against invented policy terms).

This caught a real blind spot during development: a non-zero
`maxUnsourcedFigures` tolerance was absorbing genuine hallucinations.

## The cases

| ID | Case | Why it exists |
|---|---|---|
| 001 | Acute appendicitis, Greece — clean approval | Baseline. If this stops returning APPROVED, something broad broke. |
| 002 | Confirmed gonorrhoea + express STI exclusion | The STI HARD RULE: confirmed STI + express exclusion must be DECLINED, never PENDING. Also the checklist-format canary. |
| 003 | No policy document supplied | `SECTION_0` Rules 0.1 and 0.4 — the highest-priority guard rail. A regression means the app can approve money against policy terms it invented. |

All three are **synthetic** (`"synthetic": true`) — invented patients, invented
providers, invented policies. No real patient data is in this repository.

## Adding a real case

This is where the harness earns its value. Synthetic cases test the guard rails;
real cases test judgment.

1. Take a decided case where you are confident the outcome was right.
2. **Anonymise it.** Replace names, policy numbers, dates of birth and provider
   identifiers. Keep clinical substance and every monetary figure intact — the
   figures are what `grounding` checks against.
3. Copy the shape of an existing fixture. `sourceFigures` must list every
   monetary value legitimately available from the documents.
4. Set `expected` to the outcome you signed off on.
5. Run `npm run eval -- --case=<id>` and read the failures. A disagreement is
   information: either the prompt is wrong, or your expectation is.

Twenty real cases is roughly where this stops being a smoke test and starts
being a safety net.

## Deliberate limitations

- The message builder reproduces the *text* assembly in `runEval()`, not the
  file-attachment path. Fixtures carry document content as text. Real
  evaluations also send base64 PDFs and images, and that path is untested here.
- Pseudonymisation is not exercised. The fixtures are already synthetic.
- Live runs are non-deterministic. A single failure on a borderline case is a
  prompt to look, not proof of a regression — re-run before concluding.
- Costs real money in live mode. Three cases at ~8,000 output tokens each is a
  few cents; keep that in mind before pointing it at fifty cases in a loop.
