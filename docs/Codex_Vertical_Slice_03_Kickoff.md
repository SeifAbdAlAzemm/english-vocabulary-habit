# Codex Implementation Kickoff — Vertical Slice 03

**Project:** English Vocabulary Habit  
**Slice:** 03 — AI Feedback Coach + Complete Regular Learning Wizard  
**Status:** Implementation handoff; **not** permission for hosted deployment  
**Baseline:** Vertical Slices 01 and 02 have been accepted, deployed to Hosted Supabase, and committed. Slice 02's MVD completion persisted after refresh, sign-out and sign-in on 15 November 2026.

## 1. Source of truth and preparation

Read, in this order, from the existing repository:

1. `docs/English_Vocabulary_Habit_Routine_v1.1_EN.md` — approved learning routine.
2. `docs/English_Vocabulary_Habit_App_MVP_Approved_v1.0.md` — approved product and technical requirements.
3. `docs/Vertical_Slice_02_Implementation_Report.md` — current implementation, integrity rules, and limitations.
4. `docs/Vertical_Slice_02_Acceptance.md` — previously accepted review/MVD behavior.
5. Inspect the **current code and deployed migration history**; do not infer a database schema from this brief alone.

The approved requirements take precedence over this handoff if a discrepancy is found. Report discrepancies; do not silently change the learning routine.

Before implementation, inspect the current session/review lifecycle, original sentences, Day +7 production records, RLS, app routing, and tests. Avoid speculative rewrites.

## 2. Goal and demonstrable end-to-end output

Enable the learner to complete a **regular daily learning session**, from due reviews through two new AWL words, learner-authored sentences, AI feedback and self-correction, Day 0 quick recall, and a truthful completed session with preserved evidence.

**Acceptance journey:** Sign in → Start Your Routine Today → resolve due/overdue reviews → select 1–3 new words (default 2; plan stays 2) → learn word and write an independent original sentence with notes hidden → receive AI initial assessment and at most two hints → write a second attempt (or explicitly choose `I can't correct it`) → see a corrected natural version and short explanation → repeat for the batch → optional connected paragraph → Day 0 quick recall → finish → reopen My Words / Session History after reload and sign-in to verify all first/second/corrected versions, scores, dates, and true active time.

An important existing real record is the word `analysis`, learned 2026-11-14. Preserve it, its exact first sentence, its completed +1 review, and all review/MVD history.

## 3. Scope A — Focused AI Feedback Coach

Implement a **single focused, secured server-side LLM call/workflow** in Next.js (the approved technical direction). Do **not** introduce Python/FastAPI or multi-agent orchestration. Make the model/provider configuration explicit, minimal, and replaceable without exposing provider secrets. Never put an LLM API key into `NEXT_PUBLIC_*`, client bundles, logs, Git, or test fixtures.

For each Day 0 first sentence:

1. Use the stored **target word + immutable learner first attempt**. The user's meaning/part of speech and source example may be supplied as limited, helpful context; keep personal content minimal.
2. Evaluate **the first attempt**, not a later revision, using the approved **0/1/2 Production rubric**:
   - `0` = target word missing or meaning/usage inappropriate.
   - `1` = understandable but meaningful usage/collocation correction needed.
   - `2` = appropriate meaning and natural structure; no reward for unnecessary sophistication.
3. Store a short **reason** and **no more than two actionable hints** about grammar, collocation, or naturalness. **Do not reveal a complete corrected sentence at this stage.**
4. Ask for a **Second Attempt**, or an explicit `I can't correct it` action. Keep the revised text or explicit skipped state separate and traceable.
5. **Only after Step 4**, reveal a corrected natural version and concise explanation. An advanced alternative is optional only when genuinely useful; don't push complexity for its own sake.
6. Preserve fields/evidence separately: `first_attempt`, `initial_score`, `score_reason`, `hints`, `second_attempt` or skipped status, `corrected_version`, `explanation`, `feedback_state`. Lock the first assessment once committed; no repeated call/retry may silently rescore it.

