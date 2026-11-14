# Vertical Slice 02 — implementation report

Implemented and locally verified on 14 November 2026. No hosted migration, remote dry run, deployment, or Git commit was performed. The approved requirements, Slice 02 kickoff, and deployed `20261114000100_vertical_slice_01.sql` are unchanged. Historical setup documents that describe Slice 01 as undeployed are superseded by the accepted kickoff.

## Working flow

- **Dashboard → Review** shows due words, grouped cards and overdue counts using the browser's IANA timezone. **Start review session** opens the shared recoverable stopwatch/editor.
- Review shows only the word, part of speech, obligation type and scheduled date. **Remembered / Forgot** atomically saves the first recall. **Reveal saved answer** is available only afterward; Day +7 additionally requires a new independent sentence. **I checked the answer and corrected mistakes** records feedback completion.
- A forgotten result schedules one next-local-day remedial obligation. Coinciding milestone/remedial obligations share a word/date card and first result while retaining separate obligation records. Additional retrieval is explicitly **Extra Practice**.
- **Dashboard → Start MVD** or **Review → Start MVD** snapshots the applicable due / extra / first-day learning path. Stored practice and answer checks establish qualification; **Finish MVD** cannot award an empty draft. Completing MVD leaves other reviews due and does not change the two-word plan.
- Regular learning requires due review and answer checks before new-word entry. It remains draft or closed incomplete; full learning completion requires Slice 03. Review-only completion requires genuine same-day practice, answer checks, no remaining reviews due for its session date, and no new learning words in that session.
- **My Words → Review schedule & immutable first attempts** displays scheduled/actual dates, late status, pending production, the original Day +7 sentence, remedial records and extra practice. **Session → Session history** shows completed practice or closed unfinished work, active time, recall/answer-check counts and preserved drafts.

## Migration and integrity

New migration: `supabase/migrations/20261114000200_vertical_slice_02.sql`.

It adds `review_obligations`, `review_attempts`, `review_productions`, `review_reveals`, `review_feedback`, the invoker-rights `review_schedule` view, MVD session metadata, and narrowly scoped lifecycle/review functions. New review tables are owner-scoped under RLS, have no anonymous access and permit authenticated writes only through checked RPCs. Original word saves retain invoker rights and existing protections.

The migration inserts exactly +1/+3/+7/+14/+30 obligations for **all existing words**, across owners and historical sessions, using each word's own `learn_date`. Unique partial indexes and `ON CONFLICT DO NOTHING` make creation idempotent. A word-insert trigger schedules future saved words. The authenticated `backfill_review_obligations()` repair function considers only `auth.uid()`'s words. No backfill updates words, original sentences, or session history.

Official results are unique per word/scheduled date, and obligation kinds/checkpoints remain immutable. Production is stored separately so a partial Day +7 recall remains due until its first sentence exists **and its answer has been revealed and checked**. Evaluation is `pending_evaluation`; no score column or fabricated score was introduced. Production cannot first be added after answer reveal. A new current draft can finish a partially submitted review without changing the original attempt/session evidence.

Parent-session writes and versions serialize review saves, timer/draft sync, word saves, feedback, closing and completion. Official-card writes also lock the owned word. Existing single-draft, word-count, closed-history, original-sentence and authentication protections remain. Administrative deletion of a disposable local Auth learner cascades its dependent review evidence; authenticated learners have no evidence-delete permission.

Completed MVD/review sessions retain `local_date`, intervals and evidence references. Future consistency can count distinct qualifying dates; this slice does not display a fabricated streak, mastery award or retention percentage.

## Completion-integrity review before hosted deployment

The reported defect was **confirmed** against the initial Slice 02 SQL. A regression saved three due words' first recalls, revealed/acknowledged only one answer, and called `complete_practice_session`: the RPC incorrectly succeeded. The old view also removed all three obligations from the due queue. An extra-practice session had the same one-acknowledgment eligibility weakness.

The existing, undeployed Slice 02 migration now defines one invoker-rights/RLS-aware predicate, `review_attempt_is_complete(uuid)`: a saved first recall, any required Day +7 first sentence, saved answer reveal, and saved feedback acknowledgment must all exist. `review_schedule.completed`, session completion and MVD qualification share this predicate. Any attempt started in a session must finish its feedback cycle before that session can complete, including extra practice. Review-only sessions must additionally have no due obligations outstanding. MVD still requires only its applicable distinct-word target and can leave **unattempted** obligations due.

