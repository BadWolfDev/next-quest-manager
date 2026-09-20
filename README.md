# Next Quest Manager

**A self-hostable kanban board that runs on nothing but Postgres — and that AI agents can drive over MCP.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Trello-shaped boards for teams who would rather own the database than rent one.
One `DATABASE_URL` and one `AUTH_SECRET` is the entire configuration surface: no
Redis, no queue, no object store, no third-party auth provider.

---

## Features

- **Kanban boards** — workspaces → boards → lists → cards, with labels, due
  dates, comments and checklists in the schema
- **Real drag & drop** — reorder cards, move them between lists, reorder lists;
  mouse, touch (long-press to lift so the board still scrolls), and full
  keyboard support
- **Optimistic UI** — drops apply instantly and roll back with a toast if the
  server refuses
- **Search across every workspace** — a command palette on `Cmd`/`Ctrl` + `K`,
  debounced, jumping straight to a card; it only ever returns cards you are
  already a member of
- **Filter a board** — by label, assignee, due state (overdue / due in 24 hours
  / no date) and a text quick-filter, with a live "n cards hidden" count. Purely
  a way of looking at the board: drag & drop keeps working while a filter is on
- **Quick actions on a card tile** — open, copy link, move to top or bottom, or
  archive, from a "…" menu that stays out of the way of the drag handle
- **Due dates that say something** — overdue and due-within-24-hours tiles carry
  their own tone, drawn from theme tokens so every skin inherits it
- **Optional invite-only mode** — closed registration with an env-configured
  admin who mints account invites
- **Shared workspaces** — invite links (no SMTP required), four roles
  (owner / admin / member / viewer), member management, per-card assignees
- **Live-ish collaboration** — board freshness polling, an activity panel, and
  in-app notifications
- **Comments with `@mentions`** — edit and delete your own, watch a card to
  follow it, and get notified when a card you watch is commented on
- **Due-date reminders** — an authenticated cron endpoint notifies assignees and
  watchers 24 hours before a deadline, and once it has passed
- **Archive and restore** — lists, cards and whole boards soft-delete and come
  back; nothing is ever silently destroyed. An archive drawer on each board
  restores lists and cards, and archived boards are restorable from the
  workspace page
- **Copy a card, or move it to another board** — checklists come with it, labels
  that do not exist on the destination do not
- **Account settings** — `/settings/account`: change your display name or
  password, the latter verified with argon2 and rate-limited like sign-in
- **MCP server** — Claude Code, claude.ai connectors, Cursor and any other MCP
  client can read and manage your boards, authenticated with personal access
  tokens (read-only supported)
- **Four visual themes** — the default light/dark plus three self-contained
  skins: **Pixel Quest** (8-bit console), **Grid Protocol** (Tron hairlines and
  glow) and **Miami Deadline** (80s neon), each with an optional CRT scanline
  overlay
- **Card detail** at a shareable URL — labels, description, checklists,
  assignees, move between lists
- **Board menu** — rename a board, archive it (admin and up), or open its
  archive, from the board title
- **Public board sharing** — a read-only link anyone can open, no account needed
- Responsive from phone to desktop
- **Self-host anywhere** — Vercel free tier, Docker, or any Node host

## Themes

Pick a skin from the user menu → **Theme**, which opens a picker with a live
preview of each one. Themes are stored in your
browser (per device, not per account), applied before first paint so there is no
flash, and they cover the whole app — sidebar, dialogs, settings and the card
detail, not just the board.

| Theme | Look |
| ----- | ---- |
| **Default** | Follows your light / dark setting |
| **Pixel Quest** | Chunky 3–4px borders, hard offset shadows, 16px dotted grid, Press Start 2P / VT323 |
| **Grid Protocol** | Near-black ground, 1px cyan hairlines, glow instead of fill, 40px vector grid, Orbitron / Archivo |
| **Miami Deadline** | Hot pink / cyan / yellow on violet, flat colour-block offsets, 5px top rules, Audiowide / Archivo |

The three skins are dark by design, so the light/dark toggle is hidden while one
is active. **Scanlines** (a CRT overlay) can be turned off per device.

<!-- TODO: add theme screenshots
| Pixel Quest | Grid Protocol | Miami Deadline |
| ----------- | ------------- | -------------- |
| ![Pixel](docs/screenshots/pixel.png) | ![Grid](docs/screenshots/grid.png) | ![Retro](docs/screenshots/retro.png) |
-->

## Screenshots

<!-- TODO: add screenshots
| Board | Mobile | Members |
| ----- | ------ | ------- |
| ![Board](docs/screenshots/board.png) | ![Mobile](docs/screenshots/mobile.png) | ![Members](docs/screenshots/members.png) |
-->

_Screenshots coming soon._

