# Development runtime fixes

## Authenticated prerender error

The reported `Date.now()` error was reproduced with a real signed-in local Supabase learner. Its server path was `Home → requireLearner → createClient → auth.getUser()`. Supabase Auth reads the current time when recovering/loading a session and checking its expiry (`GoTrueClient._recoverAndRefresh` and `GoTrueClient.__loadSession` in the installed `@supabase/auth-js`). With Cache Components and partial prefetching, the preceding cookie read did not exclude all of that Auth work from prerendering.

`src/lib/supabase/server.ts` now awaits `connection()` before creating the SSR client or invoking Auth. `src/app/loading.tsx` and the `login`, `session`, and `words` segments' loading exports supply route-level Suspense fallbacks for both initial rendering and client navigations; a shared ancestor's fallback alone cannot cover every navigation beneath an already-mounted layout. This defers session validation to an actual request, keeps authenticated data out of shared prerendered content, and leaves `cacheComponents: true` enabled. No auth checks or RLS protections were removed.

The Dashboard also had a browser-date read in `StartSession`'s `useState` initializer. That initializer executes during server rendering too, so it was unsuitable for a learner-local date. Moving it alone did **not** fix the reported SDK `Date.now()` error; the authenticated regression reproduced it until the server Auth boundary was added.

`useLocalDate` now uses a stable `null` server/hydration snapshot via `useSyncExternalStore`, followed by browser-only date reads. Until hydration supplies the local date, the action is disabled and displays “Checking your local study day…”. The browser's configured IANA timezone is used; there is no separate timezone profile setting in this slice. The date refreshes every 30 seconds and on focus/visibility changes. Starting a session re-reads the local date immediately, and a one-day exceptional-learning choice is tied to that date.

`isReviewDay` treats an already-selected calendar date as a date, independently of the server timezone. Sunday–Thursday remain learning days, Friday–Saturday remain review-only by default, and the official plan remains two words. The word-entry learning date uses the same local-date helper. No learning rule or migration changed.

## Development hostname

The setup instructions used `localhost:3000`, while Playwright used `127.0.0.1:3000` and a different dev hostname command. Mixing those hostnames makes development resources and host-scoped authentication inconsistent.

- `npm run dev` explicitly starts Next.js with `--hostname localhost`.
- Playwright's base URL, readiness URL, and server command consistently use `http://localhost:3000`.
- Use that URL in the browser. Existing cookies on `127.0.0.1` are scoped to a different hostname; sign in on localhost if necessary.
- No `allowedDevOrigins` entry was added: the authenticated local browser regression received actual HMR websocket messages from localhost without cross-origin warnings. Cache Components and the normal development-origin protections remain enabled.

Restart an old dev process to pick up the command change, then open:

```powershell
npm run dev
```

[http://localhost:3000](http://localhost:3000)

## Focused automated verification

Start the existing local Supabase stack, then run:

```powershell
npm test
npm run test:runtime
npm run lint
npm run typecheck
npm run build
```

`test:runtime` requires the running local Supabase API at loopback port 54321 and a Playwright browser (installed Edge is used by default on Windows). It obtains local CLI status in memory, creates a temporary local Auth learner with a generated password, and signs in through the real application. It rejects hosted API URLs. It neither reads nor changes the hosted learner's credentials or `.env.local` values.

The test starts a separate Next.js dev server at **localhost:3001**, with a separate `.next-runtime-test` output directory, so it does not reuse a server that might point at hosted Supabase. Local API credentials are supplied only in that child process's environment. Traces/screenshots are not recorded and diagnostics redact credentials. The temporary learner and test process are removed afterward; the user's local Supabase stack stays running. It does not start sessions, save learning records, reset databases, or apply migrations.

Checks cover:

- Real email/password sign-in, authenticated Dashboard rendering, a full reload, and read-only navigation through My Words and Session back to Dashboard.
- No browser/server current-time prerender, missing navigation fallback, or hydration errors.
- A functioning localhost HMR websocket and no blocked cross-origin diagnostic.
- Cairo Thursday → Friday and Saturday → Sunday changes, including refreshing an open tab at midnight.
- Clearing an exceptional-day choice when the local date changes.
- A Los Angeles local weekday differing from UTC/Cairo.
- Unit checks for all seven weekdays, Cairo seasonal offsets, and dates on either side of UTC.

The normal product server remains on localhost:3000; the isolated port/output directory are test infrastructure only. Next.js added the test output's generated type paths to `tsconfig.json`.

## Files changed for this fix

- `src/lib/supabase/server.ts`: request-time Auth boundary.
- `src/app/loading.tsx`, `src/app/login/loading.tsx`, `src/app/session/loading.tsx`, `src/app/words/loading.tsx`: route-level Suspense loading states.
- `src/lib/model.ts`, `src/components/start-session.tsx`: timezone/date handling.
- `src/lib/use-local-date.ts`: hydration-safe local calendar subscription.
- `package.json`, `playwright.config.ts`: consistent development hostname and runtime-test command.
- `next.config.ts`, `tsconfig.json`, `.gitignore`, `eslint.config.mjs`: isolated runtime-test output, generated types, and artifact ignores; Cache Components stays enabled.
- `tests/core.test.mjs`, `tests/helpers/local-supabase.mjs`, `tests/runtime/dashboard.test.mjs`: focused date and authenticated runtime regressions.
- `README.md` and this guide: development and verification instructions.

The approved requirements documents and all database migrations were left unchanged. Hosted authentication/persistence was not re-tested, and nothing was deployed.

## Verification results

| Check | Result |
|---|---|
| `npm test` | 26 passed, no failures or skips |
| `npm run test:runtime` | 4 passed (three authenticated browser scenarios plus their enclosing test), no failures or skips |
| `npx --no-install playwright test --grep=private` | 1 passed using the standard localhost:3000 dev command; no current-time, missing-boundary, or blocked-origin diagnostics |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed with Cache Components and partial prefetching enabled |
| `git diff --check` | Passed |

Runtime verification used a real temporary learner in **local** Supabase and actual HMR websocket messages. Browser/server checks rejected unstable-time, missing navigation fallback, hydration, and blocked-origin diagnostics. Authenticated pages also rendered without application data-loading alerts. The temporary account and isolated dev process were cleaned up. The existing hosted learner account was not used or changed.

References: [Next.js current-time rendering guidance](https://nextjs.org/docs/messages/next-prerender-current-time-client), [allowed development origins](https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins), and the bundled Next.js 16.4.6 `connection`, Cache Components, and authentication guides.
