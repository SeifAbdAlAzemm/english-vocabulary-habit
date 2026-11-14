# English Vocabulary Habit — App Requirements & MVP Scope (Approved v1.0)

> **Status:** APPROVED for implementation (14 November 2026)  
> **Learning source of truth:** `English_Vocabulary_Habit_Routine_v1.1_EN.md` (approved)  
> **Product objective:** Make daily vocabulary learning easy to perform, measurable, and traceable without adding unnecessary administrative work.  
> **Pilot:** 14 calendar days, Sunday–Thursday new-word learning, Friday–Saturday review-only; two new words per learning day (10/week, 20/14 days).

## 1. Product Principles

1. **Habit and learning are different outcomes.** An active day requires actual learning/retrieval activity; opening the app does not count.
2. **Coverage is not mastery.** Track words studied separately from verified delayed recall and independent usage.
3. **First attempts are immutable evidence.** Preserve the user's original sentence and first recall/production results before AI feedback.
4. **Reviews happen when due.** Review dates depend on each word's learning date, not on which weekday is designated a review day.
5. **User remains the learner.** AI provides hints before a correction, never writes the first sentence for the user.
6. **Optimize for daily use.** A Minimum Viable Day (MVD) must be available when the full session is not feasible.
7. **No silent plan upgrades.** At the end of the pilot, the app can recommend 15 words/week; the user confirms any plan change.

## 2. MVP Information Architecture

| Location | Main job | MVP features |
|---|---|---|
| **Dashboard / Home** | Explain the habit and start today's work | App introduction; Habit Goal vs Learning Goal; concise Daily Learning Session and MVD descriptions; current plan and today's targets; due-review count; today's status; **Start Your Routine Today**; **My Words** shortcut; **Parking Lot** shortcut |
| **Daily Routine Wizard** | Guide a real study session | Active-time stopwatch with pause/resume; due-word review first; selectable new-word count (default **2**); repeatable word-entry steps; original-sentence feedback and self-correction; optional paragraph; quick recall; save/finish session |
| **Review** | Perform scheduled and optional retrieval | Due and overdue word queue; first-attempt recall; reveal answer only after attempt; +7 fresh sentence and scoring; remedial reviews; overdue indicators; daily completion summary |
| **My Words** | View what was actually learned | Searchable chronological word list; word detail with meaning/part of speech, recorded example, useful context, optional family/synonym, original sentence, self-correction, corrected sentence, learning date, review history; **Export Excel** |
| **My Progress** | See results without misleading metrics | Streak and active-day calendar; daily/weekly activity; Retention (+1/+7), Production (+7), Time, Consistency, Review Completion; coverage and eligible test counts; 14-day pilot evaluation; **Export PDF** |
| **Parking Lot** | Capture interesting side words without distraction | Quick add (word/note/source, optional); list/edit/mark reviewed; items never count as learned words unless deliberately entered through a real learning session |

**Navigation proposal:** Four main tabs (Home, Review, My Words, My Progress). The Wizard is launched from Home. Parking Lot opens from a persistent shortcut or side panel, not necessarily a full tab.

## 3. Daily Routine Wizard — Required Flow

### 3.1 Start / Timer

1. Click **Start Your Routine Today**; create a draft session and start an **active study stopwatch**.
2. Show reviews due today and overdue. The user performs them **before** new-word learning in the regular learning flow.
3. Show **Planned: 2 new words**. User chooses the actual count for this session (e.g., 1, 2, or 3). The app records **planned vs actual**, and does not silently change the 14-day goal or weekly plan.
4. Allow **Pause / Resume**, and finish with an accurate sum of active intervals, excluding pauses. Preserve a draft if the page reloads; on recovery, let the user exclude interruption time.
5. On Friday/Saturday, default to **Review Session**; do not prompt for planned new words unless the user explicitly chooses an exceptional session.

### 3.2 Word Card (repeat for each chosen word)

**Core steps** (in order):

