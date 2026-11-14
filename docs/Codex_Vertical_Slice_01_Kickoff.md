# Codex Implementation Kickoff — Vertical Slice 01

Build the first working vertical slice of the **English Vocabulary Habit** web app. The attached project files are the source of truth:

- `English_Vocabulary_Habit_Routine_v1.1_EN.md` — APPROVED learning and measurement rules.
- `English_Vocabulary_Habit_App_MVP_Approved_v1.0.md` — APPROVED product requirements and technical direction.

## Approved stack

- Next.js 16 App Router, TypeScript
- Supabase PostgreSQL + Supabase Auth
- Supabase client/server SSR conventions appropriate for Next.js 16
- Python/FastAPI is optional **later** for the AI Coach, **not part of this slice**

## Goal: one end-to-end usable experience

As the learner, I can open the Home page, see the current learning plan (Sunday–Thursday, 2 new words/day), start a session with a stopwatch that supports pause/resume, enter my first AWL word and its basic information, save it to Supabase, then navigate to My Words and still see it after a full browser reload.

## Build only what is needed for this slice

1. Initialize project (or inspect and extend it if a repository already exists); use a clean, responsive English interface.
2. Create simple single-user sign-in via Supabase Auth; protect private routes and enforce RLS. Do not rely on hiding UI elements as authorization.
3. Create a Home page with Habit Goal, Learning Goal, daily routine and MVD summary, current plan, My Words shortcut, and Start Your Routine Today. Clearly mark nonimplemented pages/features as coming soon rather than creating fake metrics.
4. Build an initial session flow with a recoverable active-time stopwatch (start, pause, resume; don't count paused or discarded offline time). Support draft state; be explicit that the complete wizard is not implemented yet.
5. Enable manual AWL word entry (with source link) using the approved fields relevant to this slice: target word, primary meaning, part of speech, one source example and attribution/context, optional useful family and synonym, and learner's original sentence. Do **not** invent or scrape official AWL ordering; plan can initially show `analysis`, `approach` as the new beginning.
6. Implement My Words chronological list with word details loaded from Supabase.
7. Provide SQL migration(s), RLS policies, `.env.example` (no secrets), and a concise README with setup and run instructions.
8. Add practical automated checks for saving/loading word data, auth isolation and active-time stopwatch behavior. Run build/lint/tests if local dependencies are available.

## Integrity and scope rules

- Keep the approved weekly plan unchanged even if a session chooses a different word count.
- Do not add AI Feedback Coach, spaced review scheduler, progress percentages, PDF/Excel exports, gamification or Python service yet.
- A first sentence must remain an original learner-authored record for later AI feedback.
- Never expose a Supabase secret/service-role key or LLM API key to the client.
- Respect the approved definitions of active day, timing, and MVD; do not mark draft entry activity as a completed full session without the required steps.
- Use current Next.js 16 and Supabase SSR guidance. Keep core design extensible but avoid speculative abstractions.

## Delivery

At the end, show what works, the database changes, env variables needed, exact commands to run, what was tested, and what remains for Vertical Slice 02. If Supabase credentials are missing, scaffold configuration and clearly say which manual steps I must perform; don't claim end-to-end persistence was verified without a database connection.
