# Vertical Slice 01 — setup and verification

This implements Dashboard → draft session → active stopwatch → manual word entry → Supabase save → My Words, plus safe closing and read-only session history. The three approved documents remain unchanged. Sessions are **draft** or **closed incomplete**, with no completion, active-day, retention, production, or mastery awards.

## Requirements and configuration

- Node.js **22.13 or newer** (unit tests use Node's TypeScript stripping flag), npm, and a Supabase project.
- `.env.local` must contain `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. See `.env.example`. These are the project URL and publishable key, never a secret/service-role key. Restart Next.js after changing environment variables.
- No service-role key, database password, LLM key, or Python service is needed by the app.

## Apply version-controlled migrations through the CLI

Follow [the exact local validation and hosted deployment workflow](Supabase_Migrations.md). Supabase CLI **3.1.0** is pinned in the project. The revised, undeployed initial migration is `supabase/migrations/20261114000100_vertical_slice_01.sql`; its filename now includes seconds. Do not apply SQL manually through SQL Editor. No hosted migration has been applied by this agent.

The migration creates owner-scoped RLS, immutable original sentences, normalized duplicate protection, interval validation, and invoker-rights save/start/close functions. A partial unique index permits many historical sessions and only one active draft. Database triggers enforce word limits for direct writes as well as RPC saves. A composite foreign key prevents linking words to another account's session.

## Create the learner account manually

1. In Supabase **Authentication → Providers**, enable Email/password authentication.
2. In **Authentication → Users → Add user → Create new user**, create your learner email/password account and confirm its email (or finish its confirmation flow).
3. Set the Auth Site URL to `http://localhost:3000` for local use. This slice uses password sign-in and needs no OAuth or email callback route.
4. For a private single-learner app, disable public new-user signups in Supabase Auth. The app provides sign-in only, without public registration or password-reset UI. You can manage the account privately in Supabase.

The public key does not provide a database administration connection or a learner login. Knowing it alone is insufficient to verify authenticated persistence.

## Run locally

From `C:\Freelance\english-vocabulary-habit`:

```powershell
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You will be redirected to `/login` until signed in. For a production check:

```powershell
npm run build
npm start
```

## Verify the flow manually

1. Sign in using your Supabase learner account. The Dashboard shows the approved Sunday–Thursday, two-word plan and 20-word pilot target. No pilot start date or old achievements are imported.
2. Click **Start Your Routine Today**. Friday/Saturday default to a review-only draft because the review engine is not implemented. For this word-entry verification on those days, explicitly select exceptional new-word study. A resumed review draft has the same explicit option in the session.
3. Check that the active stopwatch advances. Pause it, wait, and confirm the display stays unchanged; resume to continue. Choosing three words applies to this draft only; the weekly plan remains two/day.
4. Manually enter `analysis` (then `approach` on a subsequent entry), the learning date, primary meaning, part of speech, one source example, and source URL. Useful context, a family form, and a synonym are optional. The visible IELTS Tutors AWL link is the source; no list has been scraped/seeded and order is not automatically validated.
5. Click **Hide notes & write my sentence**. The definition and source example are removed from view. Write your own first sentence. The app does not generate, correct, trim, or score it.
6. Before saving, reload once. The unfinished fields, sentence-writing step, and confirmed active time should recover; the timer is paused. Hidden/offline/suspended time is not added. If a cloud/local version differs after an interrupted response, explicitly restore the preserved local work or keep the cloud copy.
7. Click **Save word to My Words**. Confirm the success message and locate the word and exact original sentence. Expand **Word details & source** for the other fields. A failed save keeps your draft; retrying a committed request cannot duplicate its UUID. A normalized duplicate target is rejected rather than overwritten.
8. Fully reload My Words, or sign out and sign back in. The word should still be loaded from Supabase. My Words does **not** use local storage as its data source.
9. Visit `/words` signed out: it must redirect to sign-in. To check hosted isolation, use a second temporary account: it must not see the first learner's words. Local automated SQL tests cover the equivalent database policy behavior.
10. Save up to the selected count. A further word cannot be saved unless you increase the selection (maximum three). A selection below the saved count is rejected; the daily plan stays two.
11. In the session, enter some unfinished text, choose **Close unfinished session**, then **Close & keep history**. Its draft text, words, and active time remain in read-only Session history. Start another session: it gets a new ID and its own word selection. Closing is not completion.

## Checks

```powershell
npm run lint
npm test
npm run test:concurrency
npm run build
npm run typecheck
npm run test:e2e
```

- `npm test`: word validation, exact sentence preservation, account-scoped reads, date/weekend behavior, active intervals, pause gaps, and suspended time. It also runs the **actual migration** in an in-memory PostgreSQL engine (PGlite), simulating only Supabase's `auth.users`/`auth.uid()` primitives. SQL tests exercise save/reload, atomic rollback, stale-version protection, retries, duplicate words, immutable evidence, actual role-based RLS, cross-account writes/reads, anonymous denial, and review-only restrictions. This is local PostgreSQL verification, **not hosted Supabase Auth or browser verification**.
- `npm run test:e2e`: starts a local dev server if needed and tests signed-out route protection and the login page at desktop/mobile widths. Windows defaults to installed Microsoft Edge. On other systems run `npx playwright install chromium`; `PLAYWRIGHT_CHANNEL` can override the browser channel. Stop an unrelated server on port 3000 before running.
- `npm run test:concurrency`: creates an isolated temporary native PostgreSQL cluster, applies the same migration, and uses independent connections for starts, direct inserts, RPC retries, selection reductions, closing races, and higher-isolation snapshots. Requires PostgreSQL 17+ binaries; set `PG_BIN` to the bin directory if not found automatically. It never accepts a hosted database URL. The cluster is stopped and removed after the run.
- The live save/reload browser test is **skipped** unless a dedicated Supabase test learner is configured. It deliberately leaves an identifiable test word in that account; use a test account rather than your learning evidence.

To enable that live test, create a private, ignored `.env.test.local` containing these names with your dedicated account's values:

```dotenv
TEST_LEARNER_EMAIL=your-test-learner-email
TEST_LEARNER_PASSWORD=your-test-learner-password
```

Apply the migration to the project in `.env.local`, create/confirm the test account, and run `npm run test:e2e`. Credentials are loaded locally; do not paste them into chat or commit them. Browser tracing and automatic screenshots are disabled. Only the empty, signed-out login page is captured for desktop/mobile visual checks, under ignored `test-results/`. A successful run must include the live test before claiming hosted authentication and persistence verification.

Current stabilization check results and CLI limitations are recorded in [the migration workflow](Supabase_Migrations.md). Hosted migration application, authenticated browser sign-in, and save/reload persistence remain unverified. No hosted deployment was performed.

## Drafts and limitations

- There is one active draft per learner and any number of closed historical sessions. Closing persists the final draft and timing atomically, then makes that session read-only. Saved words are retained. Session date/type stay fixed; individual words have their own learning dates. There is no automatic midnight rollover or reopening of closed history.
- The selected count is enforced in the database across direct inserts and RPCs, including multi-row writes and concurrent transactions. Reducing it below saved words fails. Reaching the selection is not evidence of routine completion. `completed` is reserved and rejected by the database until a later migration implements the approved completion evidence.
- Draft fields and **closed, checkpointed active intervals** are saved to account/session-scoped browser storage immediately, and synced to Supabase after edits, on pause, and periodically while running. Fresh entry starts the timer; page recovery starts paused. Up to the latest heartbeat (about one second) can be conservatively omitted on interruption. Opening the source in another tab pauses the timer; resume on return.
- A same-browser Web Lock prevents simultaneous editors in two tabs where supported. Optimistic database versions detect cloud conflicts across devices. Local recovery is explicit when versions differ. This is not collaborative editing or a conflict-merging system.
- Local drafts contain personal sentence text on that browser and remain account-scoped across sign-out so unfinished work can be recovered. Use a trusted browser; clearing browser storage removes unsynced work. If storage is unavailable, the interface reports it; keep the tab open until cloud sync succeeds. This is not an offline-first app: initial loading and final word saves need a connection.
- A draft is not a completed learning session, review session, MVD, active day, or streak increment. No review obligations, feedback scores, or progress denominators are fabricated. Review count is explicitly unavailable.
- Feedback Coach, self-correction/corrected-version workflow, deterministic review engine, quick recall, completion, MVD execution, Progress, Parking Lot, search, and exports remain for subsequent slices. No Python service was added.

## File inventory

Modified existing files:

- `.gitignore`: allow the safe environment example; ignore browser test artifacts.
- `package.json`, `package-lock.json`: test scripts and PostgreSQL/browser dev dependencies; preserve the pre-existing Supabase dependencies.
- `README.md`: concise getting-started instructions.
- `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`: app metadata, request-time Suspense boundary, responsive interface, Dashboard.
- `AGENTS.md`: Next.js automatically added its managed agent-feedback block when the browser tests started `next dev`; this was not a product requirements edit.

Created files:

- `.env.example`, `playwright.config.ts`.
- `src/proxy.ts`: Supabase cookie refresh, signed-out redirects, private response headers.
- `src/app/actions.ts`, `src/app/error.tsx`.
- `src/app/login/page.tsx`, `src/app/session/page.tsx`, `src/app/words/page.tsx`.
- `src/components/login-form.tsx`, `src/components/shell.tsx`, `src/components/start-session.tsx`, `src/components/session-editor.tsx`.
- `src/lib/model.ts`, `src/lib/stopwatch.ts`, `src/lib/data.ts`.
- `src/lib/supabase/config.ts`, `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`.
- `supabase/migrations/20261114000100_vertical_slice_01.sql` (renamed and revised before its first deployment).
- `supabase/config.toml`, `supabase/.gitignore`, `docs/Supabase_Migrations.md`.
- `src/components/session-history.tsx`, `tests/helpers/database.mjs`, `tests/concurrency/postgres.test.mjs`.
- `tests/core.test.mjs`, `tests/database.test.mjs`, `tests/e2e/slice.spec.ts`.
- `docs/Vertical_Slice_01_Setup.md` (this file).

The three supplied routine/requirements/kickoff documents were read and left untouched. `.env.local` was not changed or printed. No commit or deployment was performed.

SSR and RLS patterns follow the bundled Next.js guidance and the official [Supabase SSR guide](https://supabase.com/docs/guides/auth/server-side/nextjs) and [RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security).