- **Target word:** Show/enter the next word in AWL Sublist order. Save word, sublist/order if available, and learning date. Start afresh with `analysis`, `approach`; there is **no imported baseline**.
- **Meaning & Part of Speech:** Capture the primary meaning and grammatical category.
- **Pronunciation:** Provide a link/play action to a reliable source where supported; ask the learner to listen, say it aloud, and try without audio. Do not claim to assess speech automatically.
- **One Source Example:** Read and optionally paste/save one original AWL example; keep its source attribution/link. Notice a useful collocation/context.
- **Useful Word Family (optional):** At most one useful related form during the core flow; skippable.
- **One Synonym (optional):** At most one plus a short usage difference; skippable.
- **Independent Original Sentence (required):** User writes one personal sentence with the definition and example hidden. Store untouched as **First Attempt**.
- **AI Feedback / Self-Correction:** Follow Section 4; never substitute the AI output for the original attempt.

**Source ordering constraint:** The app should support AWL sublist ordering; if the full ordered list is not yet seeded/licensed/validated, use manual entry with a visible source link and do not falsely claim automatic order validation.

### 3.3 End of Word Batch

1. **Optional Connected Paragraph:** Offer to link the day's words in one short paragraph, especially if three were learned. **Optional, never a condition for completing the day**. The existing weekly 3–5-word paragraph remains optional.
2. **Quick Recall:** Hide definitions and ask for meanings of today's new words. Record results as Day 0 immediate practice; **exclude from delayed Retention**.
3. **Session Summary:** Display new words, reviews done, actual active minutes, pending corrections and upcoming reviews. Finish and persist the session.

## 4. AI Feedback Coach (MVP)

A **focused AI Coach**, not an autonomous multi-agent system. It operates on a target word and user's first attempt.

1. User submits **Target Word + First Attempt**.
2. AI assesses target-word usage and stores an initial **Production Score 0/1/2** plus a short reason (same rubric throughout the pilot). The first-attempt record and score cannot be rewritten after feedback.
3. AI gives **no more than two hints** about important grammar, collocation or naturalness issues. **No corrected sentence yet**.
4. User writes a **Second Attempt**, or explicitly chooses **I can't correct it**. Preserve the attempt or skipped status.
5. Only then reveal a **Corrected Natural Version** with a brief explanation and an optional advanced alternative *only when appropriate*.
6. The app stores `first_attempt`, `initial_score`, `score_reason`, `hints`, `second_attempt`, `corrected_version`, and `explanation` separately.

**Guardrails:** Do not reward sophisticated vocabulary for its own sake; preserve intended meaning. If the AI service fails, preserve the draft and mark feedback as pending — do not invent a score. Keep API credentials server-side; avoid sending sensitive personal/work details unnecessarily.

## 5. Review Engine — Mandatory, Deterministic MVP

For every newly learned word, generate main reviews relative to **the word's Learn Date**:

| Checkpoint | Activity |
|---|---|
| Day +1 | Meaning recall |
| Day +3 | Meaning recall |
| Day +7 | Meaning recall **plus new, independent sentence**, scored 0/1/2 |
| Day +14 | Meaning recall |
| Day +30 | Meaning recall |

**Due rule:** `scheduled_review.due_date <= today AND scheduled_review.completed_at IS NULL` (plus pending remedial reviews).

- Display **overdue first**, then today's due reviews. Scheduled day remains unchanged if done late.
- Show the **word only** initially. User attempts meaning retrieval (Arabic or English is acceptable), records **Remembered / Forgot**, **then** reveals answer and correction.
- On +7, user writes an entirely **new** sentence before AI hints/correction; preserve the **first** independent version as the official production assessment.
- On a `Forgot` attempt, schedule a **remedial review tomorrow**. If another obligation lands on the same date, one combined card can satisfy both, but preserve separate obligation types in records.
- A repeat attempt after feedback is **Extra Practice**. It cannot alter the first-attempt score.
- A **Missed** review is an incomplete obligation, not an incorrect recall. A **Late** review is a completed one with an actual date after the scheduled date.
- Main milestones remain unchanged throughout the pilot. No hidden spaced-repetition algorithm or automatic review reshuffling.

## 6. Minimum Viable Day (MVD)

A separate **Start MVD** option, clearly marked as a light day. Completing the applicable path makes the date an active day without claiming full-plan completion.

| Situation | Definition of Done |
|---|---|
| At least 2 due/overdue words | Recall-test **2 different due words** (or all if only 1 due), record results, reveal/correct, log session |
| No words due, previously learned words exist | Recall-test **2 old words**, **or** test 1 old word and write a new short sentence; log as Extra Practice |
| No words learned yet | Learn **1 word**: meaning + source example + attempt at a personal sentence; log as Day 0 |

