# English Vocabulary Habit

Vertical Slices 01–02: a private Next.js 16 / TypeScript / Tailwind / Supabase app for recoverable study sessions, active-time tracking, manual AWL entry, spaced reviews, Minimum Viable Day (MVD), and persistent My Words records.

1. Set the two public Supabase variables in `.env.local` using `.env.example`.
2. Manage version-controlled migrations using the pinned Supabase CLI: [migration workflow](docs/Supabase_Migrations.md). The learner has confirmed the initial hosted deployment; keep that deployed migration unchanged.
3. Create and confirm one learner in Supabase Authentication (Email/password).
4. Run `npm ci`, then `npm run dev`, and open http://localhost:3000.

See [complete setup, verification, tests, and limitations](docs/Vertical_Slice_01_Setup.md).

Slice 02: [implementation report and remote deployment commands](docs/Vertical_Slice_02_Implementation_Report.md) · [local manual acceptance checklist](docs/Vertical_Slice_02_Acceptance.md). Historical Slice 01 setup notes predate its accepted hosted deployment. The Slice 02 migration has only been validated locally.

Checks: `npm run lint`, `npm test`, `npm run test:concurrency` (native PostgreSQL), `npm run build`, `npm run typecheck`, `npm run test:e2e`.

Use `http://localhost:3000` consistently in development. The daily action uses the learner's browser-configured timezone after hydration. See [runtime fixes and local authenticated verification](docs/Runtime_Development_Fixes.md); `npm run test:runtime` checks sign-in, Dashboard rendering, weekdays, and HMR against the running local Supabase stack without changing hosted configuration.

Sessions can be active drafts, closed unfinished, or evidence-qualified completed MVD/review sessions. At most one active draft is allowed; database writes enforce selected word limits and immutable first attempts. Review comes before new-word entry. Full learning completion, AI feedback, progress, and exports remain deferred. The approved requirements and deployed Slice 01 migration are unchanged. `npm run test:runtime` uses disposable local learners to verify authenticated Review/MVD and Slice 01 persistence; it rejects hosted URLs.
