# Vertical Slice 02 — local manual acceptance

Use disposable **local** Supabase learners. Do not copy hosted learner records or run a remote reset. The deployed Slice 01 migration and approved documents are unchanged.

## Local setup

Start Docker Desktop, then run from the repository root:

```powershell
npx --no-install supabase start
npx --no-install supabase db reset --no-seed
npx --no-install supabase db lint --schema public --fail-on warning
```

Reset deletes disposable local records. For a local browser session without changing the hosted `.env.local`, use a fresh PowerShell terminal:

```powershell
$slice02Local = npx --no-install supabase status -o json | ConvertFrom-Json
$env:NEXT_PUBLIC_SUPABASE_URL = $slice02Local.API_URL
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = $slice02Local.ANON_KEY
npm run dev
```

Keep status keys private. Open `http://localhost:3000` consistently. In local Studio (`http://127.0.0.1:54323`), create/confirm a disposable Email/password learner. Do not reuse a dev server that was started with hosted environment variables. Closing this terminal discards its environment overrides.

## Existing records and scheduling

- [ ] Run `npm test`. Confirm the staged **migration backfills pre-existing Slice 01 words** test passes: it creates `analysis` for two owners before applying Slice 02, checks unchanged complete word rows and exact original sentences, and calls owner-scoped backfill twice without duplicates.
- [ ] With a dedicated local learner, save an `analysis` word with a genuine test sentence, meaning and source example. Use a learning session and the exceptional-learning option on Friday/Saturday. Set its learning date seven days before the local date to create a review fixture; do this only in the disposable account.
- [ ] In My Words, record its original sentence and learning date. Expand **Review schedule & immutable first attempts**: there must be exactly +1/+3/+7/+14/+30, with no invented results or scores.
- [ ] Reload and sign out/sign in. The word, sentence and dates remain unchanged. Close its learning draft unfinished to start an independent review/MVD session.

## Review and Day +7

- [ ] Open **Review**. Check distinct due words, card count and overdue count. Earlier scheduled dates appear first; unanswered tests show incomplete, not Forgot.
- [ ] Click **Start review session**. Confirm the card reveals no meaning, example, original sentence, context, synonyms or source notes before an attempt.
- [ ] Recall in Arabic or English; click **Forgot**. The first result must save before **Reveal saved answer** appears. Reload once before reveal; the saved result must still be Forgot.
- [ ] After saving recall, the card remains in the due count and My Words says its answer check is pending. Revealing without acknowledgment must still leave it due. Only checking/correcting and acknowledging may complete it; the original recall result/date stays unchanged.
- [ ] Reveal the saved meaning/example, correct mistakes and acknowledge the answer check. Inspect My Words: the original scheduled date remains, actual date/late status is factual, and one remedial review is scheduled for tomorrow. Main milestones stay unchanged.
- [ ] Finish earlier checkpoints until Day +7 appears. Remembered/Forgot buttons must remain disabled with an empty independent-sentence field.
- [ ] Type a new sentence, reload and recover it. Save the first result and sentence, then reveal. The exact sentence must remain in history with **pending evaluation**, without a 0/1/2 score.
- [ ] Day +7 stays due after its first sentence is saved and after reveal alone. It completes only after feedback acknowledgment. Coinciding remedial/milestone obligations share that same completion gate.
- [ ] After checking all due cards, choose **Do additional Extra Practice** and try again. The official recall and production must remain unchanged; the repeat appears separately.
- [ ] Finish the review-only session after its due reviews and answer checks are complete. Confirm completed practice and actual active time in Session history. An empty review session cannot finish.
- [ ] Run the multi-word regressions in `npm test` and `npm run test:runtime`: three saved recalls with only one acknowledged answer leave two cards due, exclude those two from milestone metric eligibility, and reject session completion. Reveal alone does not change that result; completing each remaining answer check enables finishing without replacing first attempts.

## All MVD paths

- [ ] **First day, separate empty learner:** Start MVD; Finish MVD is disabled. Enter one word's meaning, source example and own sentence. After saving, return to Session and finish MVD. One word, five milestones and one completed MVD are stored; no claim of a two-word day appears. This path also works on Friday/Saturday.
- [ ] **No due words, previously saved words:** With words learned today (reviews begin tomorrow), Start MVD. One recall with no new sentence cannot finish. Either test two different saved words or provide a new independent short sentence with one word **before reveal**. Two tests of the same word without a sentence do not qualify. Finish; results are Extra Practice and no milestone is completed.
- [ ] **Due words:** With at least three words learned seven days ago, Start MVD. Test and check two distinct target words. Finish MVD becomes available; other obligations stay due. With only one distinct due word, testing/checking that word is enough. Two cards for the same word must not substitute for two different words.
- [ ] All attempts actually started in an MVD must have their answers checked before finishing, even if the distinct-word minimum is already met. Unattempted obligations may remain due. The database regressions cover partially acknowledged due and extra-practice MVDs.
- [ ] Clicking Start, opening a page or saving an empty draft never enables completion. Plan remains two new words Sunday–Thursday; Friday/Saturday defaults to review-only. Five minutes is guidance, not a countdown.

## Session, concurrency and security regressions

- [ ] Pause the stopwatch, wait and confirm it does not advance. Resume and verify it advances. Reload/return from another tab: recovery is paused and interruption time is excluded.
- [ ] Start regular learning with reviews due. New-word entry stays hidden until recall, any required Day +7 production, and answer checks are saved. After clearing reviews, manual word entry works; the full learning session still cannot be marked completed.
- [ ] Choose three words in a regular learning session; the official plan stays two. Previously saved word limits, original sentences, closing unfinished and history remain intact.
- [ ] Open the same draft in two tabs: only one editor owns the Web Lock. On separate devices/stale snapshots, conflicting saves show a recovery error without replacing evidence. Run `npm run test:concurrency` for actual simultaneous database requests.
- [ ] Sign in as a second local learner: no first learner's words, obligations, attempts, production or history should appear. Sign out and visit `/review`, `/words` and `/session`: sign-in is required.
- [ ] Test a learner-local date boundary with browser timezone settings. New-day due status refreshes; weekend plan changes remain local. Yesterday's session keeps its original date; close it unfinished and start a new day's MVD rather than awarding yesterday's recall again.
- [ ] Run `npm run test:runtime` for isolated real Auth/browser verification of the three MVD paths, Day +7, persisted sentences, review-first learning and calendar boundaries. It removes temporary learners and its server afterward.

## Release gate

- [ ] `npm test`, `npm run test:concurrency`, `npm run test:runtime`, `npm run lint`, `npm run typecheck`, and `npm run build` pass.
- [ ] Local database lint has no warnings. `git diff --check` passes.
- [ ] Review the new migration and implementation report. Approved documents and Slice 01 migration have no diff.
- [ ] Follow the **future hosted deployment** commands in [the implementation report](Vertical_Slice_02_Implementation_Report.md) only when you choose to deploy. The agent has not deployed or committed these changes.
