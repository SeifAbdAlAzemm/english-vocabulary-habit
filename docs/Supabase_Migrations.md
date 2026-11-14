# Supabase migration workflow and slice 01 stabilization

The hosted database is fresh. **Nothing has been deployed or verified remotely.** The initial migration was revised before first deployment and renamed to the standard 14-digit timestamp `20261114000100_vertical_slice_01.sql`. Once a migration has been deployed, leave it immutable and add a new migration for subsequent changes. The approved Routine V1.1 and App Requirements V1.0 remain unchanged.

## What changed

- `draft → closed_incomplete` is the available lifecycle. Closing atomically stores unsaved text and confirmed active intervals, keeps saved words linked to the original session, and makes history read-only. An identical close retry returns the existing result; a retry with different work is rejected so newer local text is not silently discarded.
- A partial unique index on `user_id WHERE status = 'draft'` allows many historical sessions and only one active draft. `start_study_session` uses this index to safely return/create a draft under concurrent requests.
- `completed` is reserved in the schema, but inserts and transitions to it are rejected. Saving all selected words cannot establish approved routine completion while feedback, review, quick recall and the full finish flow are absent. A future migration must implement evidence-aware completion before enabling it. No fake completion flag or client-controlled evidence bypass was added.
- Every authorized word insert, including direct and multi-row SQL writes, updates the parent session row before counting words. That write serializes inserts, count reductions and closing. It also invalidates stale repeatable-read/serializable snapshots. The trigger rejects counts above `chosen_words`; the session trigger rejects reductions below saved words. The official `planned_words = 2` constraint is unchanged.
- Save/start/close RPCs use `SECURITY INVOKER`; RLS remains effective. Word saves still atomically insert immutable evidence and clear the draft. Existing-word retries return the original UUID before checking version/count/status, so full or closed sessions cannot break a legitimate retry. Anonymous access, cross-account writes and word updates/deletes remain unavailable.

## Pinned tools and project configuration

`supabase` **3.1.0** is an exact dev dependency; use `npm ci` and `npx --no-install supabase` so the installed version is used. Keep `supabase/config.toml` and `supabase/.gitignore` in version control with the SQL migrations. The config uses PostgreSQL 17 locally, disables seeds/public signup, and contains no hosted project reference or credentials. Confirm that the hosted PostgreSQL major version matches before local parity testing. Linking state and runtime files under `supabase/.temp` are ignored.

The CLI v3 defaults database commands to **local**. Use explicit `--remote` only in the hosted steps below. These commands were checked against the pinned CLI's help. Do not copy older CLI v2 `--linked`/`--local` recipes into this workflow.

## 1. Validate locally first

Start Docker Desktop's Linux container engine, then from the repository root:

```powershell
cd C:\Freelance\english-vocabulary-habit
npm ci
npx --no-install supabase --version
npx --no-install supabase start
npx --no-install supabase db reset --no-seed
npx --no-install supabase db lint --schema public --fail-on warning
npx --no-install supabase migration list
npm test
npm run test:concurrency
npm run lint
npm run build
npm run typecheck
```

`db reset` here rebuilds **only your disposable local Supabase database** and removes its local test data. Never add `--remote` to reset. No seed or baseline words are imported. `supabase start` displays local development keys; keep that terminal output private. Local Auth users can be created privately through the local Studio. The native concurrency suite requires PostgreSQL 17+ binaries, independent of Docker; on Windows it discovers the standard PostgreSQL 17 installation, or use `$env:PG_BIN = 'C:\path\to\PostgreSQL\17\bin'` before running it.

This repository is already initialized: **do not rerun `supabase init --force`**. For future schema changes use `npx --no-install supabase migration new descriptive_name`, edit the new SQL file, and repeat local reset/lint/tests. Use `npx --no-install supabase stop` when finished with the local stack.

## 2. Link and review the hosted deployment later

These commands are for the learner to run after local validation; the agent has not run them. Replace only the non-secret project reference placeholder:

```powershell
npx --no-install supabase login
npx --no-install supabase link --project-ref YOUR_PROJECT_REF
npx --no-install supabase migration list --remote
npx --no-install supabase db push --remote --dry-run --skip-vault
```

Authenticate through the CLI's private login flow. Enter any database password only in a secure prompt if requested; do not place passwords/tokens on a command line, in tracked files, or in chat. The app's `.env.local` publishable key is not a CLI management credential. Review that the dry run lists only `20261114000100_vertical_slice_01.sql`, with no previously applied history on the fresh project. `--skip-vault` prevents this workflow from updating Vault secrets.

