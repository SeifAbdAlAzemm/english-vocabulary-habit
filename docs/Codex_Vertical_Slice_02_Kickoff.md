# Codex Implementation Kickoff — Vertical Slice 02

> **Project:** English Vocabulary Habit  
> **Slice:** 02 — Spaced Review Engine + Minimum Viable Day (MVD)  
> **Status:** Implementation handoff; the approved routine and product scope are unchanged.  
> **Prerequisite:** Vertical Slice 01 is accepted. The first migration (`20261114000100_vertical_slice_01.sql`) is already deployed to hosted Supabase, and real learner sign-in, word save, reload, and sign-out/sign-in persistence have been manually verified.

## 1. Read these files before editing code

1. `docs/English_Vocabulary_Habit_Routine_v1.1_EN.md` — **approved source of truth** for learning, reviews, MVD, and metrics.
2. `docs/English_Vocabulary_Habit_App_MVP_Approved_v1.0.md` — **approved product scope, integrity rules, and stack**.
3. `docs/Codex_Vertical_Slice_01_Kickoff.md` — context for the accepted first slice.
4. `docs/Vertical_Slice_01_Setup.md`, `docs/Supabase_Migrations.md`, and `docs/Runtime_Development_Fixes.md` — implementation decisions and constraints. Some setup documents describe the historical pre-deployment state; the initial migration **has since been deployed** and hosted persistence manually verified.

Inspect the **current repository** before changing anything. Do not rewrite approved documents or duplicate existing modules.

## 2. Goal and end-to-end outcome

> As the learner, I can see which of my saved words are due, attempt recall before revealing the answer, record my first result honestly, have the next review scheduled appropriately, and complete a small but genuine MVD on a busy day. The results survive reload/sign-in and are correctly linked to my account.

Build a usable **Review + MVD** experience, not just database tables or placeholder UI. Preserve everything that works in Slice 01.

## 3. Scope A — Deterministic review scheduling

For **every saved/learned word**, create immutable milestone obligations relative to its stored `learn_date`:

| Checkpoint | Required task |
|---|---|
| Day +1 | Meaning recall |
| Day +3 | Meaning recall |
| Day +7 | Meaning recall **and a new independent sentence** |
| Day +14 | Meaning recall |
| Day +30 | Meaning recall |

Rules:

- `Due = obligation.due_date <= learner_local_today AND obligation not completed` (include pending remedial obligations).
- Show **overdue first**, then today's reviews. Keep original due dates; never silently reschedule missed milestones.
- A **missed** review is incomplete, not `Forgot`. A **late** review is one completed after its due date.
- On the first `Forgot` result, schedule a **remedial review for the next learner-local day after the actual attempt**. Preserve all main milestones. Avoid duplicate remedial obligations and duplicate completions.
- When remedial and milestone obligations for the **same word and same due date** coincide, one user-facing card may satisfy both, while the underlying obligation types/results remain distinguishable.
- Retried or repeated retrieval after feedback is **extra practice**, not a replacement for the first attempt or an official milestone.
- Do not introduce FSRS, SM-2, AI-driven intervals, predictive mastery, or automatic plan adjustments in this slice.
- **Backfill** milestone obligations for existing hosted words, including the already-saved `analysis` word, in an idempotent, owner-scoped manner; do not overwrite or duplicate any saved word, original sentence, or session history.

## 4. Scope B — Review page and first-attempt integrity

Implement the Review navigation destination and a complete recall-card flow:

1. Display due/overdue counts and a review queue; show scheduled checkpoint and overdue status without revealing the answer.
2. Initially show only the **target word** (and part of speech if necessary). Hide meaning, source example, and synonyms.
3. Require an explicit learner decision `Remembered` / `Forgot` **before** revealing the answer. Recall may be formulated in Arabic or English; do not require sophisticated wording for a correct meaning.
4. Persist the **first** recall result atomically, with word, obligation, checkpoint/kind, scheduled date, actual attempt date/time, and `was_late`.
5. Only after the first result is saved, reveal the primary meaning and source example for feedback; allow additional non-scoring practice.
6. At Day +7, capture a **new learner-authored sentence** with prior examples/notes hidden, before showing a model correction or revealing relevant notes. Preserve this first production attempt as immutable evidence. It may have `pending_evaluation` status; **do not invent a 0/1/2 score** before the AI Coach is implemented.
7. Handle partial Day +7 submissions explicitly: do not falsely mark all required tasks complete if the independent sentence is missing. Preserve work on interruption/reload.
8. Prevent duplicate submissions, retries changing first attempts, and user-to-user data access. Use existing Auth/RLS patterns.
9. Show an understandable session/review summary: attempts completed, `Remembered`/`Forgot`, due remaining, and remedial scheduling.

## 5. Scope C — Minimum Viable Day (MVD)

Implement a clearly labeled **Start MVD** path, with the same recoverable active-time stopwatch where appropriate. An MVD is a small **real practice activity**, not merely opening the application or a draft.