---

## Quickstart

Pick the path that suits you.

### a) Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FBadWolfDev%2Fnext-quest-manager&env=DATABASE_URL,AUTH_SECRET&envDescription=Postgres%20connection%20string%20and%20a%20session%20signing%20secret&envLink=https%3A%2F%2Fgithub.com%2FBadWolfDev%2Fnext-quest-manager%23configuration&project-name=next-quest-manager&repository-name=next-quest-manager)

You'll be asked for two environment variables:

| Variable | Where it comes from |
| -------- | ------------------- |
| `DATABASE_URL` | A Postgres database — [Neon](https://neon.tech) has a free tier and pairs well with Vercel. Use the **pooled** connection string. |
| `AUTH_SECRET` | Generate one: `openssl rand -base64 32` |

**Migrations run automatically on deploy.** Vercel picks up the `vercel-build`
script, which applies pending migrations and only then runs `next build`. You do
not need to migrate by hand, and there is no build-command to configure.

- It runs only when `VERCEL=1` *and* a database URL is present, so a plain local
  `npm run build` never touches a database.
- It prefers `DATABASE_URL_UNPOOLED` (Neon's direct endpoint) when the Neon
  integration provides it — migrations through a transaction pooler can
  misbehave. The app still uses the pooled URL at runtime.
- **If a migration fails the build fails.** Code is never deployed ahead of its
  schema. (That is exactly the incident this replaced: a deploy shipped a column
  its migration had not created, and every board page 500ed until someone
  migrated by hand.)

> **Preview deploys share the linked database.** Every preview applies the same
> migrations to it. Migrations are idempotent, so running them repeatedly is
> safe — but a preview that adds a column changes the database production is
> using. For a team, point previews at a Neon branch database instead (Neon's
> Vercel integration can create one per branch).

To migrate a remote database by hand anyway — a one-off backfill, or a non-Vercel
host — the safety guard needs explicit consent:

```bash
DATABASE_URL='<your production url>' NQM_ALLOW_REMOTE_MIGRATE=1 npm run db:migrate
```

### b) Docker self-host

```bash
git clone https://github.com/BadWolfDev/next-quest-manager.git
cd next-quest-manager

docker compose up -d db          # Postgres 17 on :5432
cp .env.example .env             # then set AUTH_SECRET
npm install
npm run build
npm run start:migrate            # migrates, then serves
```

`docker-compose.yml` ships the **database only** — there is no app container, so
nothing applies migrations for you the way Vercel does. Use `npm run start:migrate`
(equivalent to `npm run db:migrate && npm run start`) as your container command or
process entrypoint, so schema and code can never drift apart. `npm run start` on
its own does **not** migrate.

Put a TLS terminator in front of it — session cookies are `Secure` in
production.

### c) Local development

```bash
git clone https://github.com/BadWolfDev/next-quest-manager.git
cd next-quest-manager
npm install

docker compose up -d db
cp .env.example .env             # set AUTH_SECRET: openssl rand -base64 32
npm run db:migrate
npm run dev
```

Open <http://localhost:3000> and create an account. **The first account on a
fresh instance becomes the administrator.**

---

## Connect an AI agent (MCP)

NQM speaks the [Model Context Protocol](https://modelcontextprotocol.io) at
`/api/mcp` over Streamable HTTP — inside the same app, no extra process, no
Redis.

There are two ways in. **OAuth is the one you want** for interactive clients;
personal access tokens remain for scripts and headless agents.

### Connect over OAuth (recommended)

NQM is its own OAuth 2.1 authorization server. There is nothing to configure
and nothing to paste: point a client at `/api/mcp`, it discovers the
authorization server from the `401`, registers itself, and opens your browser
so you can approve it.

```bash
# Claude Code
claude mcp add --transport http nqm https://<your-host>/api/mcp
```

For **claude.ai**, add a custom connector with the URL
`https://<your-host>/api/mcp` — no header. For **Cursor, Windsurf, VS Code and
the MCP Inspector**:

```json
{
  "mcpServers": {
    "nqm": {
      "type": "http",
      "url": "https://<your-host>/api/mcp"
    }
  }
}
```

You will be sent to a consent screen that names the application and the two
things it can ask for — read your boards, and change them. Approved apps are
listed under **User menu → Connected apps**, where **Disconnect** revokes every
token they hold, immediately.

Under the hood: PKCE with S256 is mandatory, access tokens last an hour,
refresh tokens rotate on every use, and a reused refresh token or a replayed
authorization code revokes the whole family. Everything lives in Postgres —
no extra service, no extra environment variable. Discovery is at
`/.well-known/oauth-authorization-server` and
`/.well-known/oauth-protected-resource`.

### Connect with a personal access token

Better for cron jobs, CI and anything with no browser.

**1. Create a token.** User menu → **Access tokens** → New token. It's shown
once; only a SHA-256 hash is stored. Tick **read-only** for a token that can
read and search but never change anything.

A token acts as *you*: it sees exactly the workspaces you belong to.

**2. Send it as a bearer token.**

```bash
claude mcp add --transport http nqm https://<your-host>/api/mcp \
  --header "Authorization: Bearer nqm_..."
```

```json
{
  "mcpServers": {
    "nqm": {
      "type": "http",
      "url": "https://<your-host>/api/mcp",
      "headers": { "Authorization": "Bearer nqm_..." }
    }
  }
}
```

**Tools**

| Area | Tools |
| ---- | ----- |
| Read | `list_workspaces`, `list_boards`, `get_board`, `get_card`, `search_cards`, `list_members`, `list_labels` |
| Boards | `create_board`, `archive_board`, `restore_board` |
| Lists | `create_list`, `rename_list`, `archive_list`, `restore_list` |
| Cards | `create_card`, `update_card`, `move_card`, `move_card_to_board`, `copy_card`, `archive_card`, `restore_card`, `assign_card`, `unassign_card`, `watch_card`, `unwatch_card` |
| Labels | `create_label`, `update_label`, `delete_label`, `set_card_label` |
| Checklists | `add_checklist`, `add_checklist_item`, `toggle_checklist_item`, `delete_checklist_item` |
| Comments | `add_comment`, `update_comment`, `delete_comment` |

Read-only tools carry `readOnlyHint` and the archiving and deleting ones carry
`destructiveHint`, so clients know what is safe to auto-approve. Every agent
change is written to the activity log tagged `source: "mcp"` and shown with a
"via MCP" marker in the board's activity panel.

**Limits:** 300 requests per minute per token, whether it is an OAuth access
token or a personal access token. An OAuth grant without the `nqm:write` scope
is refused by every mutating tool, exactly as a read-only token is.

---

## Due-date reminders

Optional, and off unless you configure it.

`GET /api/cron/due-reminders` finds every non-archived card that falls due
within 24 hours (or is already overdue) and has not been announced yet, and
notifies its assignees and watchers. `cards.due_reminded_at` makes it
idempotent — a card is announced once, and moving its due date re-arms it.

Set `CRON_SECRET` and call it with a bearer token:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-host>/api/cron/due-reminders
```

On Vercel the bundled `vercel.json` schedules it daily at 08:00 UTC and Vercel
supplies the header itself. Self-hosting, point any scheduler at it — a systemd
timer, a Kubernetes CronJob, or `cron` with the `curl` above. Nothing about the
feature depends on Vercel.

With `CRON_SECRET` unset the route returns **503** and logs why, rather than
running unauthenticated: an open endpoint that writes notification rows is a
spam amplifier.

---

## Sharing a workspace

Workspace → **Members** → *Invite people* creates a shareable link. No email is
sent, so no SMTP to configure.

| Role | Can do |
| ---- | ------ |
| **Owner** | Everything, including deleting the workspace and managing owners/admins |
| **Admin** | Manage boards, members (member/viewer) and invites |
| **Member** | Create and edit boards, lists and cards |
| **Viewer** | Read only — every mutation is refused, in the UI, in server actions, and over MCP |

Invite links can expire (24h / 7 days / never), be single-use or capped, and be
bound to a specific email address. A workspace always keeps at least one owner.

---

## Closed registration (invite-only instances)

By default anyone who can reach your instance can sign up, and the first account
created becomes the administrator. To run it invite-only instead, set **both**:

```bash
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=<at least 10 characters>
```

Setting only one of the pair is treated as a misconfiguration: the app refuses
to serve (a 500 with a clear message in the logs) rather than quietly leaving
signup open on an instance you believed was closed. The same applies if
`ADMIN_PASSWORD` is shorter than the password policy allows. Check the logs
after enabling it.

**What changes**

- Public signup is disabled. `/signup` explains the instance is invite-only, and
  the signup action refuses on the server — not just in the UI.
- The `ADMIN_EMAIL` account is created automatically the first time anyone signs
  in, with an `admin` role and its own personal workspace. If a user with that
  address already exists it is elevated to `admin` instead.
- That account, and **only** that account, can mint instance invites — under
  **Settings → People** in the user menu. This is gated on the email matching
  `ADMIN_EMAIL`, not on the `admin` role, so a role-admin from a previously open
  instance cannot create accounts.
- New people join through `/join/<token>` links, which can expire (24h / 7 days /
  never), be single-use or capped, and be bound to a specific email address.
- Workspace invites still work, but they grant *membership to an existing
  account* — on a closed instance they no longer offer a signup path.

**About `ADMIN_PASSWORD`**

It is a *bootstrap* credential. It creates the account and is never re-applied:
changing it later will not reset a password that has already been set, and
rotating it cannot be used to take over an established account. To re-bootstrap,
delete the user row. The password is validated against the normal policy on
first use and is never written to logs.

## Sharing a board publicly

Board header → **Share** → *Create public link*. Anyone with the link gets a
read-only view of the board: lists, cards, labels, due dates, checklist progress
and assignee first names. No account required.

- Only a workspace **admin or owner** can publish, rotate or disable a link.
- The link uses its own `nqb_` token, not the board's id — so it can be rotated
  or revoked without changing anything else, and turning sharing off leaves
  nothing guessable behind.
- Archived lists and cards never appear.
- The payload contains **no email addresses and no user ids** — assignees show a
  first name and avatar only.
- Public pages are `noindex` by default.
- A share token grants read access to that one board and nothing else: it cannot
  invoke any action, reach the MCP endpoint, or open the private board URL.

## Configuration

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `DATABASE_URL` | yes | Postgres connection string. Use the pooled endpoint on serverless hosts — the client sets `prepare: false` so PgBouncer/Neon transaction pooling works. |
| `AUTH_SECRET` | yes | Session signing secret. `openssl rand -base64 32`. |
| `DATABASE_POOL_MAX` | no | Connections per process (default 10). Lower to 1–3 on serverless. |
| `ADMIN_EMAIL` | no | With `ADMIN_PASSWORD`, runs the instance invite-only. See [Closed registration](#closed-registration-invite-only-instances). |
| `ADMIN_PASSWORD` | no | Bootstrap password for that account. At least 10 characters. Never re-applied after creation. |
| `CRON_SECRET` | no | Shared secret for `/api/cron/due-reminders`. Unset, the endpoint refuses to run (503) and due-date reminders are simply off. See [Due-date reminders](#due-date-reminders). |
| `NQM_ALLOW_REMOTE_MIGRATE` | no | Set to `1` to allow `db:migrate` against a non-local host. A safety catch, not a feature. |

Both required variables are validated at startup with an actionable error.

## Commands

| Command | What it does |
| ------- | ------------ |
| `npm run dev` | Dev server |
| `npm run build` | Production build (typechecks and lints). Never touches the database. |
| `npm run vercel-build` | What Vercel runs: migrate (on Vercel only), then build |
| `npm run start:migrate` | Migrate, then serve — for self-hosted containers |
| `npm run start` | Serve the production build |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |
| `npm test` / `npm run test:watch` | Vitest, once / in watch mode |
| `npm run db:generate` | Diff the schema into a new SQL migration |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Browse the data |

## Testing

```bash
npm test          # run once
npm run test:watch
```

Tests are [Vitest](https://vitest.dev) files living next to the code they cover,
as `src/**/*.test.ts`. Most of them are unit tests over the pure modules — the
optimistic board reducer, fractional-index placement, markdown excerpts,
validation schemas, token formats and closed-registration config parsing — and
need nothing but Node.

The authorization tests (`src/lib/authorize.test.ts`) are different: the
`authorize()` helpers *are* SQL membership joins, so proving they scope
correctly needs a real Postgres. They are **skipped unless
`TEST_DATABASE_URL` is set**, and they apply the migrations in `./drizzle`
themselves before seeding fixtures:

```bash
docker compose up -d db
psql postgres://postgres:postgres@localhost:5432/postgres \
  -c 'create database nextquest_test'

TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/nextquest_test npm test
```

Point `TEST_DATABASE_URL` at a throwaway database — the suite writes to it and
does not clean up after itself.

## Tech stack

Next.js 16 (App Router, React 19) · TypeScript · Postgres · Drizzle ORM ·
Auth.js v5 · Tailwind v4 + shadcn/ui · dnd-kit · Zod ·
`@modelcontextprotocol/server` + `mcp-handler`

## Security

- argon2id password hashing; unknown emails still pay the full verification cost
  so sign-in timing can't be used to enumerate accounts
- Sign-in, sign-up, invite creation and MCP calls are rate limited in Postgres,
  atomically, and **fail closed**
- Every server action, query and MCP tool goes through one central
  `authorize()` layer that scopes rows by workspace membership **in SQL**
- A resource you can't see returns **404, not 403**
- CSP, `X-Frame-Options: DENY`, `nosniff`, referrer and permissions policies, and
  HSTS in production
- No user content is ever rendered as raw HTML

Found a vulnerability? See [SECURITY.md](./SECURITY.md).

## Contributing

Contributions welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md), and
[CLAUDE.md](./CLAUDE.md) for the architectural rules the codebase holds to.

## License

MIT © Next Quest Manager contributors — see [LICENSE](./LICENSE).