## 3. Deploy only when you choose

After reviewing the local results and remote dry run:

```powershell
npx --no-install supabase db push --remote --skip-vault
npx --no-install supabase migration list --remote
```

This is the step that changes the hosted schema. No hosted SQL Editor edits, `migration repair`, `--include-all`, seed pushes, or remote resets are needed for this fresh database. The push runs the checked-in migration and records its version. Keep deployed migrations in Git unchanged from then on. SQL migration push does not push Auth configuration; the tracked signup settings apply locally. Configure the hosted learner account and private Auth settings separately as described in the setup guide.

Then run the app and the manual recovery/save/reload/close/new-session checks in [the setup guide](Vertical_Slice_01_Setup.md). To run the live browser suite, supply a dedicated learner through ignored `.env.test.local` as documented there. It creates identifiable test words; use a test account. Do not claim hosted Auth/persistence verification until that end-to-end test succeeds.

## Changed files for this stabilization

- Revised/renamed `supabase/migrations/20261114000100_vertical_slice_01.sql`.
- Added `supabase/config.toml`, `supabase/.gitignore` and this guide.
- Updated `src/app/actions.ts`, `src/app/page.tsx`, `src/app/session/page.tsx`, `src/lib/model.ts`, `src/components/start-session.tsx`, `src/components/session-editor.tsx`.
- Added `src/components/session-history.tsx`.
- Updated `tests/database.test.mjs`, `tests/e2e/slice.spec.ts`; added `tests/helpers/database.mjs` and `tests/concurrency/postgres.test.mjs`.
- Updated `package.json`, `package-lock.json`, `README.md`, `docs/Vertical_Slice_01_Setup.md`.

## Remaining limits

- Closed incomplete sessions are terminal and read-only. There is no completion, reopening, automatic midnight rollover, or collaborative conflict merging. The UI lists the most recent 20 closed sessions; older records remain in the database.
- No AI feedback, spaced reviews, progress dashboards, exports, or new learning rules were implemented.
- Local SQL/native tests simulate Supabase identity primitives. They verify actual PostgreSQL permissions and RLS, but do not verify hosted Auth, PostgREST, or the complete Supabase container stack.

## Stabilization verification results — 14 November 2026

The `start_study_session` lint warning (`2F005`, `warning extra`) was reproduced against the local Supabase stack. Its original unconditional `LOOP` had no `EXIT`: it could only return an ID, retry, or raise an error. The linter conservatively treated the end of that loop as reachable. Both successful branches now use `EXIT WHEN FOUND`, followed by a single, reachable `RETURN session_id` after the loop. The retry path, row lock, unique-index conflict handling, invoker rights, and lint threshold are preserved.

Regressions cover creation returning an owned UUID, existing draft recovery without mutation, invalid settings/missing identity, simultaneous starts, and a conflicting draft closing while the start function waits on its locked lookup. The latter must retry and return a new active draft while preserving the closed session.

| Check | Result |
|---|---|
| `npm test` | 23 passed, no failures or skips |
| `npm run test:concurrency` | 11 passed, including ten multi-connection race scenarios, no failures or skips |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed |
| `npx --no-install playwright test --grep=private` | Previously passed; not rerun for this SQL-only fix |
| `git diff --check` | Passed |
| `npx --no-install supabase db reset --no-seed` | Passed against the local Supabase stack; applied the existing initial migration |
| `npx --no-install supabase db lint --schema public --fail-on warning` | Passed against the rebuilt local stack: no schema errors, empty results, unchanged strict threshold |

The final migration was executed in the local Supabase stack, PGlite, and an isolated native PostgreSQL 17 cluster. The native cluster was stopped and removed after testing; the user's local Supabase stack was left running. CLI access and the native tests/build used the necessary sandbox escalations. The expanded live learner browser scenario was not run. No hosted link, remote dry run, hosted migration application, or remote verification was performed. Only the existing migration, `tests/database.test.mjs`, `tests/concurrency/postgres.test.mjs`, and this verification record changed for the return-path fix.

References: [Supabase CLI installation](https://supabase.com/docs/guides/local-development/cli/getting-started), [migration workflow](https://supabase.com/docs/guides/deployment/database-migrations), [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html), [trigger visibility](https://www.postgresql.org/docs/current/trigger-datachanges.html).
