# CLAUDE.md — Next Quest Manager

Guidance for anyone (human or agent) working in this repo.

## What this is

An open-source, self-hostable Trello-style kanban board. The product constraint
that shapes every technical decision: **it must run on a Vercel free-tier
project or a single Docker host with no configuration beyond `DATABASE_URL` and
`AUTH_SECRET`.**

## Stack

| Concern     | Choice                                                       |
| ----------- | ------------------------------------------------------------ |
| Framework   | Next.js 16, App Router, React 19, TypeScript strict           |
| Database    | Postgres only                                                 |
| ORM         | Drizzle ORM + `postgres.js`, migrations via drizzle-kit       |
| Auth        | Auth.js v5 (`next-auth@beta`), credentials provider, JWT sessions |
| Hashing     | argon2id via `@node-rs/argon2`                                |
| Validation  | Zod, at every server-action boundary                          |
| UI          | Tailwind v4 + shadcn/ui (radix-nova, neutral base), CSS variables |
| Theming     | `next-themes`, class strategy, light/dark/system              |
| Ordering    | Fractional indexing (`fractional-indexing`) in TEXT columns   |

## Architectural decisions

**Postgres and nothing else.** No Redis, no queue, no blob store. Rate limiting
lives in `rate_limits`, audit history in `activity_log`, in-app alerts in
`notifications`. If a feature seems to need another service, model it as a table
first. Adding a second required service breaks the deployment promise.

**JWT sessions, not database sessions.** Serverless functions should not read a
session row on every request, and JWT sessions mean no sticky infrastructure.
The trade-off — revocation is not instant — is accepted for phase 1.

**One central authorization module.** `src/lib/authorize.ts` is the only place
that decides who may do what.

> **Rule: every server action and every data query calls an `authorize()` helper
> — `requireUser()`, `requireWorkspaceMember()`, `requireBoardAccess()`,
> `requireListAccess()`, `requireCardAccess()` — before touching data.**

Those helpers scope rows through `workspace_members` **in SQL** with an inner
join, so a row the caller has no membership for never leaves the database. Never
fetch broadly and filter afterwards, and never trust an id from a URL or a form
without running it through the helper.

A resource the caller cannot see returns **404, not 403** — existence is not
disclosed.

**UUIDs everywhere.** `uuid` primary keys with `defaultRandom()`. URLs carry
UUIDs, parsed with `uuidSchema` before use. No sequential ids to enumerate.

**timestamptz everywhere.** Every timestamp column is `withTimezone: true`.

**Fractional indexing for order.** `lists.position`, `cards.position`,
`checklists.position` and `checklist_items.position` are TEXT fractional
indices. Inserting between two neighbours generates one new key with
`generateKeyBetween` — no renumbering, no write amplification, and concurrent
reorders converge. Never replace these with integer positions.

Those columns are declared **`text collate "C"`** (the `position` custom type in
`schema.ts`). This is load-bearing, not cosmetic: fractional keys are base-62
strings compared bytewise, but under a locale collation like `en_US.UTF-8`
Postgres sorts `Zz` *after* `a1`. Since prepending to a list produces exactly
such an uppercase key, `ORDER BY position` would silently return the wrong
order on any non-C database. Pinning the collation on the column keeps ordering
correct everywhere and keeps the `(parent_id, position)` indexes usable for
those ordered reads. Any new ordered column must use the same type.

**Moves send neighbour ids, never positions.** `moveCardAction` /
`moveListAction` take `afterId`/`beforeId` and compute the fractional index
server-side from rows re-read inside the transaction. A client cannot dictate a
position string, and a neighbour that does not belong to the destination
container is rejected. When neighbours are unusable — duplicate keys, inverted,
or no longer adjacent because of a concurrent edit — `placeBetween`
(`src/lib/positions.ts`) renumbers the siblings and retries rather than failing
the move.

**Optimistic board state.** `BoardView` is a client component over
`useOptimistic(lists, applyMove)`. `applyMove` (`board-state.ts`) is pure and
drives both the live drag preview and the optimistic overlay, so the arrangement
never changes shape between "dropped" and "confirmed". Server calls are
serialised through a per-board promise queue: two quick drags must reach
Postgres in order, or the second computes its index from neighbours the first
has not written yet. A failed move surfaces as a toast and the optimistic state
falls back to server truth.

