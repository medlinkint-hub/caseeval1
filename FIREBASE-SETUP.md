# Access control — how CaseEval is secured

This records what was actually done on **27 August 2026**, and the two routine
jobs you will need again: adding a colleague, and removing one.

The Firebase project is **`healthwatch-tpi1`** (shown in the console as
*Healthwatch-TPI1*). That is where the live `cases` and `policies` collections
are. Everything below refers to it.

---

## How it works now

Three pieces, in order of how much they matter:

**1. Firestore security rules.** These are the actual protection. On every read
and write, the database checks that the caller is signed in *and* has a record
at `team/{their user id}` with `approved: true`. Nothing else gets through.
This holds even against someone who never loads the app and addresses the
database directly.

**2. Firebase Authentication.** Sign-in with a Google account, verified on
Google's servers.

**3. The app's sign-in screen.** Convenience only. It hides the interface from
someone who is not signed in — it is not what protects the data.

The app is served from GitHub Pages at
`https://medlinkint-hub.github.io/caseeval1/`.

### Why it is keyed on user id, not email

A `team` document is named after the Firebase user id, which cannot be forged,
transferred, or re-registered. Anyone can create a Google account with a display
name resembling a colleague's; nobody can obtain someone else's user id.

---

## Adding a colleague

**They do this once:**

1. Open https://medlinkint-hub.github.io/caseeval1/
2. Press **Ctrl + Shift + R**
3. Click **Sign in with Google**, using their work Google account
4. They will see *"This account is not authorised"* — expected; their account
   is now registered but not approved
5. They tell you it's done

**Then you:**

6. Firebase console → **Authentication** → **Users**. Their email is now listed.
   Check it is the right account — a personal Gmail will appear here just as
   readily as a work one.
7. Copy their **User UID** with the copy icon.
8. **Firestore Database** → **Data** → click the **`team`** collection
9. **+ Add document**
10. Document ID: **paste their UID**. Do not use Auto-ID.
11. Add one field:

| Field | Type | Value |
|---|---|---|
| `approved` | **boolean** | `true` |

Optionally add `name`, `role` and `email` as strings — these only control how
the person is displayed in the app's Settings page.

12. **Save.** Tell them to hard refresh. They are in immediately.

> **The `approved` field must be type `boolean`.** The console defaults new
> fields to `string`, and the *text* `"true"` does not grant access. This is the
> single most common mistake.

---

## Removing someone

Open their document under `team` and either set `approved` to `false` or delete
the document. It takes effect within seconds — no deployment, no code change.

Do this the same day someone leaves. It is now the whole of your access control.

---

## If someone cannot get in

**"This account is not authorised"** — no `team` document, the document id does
not match their UID exactly, or `approved` is a string rather than a boolean.
Compare the id in `team` against the UID in Authentication → Users.

**"This web address is not authorised"** — the domain they are using is not in
Firebase → Authentication → Settings → **Authorised domains**. It should contain
`medlinkint-hub.github.io`.

**"Could not load the secure sign-in service"** — an ad-blocker, extension or
network is blocking `gstatic.com`. Try another browser or network.

**Signed in, but no cases appear** — sign-in succeeded and the rules refused the
data. Almost always the `approved` boolean again.

**They see the old password box** — a cached copy. Ctrl + Shift + R.

**You lock yourself out entirely** — the Firebase console edits `team` directly
and is not subject to these rules. You can always let yourself back in.

---

## Verifying the lock still holds

Firestore → **Rules** → **Rules Playground**:

- Simulation type: **get**
- Location: `/cases/anything`
- **Authenticated: off**
- **Run** → must report **Denied**

Worth repeating after any change to the rules.

---

## History

| Date | Event |
|---|---|
| 31 Mar 2026 | Rules set to `allow read, write: if true` — database open to anyone with the project id, which was published in a public repository |
| 27 Aug 2026 ~14:00 | Rules replaced with signed-in-and-approved; in-browser password gate replaced by Firebase Authentication |

The exposure window is those two dates. Recorded here because it is the kind of
thing that needs a contemporaneous note if it is ever assessed.

---

## Still outstanding

**The Anthropic API key is held in each user's browser.** Anyone with developer
tools can copy it and spend against the account. Lower severity than what was
fixed — it costs money, it does not expose patient records — but it is real. The
fix is a small server-side proxy so the browser never holds the key.

**The repository is public.** The code is readable by anyone; the data is not.
See below.

**Three unused Firebase projects** — `healthwatch-tpa`, `healthwatch-tpa2`,
`firestore-database-9e008`. Near-identical names to the live one are what caused
the app to be pointed at the wrong project for months. Confirm each is empty,
then delete them.

---

## Appendix — moving to Firebase Hosting (optional)

Not required. It was the original plan for getting a real login, but the login
was delivered on GitHub Pages instead. What it would still add:

- The repository can be made private at no cost, because GitHub Pages is no
  longer serving the app
- A better address — `healthwatch-tpi1.web.app`, or a custom domain
- Cache headers that make updates land immediately, removing the need for
  Ctrl + Shift + R after every deployment

`firebase.json` and `.firebaserc` are already in this repository, configured for
`healthwatch-tpi1`.

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only hosting
```

Afterwards: add the new domain under Authentication → **Authorised domains**,
tell the team the new address, and turn off GitHub Pages under repository
**Settings → Pages**.

The rules can also be deployed from here rather than pasted into the console:

```bash
firebase deploy --only firestore:rules
```