Unchecked recalls and partially submitted Day +7 work stay in the existing due queue. Recovery loads their original attempt IDs, including attempts from closed drafts; it does not ask for a replacement official recall. Coinciding milestone/remedial obligations complete together only after the full shared card is checked. Forgot still schedules its next-day remedial immediately, without moving milestones.

For future metrics, `milestone_metric_eligible` is true only for fully completed milestone obligations. Remedial obligations stay excluded. This field supports recall/review-completion eligibility; Day +7 Production Accuracy must also wait for a real production evaluation. The view exposes `completed_at`, `completed_date`, and `completion_was_late` separately from immutable first-recall `attempted_at`, `actual_date`, and `was_late`, so a later answer check cannot silently rewrite recall timing. My Words distinguishes pending production from a pending answer check and displays both recall and completion dates.

Regressions cover partially acknowledged multi-word scheduled/extra/MVD sessions, reveal without acknowledgment, recovering unchecked recalls, late feedback dates, metric eligibility, and RLS for the shared predicate. A native two-connection test races the final feedback acknowledgment against session completion; the stale competing completion is rejected before a safe retry. A real local Auth/browser test verifies two unchecked words remain due after only one acknowledgment, completion stays disabled/rejected, and reload preserves the remaining work.

Only the undeployed Slice 02 migration, its dependent word-history display, completion verification SQL, tests and implementation/acceptance notes were amended for this review. The deployed Slice 01 migration and approved documents remain unchanged. No remote migration or Git commit was made.

## Verification results

Final successful results (Node test counts include parent tests):

| Command | Result |
|---|---|
| `npx --no-install supabase db reset --no-seed` | Pass; both migrations applied to local Docker Supabase |
| `npx --no-install supabase db lint --schema public --fail-on warning` | Pass; zero schema errors/warnings |
| `npm test` | 51 passed; 0 failed, 0 skipped |
| `npm run test:concurrency` | 16 passed; 0 failed, 0 skipped |
| `npm run test:runtime` | 10 passed; 0 failed, 0 skipped |
| `npm run lint` | Pass |
| `npm run typecheck` | Pass |
| `npm run build` | Pass; authenticated `/review` included in production output |
| `git diff --check` | Pass |
| Local read-only `db query --file` for both verification scripts | Pass; both versions present, every violation count zero |

The unit/database suite applies both actual migrations in PGlite, and separately upgrades a database containing two owners' Slice 01 `analysis` records. It verifies byte-for-byte unchanged word rows, five dated obligations per owner, and repeated owner-scoped backfill. Other cases cover missed/late/Forgot separation, partial +7 recovery, reveal ordering, immutability, MVD alternatives, timezones, RLS, stale versions, completion gates, administrative cleanup and the completion-integrity regressions described above.

Native PostgreSQL tests use separate connections to exercise races in lifecycle/word saves, first recalls/remedial scheduling, review-save versus close, competing independent sentences and final-feedback versus session completion, including existing higher-isolation regressions. The isolated cluster is stopped and removed.

Runtime tests use the real local Supabase Auth/PostgREST stack, generated disposable learners and an isolated Next.js server at `localhost:3001`. They cover all three MVD paths, due-word backlog preservation, partially acknowledged multi-word completion rejection, active-time pause/reload, word persistence across sign-out/sign-in, independent Day +7 sentence recovery, extra practice preserving official results, regular-learning review gating, Cairo/Los Angeles calendar boundaries and HMR/prerender diagnostics. Learners and server are removed afterward. No hosted credentials are used by these tests.

The initial browser runs exposed an ambiguous restored textarea label and dependent-FK cleanup failure; both were fixed and the full suite passed afterward. The CLI's read-only `db query --file` prepares one statement, so deployment verification files use one combined SELECT. Local sandbox restrictions required approved CLI/browser/native-process execution; none remain blockers. Node emits pre-existing experimental type-stripping/module-format notices; checks pass.

The optional `npm run test:e2e` scenario that uses an explicitly configured learner was not run against hosted Supabase. Its signed-out route list now includes `/review`, and its dedicated-learner flow handles retained due reviews before new entry. The authenticated local runtime suite supplies the Slice 02 browser evidence.

## Exact file inventory

Created:

- `supabase/migrations/20261114000200_vertical_slice_02.sql`
- `supabase/verification/slice02_before.sql`
- `supabase/verification/slice02_after.sql`
- `src/app/review-actions.ts`
- `src/app/review/page.tsx`
- `src/app/review/loading.tsx`
- `src/lib/reviews.ts`
- `src/components/review-overview.tsx`
- `src/components/review-panel.tsx`
- `src/components/word-reviews.tsx`
- `tests/reviews.test.mjs`
- `docs/Vertical_Slice_02_Implementation_Report.md`
- `docs/Vertical_Slice_02_Acceptance.md`

Modified:

- `README.md`
- `src/app/actions.ts`
- `src/app/globals.css`
- `src/app/page.tsx`
- `src/app/session/page.tsx`
- `src/app/words/page.tsx`
- `src/components/session-editor.tsx`
- `src/components/session-history.tsx`
- `src/components/shell.tsx`
- `src/components/start-session.tsx`
- `src/lib/model.ts`
- `src/proxy.ts`
- `tests/helpers/database.mjs`
- `tests/concurrency/postgres.test.mjs`
- `tests/runtime/dashboard.test.mjs`
- `tests/e2e/slice.spec.ts`

No dependencies or approved requirements changed.

## Future hosted deployment — commands for the learner

These commands have **not** been executed remotely. Use the pinned CLI **3.1.0**; it defaults to local, so hosted commands explicitly include `--remote`. The currently linked hosted project must be checked before pushing. Authentication/password prompts stay private.

From `C:\Freelance\english-vocabulary-habit`, authenticate/link only if needed:

```powershell
npx --no-install supabase login
npx --no-install supabase link --project-ref YOUR_PROJECT_REF
```

Review current history and take a content-free evidence snapshot:

```powershell
npx --no-install supabase migration list --remote
npx --no-install supabase db query --remote --read-only --file supabase/verification/slice02_before.sql
npx --no-install supabase db push --remote --dry-run --skip-vault
```

Expected: Slice 01 version `20261114000100` is already applied; the **only** pending migration is `20261114000200_vertical_slice_02.sql`. Stop and investigate any mismatch. Keep the snapshot privately; it contains counts/digests, not sentence text. Avoid recording new activity between before/after snapshots so their comparison is meaningful.

Only after you review the dry run and choose to deploy:

```powershell
npx --no-install supabase db push --remote --skip-vault
```

Post-deployment verification:

```powershell
npx --no-install supabase migration list --remote
npx --no-install supabase db query --remote --read-only --file supabase/verification/slice02_before.sql
npx --no-install supabase db query --remote --read-only --file supabase/verification/slice02_after.sql
```

Both migration versions should be applied; every violation count in `slice02_after.sql` must be zero. Word, original-sentence and legacy-session digests/counts must match the pre-deployment snapshot. Then sign in to the app with the existing learner, confirm `analysis` and its original sentence, inspect all five review dates, and follow the acceptance checklist. Do not reset a hosted database, repair migration history, use `--include-all`, or replay Slice 01 to deploy this slice. `--skip-vault` avoids unrelated Vault updates.

## Limits and Slice 03

- AI feedback, production grading, hints/corrections, Day 0 quick recall and full regular-learning completion remain for **Slice 03**. Day +7 first sentences are stored pending evaluation.
- Progress charts/percentages, streak display, exports, Parking Lot, AWL scraping/seeding and adaptive scheduling remain outside Slice 02.
- Existing drafts resume regardless of which Start button is used. Close the existing draft unfinished to start a different session type. Closed history is read-only; the UI lists the latest 20 sessions.
- Browser timezone is the learner timezone; no timezone-profile setting was added. Session date/type remain fixed across midnight. Actual review dates use server time in the current browser timezone. For a new day's MVD, close yesterday's draft and start a new one; yesterday's recalls cannot earn today's completion. Partial official results remain immutable and can still be finished.
- Browser storage and cloud sync retain work, but this is not an offline-first app. Final mutations require a connection; an uncertain/stale response may require reload and an explicit local/cloud recovery choice. The timer conservatively excludes interruptions and may omit the latest heartbeat.
- Self-reported recall and the learner's assertion that feedback was checked remain self-reports. Original first attempts cannot be replaced, and rereading/extra practice cannot change official results.

Manual acceptance steps are in [Vertical_Slice_02_Acceptance.md](Vertical_Slice_02_Acceptance.md). No qualifying Next.js framework feedback candidate remained after verification; no feedback report was submitted.