**MCP is a second front door, not a second code path.** `/api/mcp`
(`mcp-handler` + `@modelcontextprotocol/server` v2, Streamable HTTP, stateless)
authenticates a personal access token, resolves it to a user, and calls the very
same `lib/core/board-ops` functions the web UI's server actions call. Those take
an optional `actor`; when it is absent the caller is resolved from the Auth.js
session, when present it is the token's owner. **Authorization, position logic
and activity logging exist once.** Never add an MCP-specific query or a
duplicated permission check.

Two rules carry over verbatim to MCP tool handlers:
- every handler goes through an `authorize()` helper before touching data;
- every exported tool is a publicly reachable endpoint — do not register one you
  are not prepared to have an untrusted agent call.

The acting user is read from the *per-call* handler context
(`ctx.http.authInfo.extra`), never from module scope. A module-scoped "current
user" would leak identity between concurrent requests on a warm server.

Mutations from MCP write `source: "mcp"` into the activity entry's data.

**Migrations ship with the code that needs them — never by hand.** Vercel runs
`vercel-build`, which applies pending migrations and only then builds; a failed
migration fails the build. Never assume someone will migrate manually after a
deploy, and never merge a schema change without its generated SQL committed
alongside. Self-hosted containers get the same guarantee from
`npm run start:migrate`.

The deploy step is gated on `VERCEL=1` **and** a database URL, so `npm run build`
locally is guaranteed not to open a connection. It prefers
`DATABASE_URL_UNPOOLED` because migrations misbehave through a transaction
pooler. Preview deploys migrate the *linked* database — fine while it is one
developer's project, a branch database once it is a team.

**Migrations are additive. Production exists.** From the shared-workspaces phase
onward there is a deployed instance with real data. Generate a new migration
(`npm run db:generate`) and commit it; never rewrite `0000` or an already-applied
file. `scripts/migrate.ts` refuses a non-local host unless
`NQM_ALLOW_REMOTE_MIGRATE=1` is set — a deliberate speed bump, because
`.env.local` holds the production URL and Next.js loads it at *higher* priority
than `.env`. Always export `DATABASE_URL` from `.env` before running the app or a
script locally.

Postgres note: `ALTER TYPE … ADD VALUE` may run inside a transaction on PG 12+
but the new value cannot be *used* in that same transaction — add the enum value
in one migration, use it in a later one.

**Board mutations touch `boards.updated_at`.** Anything that changes what a board
looks like — lists, cards, moves, assignees — calls `touchBoard(tx, boardId)`
inside its own transaction. `/api/board/<id>/version` reads that single column and
the client polls it, so a mutation that forgets to touch it is invisible to
everyone else's browser.

**Roles: owner > admin > member > viewer.** `member` is the write floor:
`require*Access(..., "member")` is what makes something unavailable to viewers,
and it is the *default*, so a new call site fails closed. Read paths opt down
explicitly with `READ_MIN_ROLE`. Membership rules (owner-only admin grants, peer
protection, last-owner protection) live in `src/actions/members.ts` and are
enforced server-side regardless of what the UI offers.

**Never give a `"use server"` export an `actor` parameter.** Every export of such
a file is a public HTTP endpoint, so an actor argument is impersonation by
argument — any caller could name any user. Shared logic that needs an explicit
actor lives in `src/lib/` (see `lib/core/members.ts`), and the action wrapper
calls it with no actor so the caller is session-resolved.

**OAuth 2.1 authorization server — a second front door, same house.** NQM
issues its own tokens (`src/lib/oauth.ts` pure half, `src/lib/core/oauth.ts`
stateful half, `/api/oauth/*` endpoints, `/oauth/authorize` consent page). A
self-hosted authorization server rather than a dependency on one, for the same
reason rate limiting is a table: adding a required second service breaks the
deployment promise. There is no new environment variable — the issuer origin is
derived from the request.

Rules that carry:

- **PKCE with S256 or nothing.** There is no `plain` branch anywhere and the
  metadata does not advertise one. `code_challenge_method` is required at
  `/oauth/authorize`, not defaulted.
