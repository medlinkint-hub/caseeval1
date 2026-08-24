---
name: hwa-code-trio
description: >
  HWA Code Trio — the implement / review / secure workflow for changing code in the HWA single-file
  apps (CaseEval1, CaseEval, AWAS Suite, HWA Network). Use this skill for ANY request to change,
  add, fix, refactor, or extend code in one of these apps — triggers on "add a feature", "fix the
  extraction", "change the upload", "update index.html", "add a field", "make it save", CaseEval,
  AWAS, HWA Network, or any edit to app code. Runs the implementer, then a fresh-context reviewer
  agent, then a fresh-context security & GDPR agent, then the CI syntax check. These are medical TPA
  apps handling patient data and every push to main deploys instantly — the security pass is not
  optional. Trivial copy/CSS/branding tweaks skip the agents but never skip the syntax check.
---

# HWA Code Trio — implement, review, secure

Three passes over every code change: an implementer, a reviewer, a security & GDPR auditor.
Each agent runs in **fresh context** so it reads the diff cold, the way a stranger would.

---

## Step 0 — Confirm the target

Two CaseEval apps exist:

| App | URL | Repo | State |
|---|---|---|---|
| **CaseEval1** | medlinkint-hub.github.io/caseeval1 | `medlinkint-hub/caseeval1` | active development |
| **CaseEval** (original) | medlinkint-hub.github.io/caseeval | `medlinkint-hub/caseeval` | maintenance mode |

If the request doesn't say which app, **ask before touching anything**. Same rule for AWAS Suite
(`awas-suite`) and HWA Network (`hwa-network-`).

**Clone a fresh copy of the repo at the start of every task.** Never edit from memory of an old
version — `index.html` moves fast and a stale copy silently reverts someone else's work.

---

## House architecture (all three agents enforce this)

* Single-file `index.html`. Vanilla JS. **No frameworks, no build step, no npm dependencies.**
* Firebase Firestore backend: project `healthwatch-tpa`, region `europe-west3`.
* Anthropic API called directly from the browser
  (`anthropic-dangerous-direct-browser-access: true`). The user's API key lives only in
  `localStorage` under `mp_key` — **never in the repo**.
* GitHub Pages deployment under the `medlinkint-hub` org — **every push to main goes live**.
* HWA branding: navy `#1a2f5e`, red `#c0392b`, Inter font.

Existing patterns to reuse rather than reinvent (line numbers are CaseEval1 at time of writing —
re-grep, don't trust them):

* `esc()` — the HTML-escape helper (`const esc = s => String(s||'')…`, ~line 517). Every
  user-supplied or AI-generated string that reaches `innerHTML` goes through it.
* `toast(m, dur)` — the notification helper (~line 569). Not `alert()`.
* localStorage key scheme: app-wide keys are `mp_*` (`mp_cases`, `mp_policies`, `mp_key`);
  per-case data is prefix + id (`fd_<caseId>_<fileIndex>` for file data, `invs_<caseId>` for
  invoices). Every write is wrapped in try/catch — quota is a real failure mode, not a theoretical one.

---

## Step 1 — Implementer (main session)

Make the change. **Prefer the smallest diff that does the job.** Keep existing patterns. Do not
restructure unrelated code, do not reformat, do not "clean up while you're in there."

---

## Step 2 — Reviewer agent (spawn via Agent tool, fresh context)

Give it the diff plus enough surrounding code to judge it, and instruct it to **hunt for problems,
not to praise**:

* **Correctness** — does the change do what was asked? Any regression in adjacent flows: case
  reload, document upload, offline/PWA behaviour, localStorage quota?
* **Edge cases** — empty inputs, Greek text, very large documents, API errors mid-extraction.
* **Consistency** with the house architecture above.

The implementer applies accepted findings and **rejects bad ones with a stated reason**. A rejected
finding is a decision, not an oversight — write the reason down.

---

## Step 3 — Security & GDPR agent (spawn via Agent tool, fresh context)

Checklist audit of the **final** diff. This is a medical TPA app handling patient data:

* **No secrets committed** — Anthropic keys (`mp_key`), GitHub tokens (`mp_gist_token`), any
  credential. Firebase *web config* keys are fine (they're public by design).
* **XSS** — any user-supplied or AI-generated string reaching `innerHTML` must pass through
  `esc()`. Flag **every** unescaped sink the diff adds or touches.
* **No patient data or PII** in `console.log`, error messages, toasts, or analytics.
* **Firestore** — access matches the deployed security rules. No widening of read/write scope.
* **GDPR** — any new personal-data field or new processing step gets flagged so the DPIA /
  Article 30 RoPA can be updated.
* **Network** — calls only to Anthropic and Firebase. No new third-party endpoints, no CDN
  script tags.

---

## Step 4 — Verify (always, even for tiny edits)

Run the same check CI runs, from the repo root:

```bash
node .github/scripts/check-syntax.js
```

It pulls every inline `<script>` block out of `index.html` and runs `node --check` on them.
A syntax error here breaks the live app on push. If the change touches extraction logic, also
**dry-read the modified functions end-to-end** — the syntax check catches typos, not logic.

---

## Step 5 — Deliver

Send the updated `index.html` (or a diff, for large files) with a short summary:

1. what changed,
2. what the reviewer caught,
3. what the security agent flagged.

**Never push to the repo without explicit approval — pushes to main deploy instantly.**

---

## Scale rule

| Change | Passes |
|---|---|
| Copy, CSS, branding tweak | implement + Step 4 |
| Extraction logic, storage, Firestore, API calls | full trio |
| In doubt | run the security agent — it's cheap compared to a leak |