Use structured, schema-validated provider output, tight timeouts/error handling, and defensive handling of malformed responses. Enforce phase order **on the server/database**, not just by hiding UI elements. Treat LLM output as untrusted text; never treat returned instructions as application commands. Prevent unnecessary duplicate external calls where a committed outcome already exists. Explain usage/cost implications without displaying fabricated token/cost numbers.

**Failure rule:** If provider configuration is absent, the API fails, or output cannot be validated, preserve the learner's existing work and mark feedback as pending/failed retryable; do not fabricate hints, scores, or corrections. Do not award full routine completion for missing required stages. Provide an understandable recovery flow rather than losing the draft.

## 4. Scope B — Day +7 production evaluation integration

Slice 02 already stores an immutable **new independent sentence** for Day +7, with `pending_evaluation`. Add the same approved 0/1/2 scoring rubric for this first sentence **without rewriting it**, modifying first recall, shifting review dates, or creating another review attempt. Associate the evaluation with the existing Day +7 production record and preserve original scheduled/actual/feedback timing.

- Score and reason apply to the **original independent Day +7 sentence** only.
- If hints and self-correction are presented for Day +7, keep first/second/corrected evidence and the same reveal-after-second-attempt order. Do not block the already valid recall/answer-check review completion simply because asynchronous AI evaluation remains pending; clearly distinguish **review completion** from **production evaluation completed**.
- Enable safe, idempotent **on-demand evaluation of already-saved pending Day +7 sentences**, including historical records. Never invent retrospective scores or backdate a correction.
- Separate Day 0 initial production scores from Day +7 official Production Accuracy inputs. The My Progress denominator and dashboard remain for Slice 04; do not fabricate aggregate metrics here.

## 5. Scope C — Finish the regular learning wizard

Extend the existing Session UI and persistence, preserving its current recoverable draft, pause/resume time, local date, optimistic concurrency, user ownership, and selected-word limits.

1. **Review first:** Respect Slice 02's completed recall → reveal → acknowledgment gates for all due/overdue reviews before new-word entry. Preserve MVD and review-only sessions exactly as accepted.
2. **Plan vs actual:** Sunday–Thursday = default 2 new words; Friday–Saturday review-only by default with explicit exceptional learning. Learner may choose **1–3** actual words for a particular learning session without changing the pilot plan or claiming the two-word goal was met if not.
3. **Word steps:** Preserve manual AWL link/source, meaning, part of speech, listen/speak prompt, one source example, optional single useful family and synonym, and original personal sentence written with meaning/example hidden. Never claim the AWL order was auto-validated unless genuine licensed order data exists.
4. **Feedback for each saved word:** Add ordered AI-score/hints → second attempt or explicit cannot-correct → corrected version. The first attempt from Slice 01 remains byte-for-byte unchanged.
5. **Optional connected paragraph:** Available after the word batch, not a completion requirement and not part of the official Production Accuracy metric.
6. **Day 0 quick recall:** Hide the new words' meanings, test immediate meaning recall for each newly learned word, and persist the first immediate result and feedback check. Treat these as **Day 0 practice, not +1/+7 delayed Retention**. Don't duplicate scheduled review obligations, and don't mutate official first milestone attempts.
7. **Truthful session completion:** A regular learning session can become `completed` only when its stored review/word/feedback/quick-recall evidence satisfies the approved flow. Enforce this in the database with owner-scoped, concurrency-safe checks; client-controlled flags must not bypass it. Finish summary shows planned and actual new words, reviews checked, active minutes (pauses excluded), incomplete/pending work, and upcoming review dates.

Avoid altering `closed_incomplete` historical sessions to `completed`; they are read-only. If supporting feedback for already saved `analysis`, make it an explicitly user-initiated follow-up using existing evidence, **not** a retroactive change to the old learning session or activity date.

## 6. Data integrity, privacy, and versioned migrations