- **Every secret is a 256-bit random value stored as a SHA-256 digest** under a
  unique index — client secrets, authorization codes, access and refresh
  tokens. Same reasoning as `nqm_` tokens: nothing to brute-force, and
  verification must be one indexed lookup rather than ~20ms of argon2.
- **Rotation plus replay revocation.** `oauth_tokens.family_id` *is* the
  originating authorization code's id, so "revoke everything this replayed code
  produced" and "revoke everything this reused refresh token belongs to" are
  the same indexed UPDATE. A failed exchange still burns the code.
- **The consent action re-validates the whole request.** `src/actions/oauth.ts`
  re-loads the client and re-checks the redirect URI, PKCE challenge, scope
  ceiling and audience from the submitted fields. The consent page's hidden
  inputs are a convenience for the browser, not a trusted channel — that form
  is as reachable by a script as by the screen that rendered it.
- **Redirect URIs match exactly.** No RFC 8252 §7.3 loopback-port relaxation:
  an arbitrary port on a registered loopback URI means any local process can
  receive somebody else's code. An unknown `client_id` or an unregistered
  `redirect_uri` is *rendered*, never redirected (RFC 6749 §4.1.2.1) —
  redirecting would make the endpoint a forwarder to any URL in a query string.
- **`authorize()` knows nothing about OAuth**, exactly as it knows nothing about
  share tokens. An access token resolves to an `Actor` and then goes through
  the same membership joins as a session. Never add a token branch there, and
  never add an OAuth-specific query to `board-ops`.
- **Registration is open, and grants nothing.** RFC 7591 has to be
  unauthenticated for a hosted client to introduce itself to an instance it has
  never seen. A row is a name and a redirect allowlist; access only ever comes
  from a signed-in human approving the consent screen. It is rate-limited per
  IP and, like every use of `rateLimit`, fails closed.

**Skins are a token layer, not forked components.** `globals.css` defines each
skin under `:root[data-theme="pixel"|"grid"|"retro"]` and maps the handoff's
palette onto the *existing* shadcn variables (`--background`, `--card`,
`--border`, `--sidebar-*`, …). That is why the sidebar, dialogs, settings and
auth pages come along for free. Skin-only extras are namespaced `--skin-*`
(`--skin-shadow-card`, `--skin-field`, `--skin-font-display`,
`--skin-modal-anim`) and consumed through utility classes (`.nqm-skin-card`,
`.nqm-skin-column`, `.nqm-skin-modal`, `.nqm-skin-kicker`). Never fork a
component for a theme.

next-themes owns the *class* on `<html>`; skins own the `data-theme`
*attribute*. They do not collide, and `:root[data-theme=…]` (0,2,0) outranks
`.dark` (0,1,0), so an active skin wins without disabling the light/dark toggle
— the toggle is simply hidden while a skin is on, because it would do nothing.

The picker is a dialog opened from the user menu (`components/theme-dialog.tsx`),
rendered as a *sibling* of the DropdownMenu — selecting a menu item closes the
menu, which would unmount a dialog nested inside it. Each card previews its
theme through `[data-preview-theme]`, a second selector on the skin token blocks
that re-scopes them onto a nested element, so previews paint from real tokens
rather than hardcoded swatches.

**Skin choice lives in localStorage, per device — not in the database.** A
deliberate product decision: no round trip before first paint, and the same
account can look different on different machines. The inline script in the root
layout (`SKIN_INIT_SCRIPT`) stamps the attribute before paint; every storage
read is wrapped in try/catch because browsers with site data blocked throw on
access.

**The public board path is separate on purpose.** `lib/core/public-board.ts`
resolves a share token straight to data and never consults a session. Crucially
the `authorize()` helpers know nothing about tokens — do not add a token branch
there. Keeping the two apart is the structural guarantee that a share link can
never reach a mutation: there is no code path where a token satisfies a
membership check. Public payloads must carry no emails and no user ids; check
the serialized RSC output, not just the rendered UI.

**One feature must not take down a page.** Reads that *decorate* a page — the
notification count, a board's share token, the assignable-member list — go
through `safeRead()` (`lib/safe-read.ts`), which logs and falls back. This is not
theoretical: an unguarded `select public_token` against an un-migrated database
500ed the entire board page, and the unread-count read sat inside a
`Promise.all` in the app shell where one rejection would have 500ed every
authenticated page.

