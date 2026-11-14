# English Vocabulary Habit

Vertical Slice 01: a private Next.js 16 / TypeScript / Tailwind / Supabase app for draft study sessions, active-time tracking, manual AWL entry, and persistent My Words records.

1. Set the two public Supabase variables in `.env.local` using `.env.example`.
2. Manage version-controlled migrations using the pinned Supabase CLI: [migration workflow](docs/Supabase_Migrations.md). The learner has confirmed the initial hosted deployment; keep that deployed migration unchanged.
3. Create and confirm one learner in Supabase Authentication (Email/password).
4. Run `npm ci`, then `npm run dev`, and open http://localhost:3000.

See [complete setup, verification, tests, and limitations](docs/Vertical_Slice_01_Setup.md).

Checks: `npm run lint`, `npm test`, `npm run test:concurrency` (native PostgreSQL), `npm run build`, `npm run typecheck`, `npm run test:e2e`.

Use `http://localhost:3000` consistently in development. The daily action uses the learner's browser-configured timezone after hydration. See [runtime fixes and local authenticated verification](docs/Runtime_Development_Fixes.md); `npm run test:runtime` checks sign-in, Dashboard rendering, weekdays, and HMR against the running local Supabase stack without changing hosted configuration.

Sessions can be active drafts or closed unfinished, with preserved history. At most one active draft is allowed; direct database writes enforce the selected 1–3-word limit. Completion is unavailable until the approved routine can be verified. AI feedback, reviews, progress, and exports are deferred. The approved requirements documents are unchanged. Local SQL tests do not prove hosted authentication or persistence; the live browser test needs a dedicated learner account and applied migration.