- **Both** `20261114000100_vertical_slice_01.sql` and `20261114000200_vertical_slice_02.sql` are already deployed; keep them **unchanged**. Create a **new Slice 03 migration** under `supabase/migrations/` for tables, fields, RLS, constraints, RPCs and completion gates required by this slice.
- Existing words, their original first sentences, scheduled and completed reviews, first recall results, Day +7 first sentences, feedback acknowledgment, and completed MVD sessions must remain unchanged by the migration.
- New evidence is owner-scoped under Supabase Auth/RLS. Anonymous and cross-account read/write are denied. Guard original and initial-score immutability, retry idempotency, partial recovery, and concurrent writes at the database boundary.
- Store only required AI assessment and feedback fields. Avoid unnecessary sensitive data in prompts/logs. Do not accidentally leak provider responses before the allowed phase.
- Do **not** deploy to Hosted Supabase, modify hosted project settings, reset the remote DB, commit or push Git changes automatically.
- Validate migrations against local Docker Supabase; strict `db lint` and tests before presenting remote deployment commands. Use the project's pinned CLI and version-controlled SQL workflow.

## 7. Tests and acceptance criteria

Add focused tests, and real authenticated **local** browser tests where practical. At a minimum, verify:

1. Day 0 0/1/2 scoring rubric and stable reason; hints count ≤2; complete correction withheld until second attempt or explicit skip.
2. Immutable original sentence **and immutable initial grade** even across retry, reload, second attempt, and extra practice.
3. Provider missing/error/timeout/malformed output → pending/retryable state with original work intact; no invented scores or premature session completion.
4. Day +7 pending-to-evaluated path for both newly entered and pre-existing pending sentence records, with no changes to official recall, dates, or review completion.
5. Regular learning session with reviews due cannot skip review gates; session cannot finish until required stored feedback and Day 0 quick recall are complete.
6. Choose 1 or 3 actual words while keeping the official 2/day plan; optional paragraph absence must not prevent completion.
7. Day 0 quick recall is stored distinctly from +1/+7 official retention; no fake mastery/streak/percentage.
8. One active draft and closed-session immutability; stopwatch excludes paused/recovery time; sign-out/reload restores persisted evidence.
9. Cross-user and anonymous access blocked; malicious client/provider response cannot bypass sequence; multiple concurrent submissions cannot double-grade or overwrite evidence.
10. Slice 01/02 regressions: existing `analysis`, review scheduling, checked-answer completion, Forgot/remedial, Day +7 sentence first attempt, all three MVD paths, review-only completion, timezone/midnight boundaries, local Auth runtime.

Run and accurately report:

```powershell
npx --no-install supabase db reset --no-seed
npx --no-install supabase db lint --schema public --fail-on warning
npm test
npm run test:concurrency
npm run test:runtime
npm run lint
npm run typecheck
npm run build
git diff --check
```

Use available repository scripts; if dependencies or provider credentials are missing, report blockers precisely and use deterministic **mock AI provider responses** in tests rather than requiring real, billable network calls. Real provider testing, if configured, must be opt-in and separately reported.

## 8. Out of scope

- My Progress metrics UI, streak charts, 14-day evaluation/plan advancement and PDF export (Slice 04/05).
- Excel export, Parking Lot, full My Words search, polish beyond necessary feedback usability (Slice 05).
- Python/FastAPI, agent orchestration, OCR, voice pronunciation scoring, automatic AWL scraping or corpus ingestion.
- Adaptive review scheduling, altering +1/+3/+7/+14/+30, changing the 2/day learning plan, backdating study dates, auto-generated first sentences.

## 9. Deliverables

Return a concise but complete implementation report with:

1. UI workflow and exactly which requirements are implemented.
2. Files added/modified and new migration filename.
3. AI provider contract, environment variable **names only**, timeout/error/retry and cost-awareness behavior; **never** reveal secrets.
4. Data model and immutable evidence / phase ordering / session completion details.
5. Test commands and actual pass/fail/skip counts, explicit remaining limits.
6. Local manual acceptance checklist (normal 2-word session; historical `analysis`; already-pending Day +7; AI unavailable).
7. Safe hosted migration plan: `migration list --remote` → **read-only pre-deploy snapshot** → `db push --remote --dry-run --skip-vault` → **user-performed** `db push --remote --skip-vault` → remote migration and evidence verification, with read-only-compatible SQL that does not require private app-only functions.
8. Explicit confirmation: **no hosted deployment and no Git commit** were performed.

**Begin implementing Vertical Slice 03 in the existing project after reading the approved documents and inspecting the current code.**