Core data stays unguarded on purpose. If a board's lists fail to load, an honest
error beats rendering an empty board.

**Closed registration is opt-in and enforced server-side.** `ADMIN_EMAIL` +
`ADMIN_PASSWORD` (both, or neither — one alone throws on first use, surfacing as
a 500 with a clear log message rather than silently leaving signup open) switch
the instance to invite-only. `lib/registration.ts` owns the whole thing: config parsing,
`isClosedRegistration()`, `isEnvAdmin()`, the bootstrap, and instance-invite
tokens (`nqu_`).

Rules that matter:

- **Only the ADMIN_EMAIL identity mints accounts** — `isEnvAdmin()`, never the
  `admin` *role*. On an open instance the first signup also gets `role: "admin"`,
  and that person must not be able to create accounts on an instance somebody
  else operates. Every export of `actions/user-invites.ts` goes through
  `requireEnvAdmin()`.
- **`signUpAction` enforces the mode itself.** The signup page hides its form,
  but the action is a public endpoint; hiding a form is not access control.
- **The first-user-becomes-admin rule is suppressed in closed mode.** Otherwise a
  `/join` signup that landed before the admin's first login would seize the
  admin role on a fresh instance.
- **Instance invites (`user_invites`, `nqu_`) are a separate table from workspace
  invites (`invites`, `nqi_`)** on purpose: one grants an account, the other
  grants membership to an existing account. Keeping them apart is what stops a
  workspace invite becoming a signup back door. Do not merge them.
- **The env password is a bootstrap credential, never re-applied.** An existing
  user is elevated to `admin`; their password hash is left alone. Re-applying it
  would let anyone who can read the environment take over an established
  account, and would silently undo a password the admin had changed.
- Bootstrap runs **lazily and memoised per process**, from the credentials
  provider — not at module import (that would open a connection during
  `next build`) and not in the migrate step (the build box may not hold the
  credentials).

**Soft deletes.** `archived_at` rather than `DELETE`, so history survives.
Queries must filter `isNull(archivedAt)` unless they deliberately want archives.
`restoreCard` pulls a card into the board's first live list when the list it
came from was archived meanwhile — restoring something into an invisible list
is indistinguishable from the restore having failed.

**Watching is interest; assignment is responsibility.** `card_watchers` is a
separate table from `card_assignees` on purpose, because the two diverge.
Assigning and commenting auto-watch, unassigning does not unwatch.
`comments.edited_at` is nullable and separate from the non-null `updated_at`:
only a null/not-null column can distinguish "never edited" from "edited
immediately". Comment edits and deletes are author-only, with workspace
admins and owners allowed as moderators.

**Notifications are written inside the causing transaction** and every
recipient is a workspace member resolved in SQL — a comment mention cannot
reach a stranger, and a cron reminder cannot reach somebody who has since been
removed from the workspace. `@mention` matching lives in `lib/mentions.ts` and
tests the *known member set* against the body rather than inventing a mention
grammar with a regex.

**Denormalised `cards.board_id`.** Cards carry their board id alongside their
list id so board-scoped queries and authorization checks avoid a join through
`lists`. Both must be kept consistent when a card moves between lists.

**Timing-safe credentials.** An unknown email still pays a full argon2id
verification (`burnPasswordVerification`) so response time cannot be used to
enumerate accounts. Never short-circuit that path.

**Rate limiting fails closed.** `src/lib/rate-limit.ts` is a single atomic
`INSERT … ON CONFLICT DO UPDATE`. If Postgres is unreachable the attempt is
denied, so the database cannot be knocked over to disable throttling.

**Hydration-sensitive client state.** `next-themes`' `useTheme()` reads
localStorage in its state initialiser, so it returns the stored theme on the
first client render while the server rendered nothing. Never derive rendered
output from it directly — gate it behind `useMounted()` (`src/hooks/use-mounted.ts`)
and render a neutral state with the same DOM shape until it flips. The hook uses
`useSyncExternalStore` rather than `useEffect` + `setState`, because React uses
`getServerSnapshot` for both the server render and the hydration pass, and
because the repo's React Compiler lint rules reject `setState` in an effect body.