| Learner state | MVD definition of done |
|---|---|
| Due/overdue words exist | Test **two distinct due words**, or all due words if fewer than two; persist each first recall, then reveal/correct. |
| No words due, but older learned words exist | Test **two previously learned words** as Extra Practice, **or** test one old word plus write a new short independent sentence. |
| No previously learned words | Learn **one word**: primary meaning + one source example + a genuine personal sentence; record it as Day 0. |

- About **five minutes** is guidance, not an enforced timer.
- Persist session type `MVD`, active intervals/time, actual learning/retrieval evidence, and learner-local activity date.
- Finishing a qualifying MVD may count as **one active calendar day** for future Consistency/Streak calculation, without claiming the standard two-word learning goal or all due reviews were completed.
- Keep unfinished due obligations pending. Do not count empty sessions, app opens, or merely clicking Start.
- Sunday–Thursday remains the standard two-new-words plan. Friday–Saturday remains review-only by default; do not silently change the approved plan.

## 6. Scope D — Integrate with existing sessions and words

- Wire due-word review into the existing learning-session journey **before new-word entry**.
- Review-only and MVD sessions must be usable and leave a traceable history.
- Existing session states include `draft` and `closed_incomplete`; `completed` was deliberately blocked until evidence-based completion rules exist. Introduce any new states/transition policies **only where they can be proven by stored evidence** for review-only or qualifying MVD sessions. Do **not** mark a full learning session completed before its approved feedback and Day 0 quick-recall requirements are implemented in a later slice.
- Preserve one active draft per learner, multiple historical sessions, paused-time exclusion, session recovery, optimistic concurrency, selected word limits, RLS, and immutable first sentences.
- Existing `analysis` and all other words must remain readable after this migration.
- Provide a useful link/summary from the Dashboard to today's due reviews. Avoid showing invented Retention/Production percentages.

## 7. Database migration and security

The initial migration is **already deployed**. Treat it as immutable.

- Create a **new timestamped** SQL migration in `supabase/migrations/`; do not edit or rename `20261114000100_vertical_slice_01.sql`.
- Add only the schema, indexes, functions, constraints, grants, and RLS needed for this slice (review obligations/attempts, Day +7 first sentence, MVD/activity evidence, and lifecycle support).
- Ensure ownership isolation under authenticated users, no anonymous access, first-attempt immutability, idempotent obligation creation, and safe concurrency.
- Backfill obligations for existing words safely and idempotently.
- Use Supabase CLI migration-as-code, validate locally with Docker, and keep credentials in ignored environment files.
- **Do not run a remote migration push or otherwise modify hosted Supabase.** Supply the exact review/dry-run/deploy commands for the learner to run later.

## 8. Tests and acceptance criteria

Add focused automated checks and, where practical, real local Supabase browser tests. At minimum verify:

1. Saving a word schedules precisely +1/+3/+7/+14/+30; existing word backfill is idempotent.
2. Correct behavior across learner-local midnight/weekday/timezone boundaries, including Sunday–Thursday vs Friday–Saturday.
3. Due, overdue, missed, late, and first-attempt statuses are distinct.
4. Marking `Forgot` schedules next-day remedial review without moving milestones or double-counting.
5. Recall card hides answers until the **first** result is persisted; repeats do not overwrite it.
6. Day +7 requires and preserves an independent sentence, with evaluation pending rather than fabricated.
7. MVD qualifies only after genuine activities and respects all three approved cases.
8. Session activity records are traceable without false completion, streak, or mastery awards.
9. Concurrent or repeated requests cannot create duplicate obligations, duplicate results, or cross-account access.
10. Slice 01 sign-in, dashboard, stopwatch, recovery, save word, My Words, and immutable original sentences still work.

Run (or accurately report environmental blockers):

```powershell
npx --no-install supabase db reset --no-seed
npx --no-install supabase db lint --schema public --fail-on warning
npm test
npm run test:concurrency
npm run test:runtime
npm run lint
npm run typecheck
npm run build
```

Use only commands/scripts that exist in the repository; adapt and document additional tests without silently skipping required verification.

## 9. Deliberately out of scope

- AI Feedback Coach, initial production grading, corrected-sentence generation, advanced vocabulary suggestions.
- Full Day 0 learning wizard completion when feedback/quick recall has not yet been built.
- My Progress charts, 14-day pilot decision/recommendation, exports to Excel/PDF.
- Parking Lot (unless an existing shortcut is retained as coming soon).
- Python/FastAPI, autonomous agents, OCR, voice pronunciation scoring, full AWL scraping/seeding, and new learning/business rules.

## 10. Delivery report

Return:

1. Functional summary and screenshots or clear navigation path for Review and MVD.
2. Exact files modified/created.
3. New migration filename, schema changes, and existing-word backfill strategy.
4. Test commands, pass/fail/skip counts, and remaining limits.
5. Manual acceptance steps against **local** Supabase, including the existing `analysis` word.
6. Explicit confirmation that **no hosted deployment occurred**.
7. Exact CLI commands for **remote migration list → dry run → user-approved push → post-deploy verification**.
8. Anything that must remain for **Vertical Slice 03 — AI Feedback Coach + completion of the regular learning journey**.

**Start implementing Vertical Slice 02 now, but do not deploy it to hosted Supabase.**
