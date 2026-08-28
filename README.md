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
- **Shared workspaces** — invite links (no SMTP required), four roles
  (owner / admin / member / viewer), member management, per-card assignees
- **Live-ish collaboration** — board freshness polling, an activity panel, and
  in-app notifications
- **MCP server** — Claude Code, claude.ai connectors, Cursor and any other MCP
  client can read and manage your boards, authenticated with personal access
  tokens (read-only supported)
- **Light / dark / system theming**, responsive from phone to desktop
- **Self-host anywhere** — Vercel free tier, Docker, or any Node host

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

Then run the migrations once against the new database:

```bash
DATABASE_URL='<your production url>' NQM_ALLOW_REMOTE_MIGRATE=1 npm run db:migrate
```

(Or make the Vercel build command `npm run db:migrate && npm run build`.)

### b) Docker self-host

```bash
git clone https://github.com/BadWolfDev/next-quest-manager.git
cd next-quest-manager

docker compose up -d db          # Postgres 17 on :5432
cp .env.example .env             # then set AUTH_SECRET
npm install
npm run db:migrate
npm run build && npm run start
```

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

**1. Create a token.** User menu → **Access tokens** → New token. It's shown
once; only a SHA-256 hash is stored. Tick **read-only** for a token that can
read and search but never change anything.

A token acts as *you*: it sees exactly the workspaces you belong to.

**2. Point your client at it.**

```bash
# Claude Code
claude mcp add --transport http nqm https://<your-host>/api/mcp \
  --header "Authorization: Bearer nqm_..."
```

For **claude.ai**, add a custom connector with the URL
`https://<your-host>/api/mcp` and an `Authorization: Bearer nqm_...` header.

For **Cursor, Windsurf and most other clients**:

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

**Tools:** `list_workspaces`, `list_boards`, `get_board`, `get_card`,
`search_cards`, `list_members`, `create_board`, `create_list`, `create_card`,
`update_card`, `move_card`, `archive_card`, `assign_card`, `unassign_card`,
`add_comment`.

Read-only tools carry `readOnlyHint` and `archive_card` carries
`destructiveHint`, so clients know what is safe to auto-approve. Every agent
change is written to the activity log tagged `source: "mcp"` and shown with a
"via MCP" marker in the board's activity panel.

**Limits:** 300 requests per minute per token. Authentication is personal access
tokens only — OAuth 2.1 is on the roadmap.

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

## Configuration

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `DATABASE_URL` | yes | Postgres connection string. Use the pooled endpoint on serverless hosts — the client sets `prepare: false` so PgBouncer/Neon transaction pooling works. |
| `AUTH_SECRET` | yes | Session signing secret. `openssl rand -base64 32`. |
| `DATABASE_POOL_MAX` | no | Connections per process (default 10). Lower to 1–3 on serverless. |
| `NQM_ALLOW_REMOTE_MIGRATE` | no | Set to `1` to allow `db:migrate` against a non-local host. A safety catch, not a feature. |

Both required variables are validated at startup with an actionable error.

## Commands

| Command | What it does |
| ------- | ------------ |
| `npm run dev` | Dev server |
| `npm run build` | Production build (typechecks and lints) |
| `npm run start` | Serve the production build |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |
| `npm run db:generate` | Diff the schema into a new SQL migration |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Browse the data |

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