**Client/server module boundary.** Server-only modules start with
`import "server-only"`. Error classes shared with client components live in
`src/lib/errors.ts`, not in `authorize.ts` — importing `authorize.ts` from a
client component would drag the Postgres driver and the argon2 native addon into
the browser bundle. A `"use server"` file may only export async functions, so
shared constants live in `src/lib/palette.ts`.

## Layout

```
src/
  actions/        auth.ts, boards.ts, workspaces.ts, session.ts,
                  account.ts (own profile + password), comments.ts, labels.ts,
                  archive.ts (restore card / list),
                  oauth.ts (consent decision + connected apps)
  app/
    (auth)/       /login, /signup, /oauth/authorize — centred card layout
    (app)/        authenticated shell: /app, /w/[workspaceSlug], /b/[boardId]
    api/auth/     Auth.js route handler (Node runtime)
    api/cron/     due-reminders — CRON_SECRET-authenticated due-date sweep,
                  plus the OAuth code/token prune
    api/oauth/    register (RFC 7591), token, revoke (RFC 7009)
    .well-known/  oauth-authorization-server (RFC 8414),
                  oauth-protected-resource (RFC 9728)
    page.tsx      signed-out landing page
  components/
    ui/           shadcn/ui primitives — regenerate, don't hand-edit
    app/          shell, sidebar, dialogs
    auth/         sign-in / sign-up form
    card/         card detail (modal + standalone route)
    public/       anonymous read-only board view
    board/        dnd-kit board: board-view, sortable-list, sortable-card,
                  list-header, add-card, add-list, board-state (pure reducer),
                  assignee-popover, activity-panel, use-board-freshness
    settings/     token, member, connected-app and workspace management UIs
    oauth/        consent-screen — the OAuth approval dialog
    invites/      accept-invite form
  db/             schema.ts (single source of truth), index.ts (client singleton)
  hooks/          use-mounted (hydration gate)
  lib/            authorize, queries, rate-limit, password, positions, env,
                  validation, errors, api-tokens, invites, notifications,
                  mentions.ts (pure @mention resolution, no DB)
                  oauth.ts — PKCE, scopes, redirect rules, discovery metadata;
                  deliberately DB-free so it is unit-testable
    core/         board-ops.ts, members.ts — the single implementation of every
                  board mutation and read, shared by server actions and MCP
                  public-board.ts — the isolated, session-free public read path
                  due-reminders.ts — the cron sweep; a system job with no
                  session, so it scopes recipients through workspace_members
                  in SQL instead of calling an authorize() helper
                  oauth.ts / oauth-cleanup.ts — the OAuth server's stateful
                  half and its housekeeping
  skin.ts         skin list, storage keys, the no-flash inline script
  mcp/            server.ts — MCP tool definitions
  auth.ts         Auth.js, Node runtime (providers + DB)
  auth.config.ts  Auth.js, edge-safe half (no providers, no DB)
  proxy.ts        route protection (Next 16's renamed middleware)
drizzle/          generated SQL migrations, committed
vercel.json       Vercel Cron schedule for the due-date sweep
scripts/          migrate.ts
```

## Commands

```bash
npm run dev          # dev server
npm run build        # production build; typechecks and lints
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm test             # Vitest (src/**/*.test.ts); set TEST_DATABASE_URL to include the Postgres authorization tests
npm run db:generate  # schema change -> new SQL migration in ./drizzle
npm run db:migrate   # apply pending migrations
npm run db:studio    # browse the data
docker compose up -d db   # local Postgres on :5432
```

## Conventions

- Server actions return `ActionState` (`{ ok, message?, fields? }`) and funnel
  failures through `toActionError` — never leak raw error text to the client.
- Mutations write an `activity_log` row inside the same transaction.
- Adding a UI primitive: `npx shadcn@latest add <name>`. Do not hand-write files
  in `components/ui`. One deliberate exception is documented in-file:
  `ui/sonner.tsx` gates its `theme` prop behind `useMounted()`. Re-apply that if
  the component is ever regenerated.
- Never render user content as raw HTML. Card descriptions and comments are
  markdown *source*; when a renderer is added it must sanitise.
- Add an index for every new foreign key and for any column used in an ordering
  or lookup path.
- Every export of a `"use server"` file is a publicly callable endpoint. Do not
  leave unused exports there.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