**~5 minutes is a guideline, not a hard timer.** MVD does not require synonyms, word families, two new words, or clearing all due reviews. Unfinished due tests stay due.

## 7. Measurement Contract — Exact MVP Formulas

| Metric | Calculation / rules |
|---|---|
| **Retention (+1, +7 separately)** | `correct first recalls / completed eligible milestone recall tests × 100`; show `completed/due`, late count, and sample size; exclude remedial and extra practice |
| **Production Accuracy (+7)** | `Day+7 first-attempt sentences rated 2 / completed Day+7 production tests × 100`; use 0/1/2 rubric; separately record Day 0 production scores |
| **Time** | `sum(active study minutes) / number of completed sessions`; display learning and review-only averages separately; do not include paused time |
| **Consistency** | `distinct active dates / 14 × 100` for the pilot; includes completed MVD; opening the app alone does not count |
| **Review Completion** | `completed scheduled milestone obligations / all scheduled milestone obligations due by report date × 100`; count each obligation once; show late and outstanding separately; exclude remedial/extra |
| **Coverage** | Count new words genuinely learned in sessions; separate from number with demonstrated +7 recall/usage |
| **Streak** | Consecutive local calendar dates with a genuine recorded activity (learning, official review, MVD, or eligible extra retrieval). Only one increment per calendar day |

**No denominator?** Display **Not enough data / N/A**, never automatically zero or 100%.

### 14-Day Pilot Report

Show: 20-word target vs actual, Day+1 recall, eligible Day+7 recall, Day+7 production, review completion, consistency (target **>=12/14 days**), average learning/review minutes, late reviews, and evidence/sample sizes.

**Pilot decision guidelines (not scientific universal thresholds):** Day+7 Recall **>=80%**, Day+7 Production **>=70%**, Review Completion **>=80%**, Consistency **>=12/14**, and time subjectively manageable. Treat results with small/late samples cautiously. Only eligible +7 assessments count; recent words without a +7 review must not be marked failures.

The app may display **"Suggested next plan: 3 new words per learning day (15/week)"** when the evidence supports it. The user explicitly chooses **Adopt**, **Stay at 2**, or **Review Results**. Never auto-change. Subsequent Day+14/+30 milestones continue regardless of the pilot recommendation.

## 8. Exports (MVP)

### My Words → Excel (.xlsx)

Include a clean **Words** worksheet with word, learning date, source/sublist, meaning, part of speech, source example, context/collocation, optional family/synonym, original sentence, second attempt, corrected sentence, initial production score, and current review summary. Optional second **Review History** worksheet makes progress traceable. Dates should be real dates; use a stable header row; no false 'mastered' badge.

### My Progress → PDF (.pdf)

Include 14-day date range, target vs actual words, active-days calendar/streak, the five agreed metrics and denominators, learning/review time, review backlog, eligible results and a cautious next-plan recommendation. Export only the data actually available; state N/A when insufficient.

## 9. Minimal Data Model (Implementation-Oriented)

- `Plan`: pilot start date, planned new words/day (2), learning weekdays, review weekdays, current phase and plan-change history.
- `Word`: target text, normalized key, AWL sublist/order, learning date, meaning, part of speech, example and attribution, context/collocation, optional family/synonym.
- `SentenceAttempt`: word ID, purpose (`day0` or `day7`), first sentence, immutable first score/reason, hints, second attempt, final correction/explanation, feedback state.
- `ReviewObligation`: word ID, kind (`milestone` / `remedial`), checkpoint, due date, completion state.
- `ReviewAttempt`: obligation or extra-practice context, date/time, first recall result, was late, production attempt reference if day+7.
- `StudySession`: date, type (`learning` / `review` / `MVD`), start/end, active seconds from pause/resume intervals, actual new word count, completion/draft status.
- `ParkingLotItem`: captured text, note, source, created date, status.

A single-user database is sufficient for the first MVP. Protect against duplicate words, accidental double-submission of review results, and losing unfinished sessions.

## 10. MVP Acceptance Criteria — End-to-End

