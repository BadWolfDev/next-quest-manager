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

**Soft deletes.** `archived_at` rather than `DELETE`, so history survives.
Queries must filter `isNull(archivedAt)` unless they deliberately want archives.

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
  actions/        auth.ts, boards.ts, workspaces.ts, session.ts
  app/
    (auth)/       /login, /signup — centred card layout
    (app)/        authenticated shell: /app, /w/[workspaceSlug], /b/[boardId]
    api/auth/     Auth.js route handler (Node runtime)
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
    settings/     token, member and workspace management UIs
    invites/      accept-invite form
  db/             schema.ts (single source of truth), index.ts (client singleton)
  hooks/          use-mounted (hydration gate)
  lib/            authorize, queries, rate-limit, password, positions, env,
                  validation, errors, api-tokens, invites, notifications
    core/         board-ops.ts, members.ts — the single implementation of every
                  board mutation and read, shared by server actions and MCP
                  public-board.ts — the isolated, session-free public read path
  skin.ts         skin list, storage keys, the no-flash inline script
  mcp/            server.ts — MCP tool definitions
  auth.ts         Auth.js, Node runtime (providers + DB)
  auth.config.ts  Auth.js, edge-safe half (no providers, no DB)
  proxy.ts        route protection (Next 16's renamed middleware)
drizzle/          generated SQL migrations, committed
scripts/          migrate.ts
```

## Commands

```bash
npm run dev          # dev server
npm run build        # production build; typechecks and lints
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
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
