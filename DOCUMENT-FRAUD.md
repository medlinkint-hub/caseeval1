# Document & identity fraud detection

Added to the case view as **Document & Identity Integrity**, beside the existing
Fraud Indicators panel.

## The one distinction that matters

The panel reports two kinds of thing, and they carry very different weight.

**Computed findings are facts.** Check digits, cross-document arithmetic, date
logic and duplicate invoice numbers are calculated from the documents. They give
the same answer every time and do not depend on a model's opinion. You can put
one of these in a letter to an insurer.

**AI observations are impressions.** "The total appears to be in a different
font" comes from a model looking at a scan. It is a reason to have a person
look, never a conclusion on its own. Every one of these is labelled *(AI
observation)* in the panel and can never raise the case to critical by itself.

If you remember nothing else: act on the computed findings, investigate the
observations.

## What is checked without any API call

Runs instantly on every case, free, from data already extracted:

| Check | Why it matters |
|---|---|
| Identity check digits (ICAO Doc 9303, TD1/TD2/TD3) | A genuine passport or ID is arithmetically self-consistent. One altered character fails. |
| Identity document holder vs case patient | The document belongs to someone else. |
| Identity document expiry vs date of loss | Expired at the time of treatment. |
| Document names a different patient | Another person's records attached to this claim. |
| Duplicate invoice number within a case | Same invoice submitted twice. |
| Invoice number reused across patients | One invoice cannot belong to two people. |
| Line items vs printed total | An altered figure usually breaks the invoice's own addition. |
| Future dates, pre-admission dates, long post-discharge dates | Dates that cannot be true. |
| Payment card shared between unrelated patients | A recognised organised-fraud pattern. |
| Alterations noted when the document was read | Handwriting, correction fluid, overwriting. |
| High-value invoice with no provider tax number | Legitimate providers are tax-registered at this value. |

## What the "Examine Documents & ID" button does

Sends the case's documents to the model and asks it for two things only:

1. **A verbatim transcription** of any machine-readable zone on a passport or ID.
2. **What it can see** on the page — a figure in the wrong font, a stamp
   duplicated pixel-for-pixel, a total that disagrees with its column.

It is explicitly told **not** to judge authenticity. The transcribed MRZ is then
verified by the check-digit arithmetic in the app, not by the model. A model
asked "is this passport valid?" will often just say yes; the arithmetic cannot
be talked round.

Costs one API call per run. Re-run it after adding documents.

## Why it does not say "forged"

The evaluation prompt forbids stating or implying that a document is forged. It
describes what is wrong and what would resolve it. Determining fraud is for HWA
and the insurer.

This is deliberate. A poor scan, an unfamiliar national invoice format, a
reissued or translated document and an ordinary clerical error all look
suspicious and are none of them fraud. An accusation is hard to withdraw, and a
wrong one is worse than a missed one — so where an innocent explanation is as
likely, the evaluation says so.

## Tested

`npm run test:fraud` drives the detector in a real browser: twenty checks
covering a genuine ICAO specimen passport, a passport with one altered
character, a document in the wrong name, an invoice that does not add up,
duplicate and reused invoice numbers, and future dates.

Half of those checks are **false-positive tests** — a shortened patient name, a
name given surname-first with a title, one cent of rounding. A detector that
fires on honest paperwork gets ignored within a week, and then it catches
nothing. Those cases must stay silent, so they are tested as hard as the
detections.

Runs in CI on every push.
