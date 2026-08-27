# Moving CaseEval to Firebase Hosting

This replaces the in-browser password with a real sign-in, and locks the
database so it can only be read by approved people.

Read the whole page before starting. **Step order matters** — doing step 5
before step 4 will cut your team off from their data until you finish.

---

## What changes, in plain terms

**Before.** The password was checked inside the visitor's own browser, using a
fingerprint of the password stored in `index.html`. Because the file is public,
anyone could take that fingerprint and attack it offline. And because the check
ran on their machine, they could skip it — the app was already downloaded and
merely hidden. Separately, the database itself had no lock at all: anyone with
the project id (also in the file) could read every case without ever opening
the page.

**After.** Sign-in happens on Google's servers. The database checks, on every
single read and write, that you are signed in *and* on the approved team list.
That second check is the one that matters — it protects the data even from
someone who never loads the page.

---

## Which project this is

Everything below applies to the Firebase project **`healthwatch-tpi1`** (shown in
the console as *Healthwatch-TPI1*). That is where the live `cases` and
`policies` collections are.

You also have projects named `healthwatch-tpa`, `healthwatch-tpa2` and
`firestore-database-9e008`. The app used to name `healthwatch-tpa` in its
configuration by mistake — it holds no live case data. Do not enable sign-in or
deploy rules to any of those; check they are empty and delete them once this is
finished, so the confusion cannot recur.

## What you need

- The Google account that owns the `healthwatch-tpi1` Firebase project
- Node.js on your computer
- About 30 minutes

Install the Firebase command-line tool:

```bash
npm install -g firebase-tools
firebase login
```

---

## Step 1 — Turn on sign-in methods

In the [Firebase console](https://console.firebase.google.com/) → your project
→ **Authentication** → **Get started**.

Enable:
- **Google** — one click, uses the team's existing Google accounts
- **Email/Password** — for anyone without a Google account

Both are free and unlimited.

---

## Step 2 — Deploy the app

From the project folder:

```bash
firebase deploy --only hosting
```

This gives you a new address, something like `https://healthwatch-tpi1.web.app`.

Open it. You should see the sign-in screen. **Sign in with Google.**

You will be refused — that is correct and expected. Nobody is on the team list
yet. The screen shows your user id, which looks like `k3Jd8sPq...`.

**Copy that user id.** You need it for the next step.

---

## Step 3 — Put yourself on the team list

Firebase console → **Firestore Database** → **Start collection**.

- Collection id: `team`
- Document id: **paste the user id from step 2**

Add these fields:

| Field | Type | Value |
|---|---|---|
| `approved` | boolean | `true` |
| `name` | string | Your name |
| `role` | string | e.g. `Claims Lead` |
| `email` | string | Your email |

Go back to the app and sign in again. You should now be let in.

> **Why by user id and not by email?** Because a user id cannot be changed or
> claimed by someone else. Anyone can create a Google account with a
> display name that looks like a colleague's; nobody can forge a user id.

---

## Step 4 — Add the rest of the team

Each person opens the new address, tries to sign in, and is refused. The refusal
message shows *their* user id. They send it to you; you add a `team` document
for them exactly as in step 3.

To remove someone later, set their `approved` field to `false`, or delete the
document. It takes effect immediately — no redeploy.

**Do this for everyone before step 5.**

---

## Step 5 — Lock the database

Only once your whole team is on the list:

```bash
firebase deploy --only firestore:rules
```

From this moment the database refuses anyone not on the team list.

⚠️ **This also cuts off the old GitHub Pages version of the app.** It has no
sign-in, so it can no longer read anything. That is the point — but make sure
everyone has moved to the new address first.

Check it worked: Firebase console → Firestore → **Rules** tab should show the
contents of `firestore.rules`, and the **Rules Playground** should refuse an
unauthenticated read of `cases`.

---

## Step 6 — Retire the old site and make the repository private

1. GitHub → your repository → **Settings** → **Pages** → set Source to **None**.
   The old, unprotected address stops working.
2. GitHub → **Settings** → **General** → scroll to the bottom → **Change
   repository visibility** → **Private**.

Now that hosting is on Firebase, making the repository private costs nothing and
breaks nothing.

---

## If something goes wrong

**"This web address is not authorised"** — Firebase console → Authentication →
Settings → **Authorised domains** → add the domain you are opening the app from.

**"Could not load the secure sign-in service"** — an ad-blocker or firewall is
blocking `gstatic.com`. Allow it, or try another network.

**Signed in but refused** — your `team` document is missing, its id does not
exactly match your user id, or `approved` is not the boolean `true` (a *string*
`"true"` will not work — check the field type is boolean).

**You lock yourself out completely** — you can always edit `team` documents
directly in the Firebase console, which is not subject to these rules.

---

## Things worth knowing

**Sessions stay signed in** across browser restarts. On a shared computer you
may prefer sign-in to end when the browser closes. In `index.html`, find
`Persistence.LOCAL` and change it to `Persistence.SESSION`.

**This does not fix the Anthropic API key.** It is still held in each user's
browser and can still be copied by anyone with developer tools. That is a
separate change (moving the key behind a small server) and is not addressed
here.

**Cost.** Firebase Hosting and Authentication are free at your volume. Firestore
stays on the free Spark plan — 50,000 reads and 20,000 writes per day.

---

## Verifying the gate yourself

The sign-in gate is covered by browser tests:

```bash
npm install --no-save playwright
npx playwright install chromium
npm run test:auth
```

Twenty checks: ten that the app stays hidden when things fail (sign-in service
blocked, forged session, removed bypass functions), and ten that it opens for an
approved member and for nobody else — including when someone's approval is
revoked, and when the membership check itself errors. These also run
automatically on GitHub for every change.