1. I can launch the app and understand my two goals, daily flow, current word plan, due count and today's next action.
2. Starting a learning session begins a recoverable stopwatch; pausing excludes time from Time metrics.
3. I can select **3 words today** while the plan remains **2/day**, and actual-versus-planned results are transparent.
4. I can enter new AWL words, write independent sentences, receive at most two hints before corrections, and reopen first/second/final versions separately.
5. The system automatically schedules +1/+3/+7/+14/+30 reviews and surfaces all due/overdue words, including remedial tests.
6. Recall first attempts and delayed +7 production scores cannot be retroactively changed by repeated practice or AI correction.
7. Finishing a qualifying MVD marks an active day without marking all planned new words/reviews as complete.
8. I can find any learned word, its original work, feedback, and review history.
9. My Progress displays all five metrics with correct denominators and shows no fabricated score for missing data.
10. After 14 days, I can see a cautious evaluation and choose whether to adopt 3 new words per learning day.
11. I can export learned words to Excel and a progress summary to PDF.
12. Closing/reloading the app does not lose recorded learning, reviews, or draft session state.

## 11. Deliberately Out of Scope for MVP

- Voice pronunciation scoring, speech-to-text or speech recognition.
- Autonomous AI selecting/reordering words or changing review checkpoints.
- Full built-in AWL dictionary, automated web scraping, or automatic definition/example enrichment (unless a verified licensed/local source is available).
- Multiple accounts, social features, leaderboards, gamification currencies and push notification infrastructure.
- Sophisticated spaced-repetition algorithms, mastery predictions, or automated progress judgments beyond the agreed metrics.
- Forced daily paragraph tasks or mandatory synonyms/word families.

## 12. Approved Product Decisions

These **do not change the approved Mature Routine**; they clarify app behavior:

1. **Flexible session quantity:** Plan defaults to 2/day, but the learner may choose 1–3 for a particular learning session; the app preserves the original plan and records actual output.
2. **Connected paragraph:** Optional at the end of the word batch, not required for session completion, and not part of the official Production Accuracy metric.
3. **Pilot advancement:** At Day 14 the app presents an evidence-based recommendation, **not an automatic upgrade**. A later plan can be 3 words/day on Sunday–Thursday if the user accepts it.
4. **AI role:** A single constrained Feedback Coach is enough for the MVP; a general autonomous agent is not required.

**Next implementation step:** Turn the acceptance criteria into vertical slices, starting with a functioning Home → Session → Save Word → My Words flow; then add Feedback Coach, Reviews, Progress, and Exports.


## 13. Approved Technical Direction (14 November 2026)

These technical decisions implement the approved product behavior above; they do not change the Mature Routine or MVP acceptance criteria.

| Layer | Decision |
|---|---|
| Web app / BFF | **Next.js 16**, App Router, React, TypeScript |
| Database | **Supabase PostgreSQL** |
| Authentication | **Supabase Auth**, one real learner account initially; user-scoped Row Level Security |
| Data access | Supabase JS with current SSR client pattern for Next.js; server-side mutations where appropriate |
| AI Coach | MVP: secured Next.js server endpoint calling an LLM API; preserve the approved first/second/corrected workflow |
| Future Python option | Add a separate Python + FastAPI AI service **only when** an identified learning or technical need warrants it; not a prerequisite for first slice |
| Credentials | All provider secrets server-side; publishable Supabase key may be public, but never expose service role or LLM API keys |
| Deployment | Local development first; production hosting to be decided separately |

### Implementation Constraints

- Do **not** build a Python microservice, multi-agent platform, or unrelated features in the first vertical slice.
- Use Next.js 16's current `proxy.ts` convention if session refresh requires it; do not confuse this with older `middleware.ts`.
- Implement RLS/authorization before exposing learner data. Single-user scope does not justify a public database.
- Store session timing as **active intervals**, not merely wall-clock elapsed time.
- Store the first sentence and official review attempt as immutable evidence; later feedback must not overwrite those records.
- Keep the main review milestones deterministic at +1/+3/+7/+14/+30 from each word's own learning date.
- Maintain the approved 2-words-per-learning-day plan on Sunday–Thursday. A learner's one-off choice of 3 words must not silently change the plan.
- Favor small, verifiable vertical slices over implementing all MVP features at once.

### First Delivery Slice

**Home → Start Session → Active Stopwatch → Enter and Save a Word → My Words → Reload and Verify Persistence.**

This slice should include essential Supabase/Auth/RLS foundations and migration(s), but defer AI feedback, automatic review engine, progress charts, exports, and optional paragraphs to the next slices. A draft session may be saved and resumed; do not claim a session is fully completed until required subsequent flow steps are implemented.
