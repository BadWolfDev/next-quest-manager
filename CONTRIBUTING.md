# Contributing to Next Quest Manager

Thanks for taking the time. This is a small, opinionated codebase — the rules
below are what keep it coherent.

## Development setup

```bash
git clone https://github.com/BadWolfDev/next-quest-manager.git
cd next-quest-manager
npm install

docker compose up -d db            # Postgres 17 on :5432
cp .env.example .env               # set AUTH_SECRET: openssl rand -base64 32
npm run db:migrate
npm run dev
```

The first account you create on a fresh database becomes the instance
administrator.

## Before you open a PR

```bash
npm run build       # typechecks and lints as part of the build
npm run lint
npm run typecheck
```

All three must be clean. The build fails on lint errors, including the React
Compiler rules (no `setState` in an effect body, no impure calls during render)
— these catch real hydration and correctness bugs, so please fix rather than
suppress them.

## Project conventions

[CLAUDE.md](./CLAUDE.md) is the architectural reference. The rules that matter
most:

- **Every server action, query and MCP tool calls an `authorize()` helper**
  before touching data (`requireUser`, `requireWorkspaceMember`,
  `requireBoardAccess`, …). Those helpers scope rows through
  `workspace_members` **in SQL**. Never fetch broadly and filter afterwards.
- **Migrations are additive.** Production databases exist. Add columns and
  tables; do not rewrite an existing migration. Generate with
  `npm run db:generate` and commit the SQL.
- **Every export of a `"use server"` file is a public HTTP endpoint.** Don't
  leave unused exports there, and never give one an `actor`/`user` parameter —
  that is impersonation by argument. Shared logic that needs an explicit actor
  lives in `src/lib/`, and the action wrapper calls it session-resolved.
- **Board mutations touch `boards.updated_at`** inside the same transaction, so
  other viewers' freshness polling notices the change.
- **Order is fractional-indexed** in `text collate "C"` columns. Don't replace
  it with integers, and don't drop the collation — under a locale collation
  Postgres sorts these keys wrongly.
- **Mutations write an `activity_log` row** in the same transaction, and
  notifications are created there too.
- Never render user content as raw HTML.
- Add an index for every new foreign key and every ordering/lookup column.

UI primitives come from shadcn (`npx shadcn@latest add <name>`); don't hand-write
files in `src/components/ui/`.

## Pull requests

- **Keep them small and focused.** One concern per PR.
- **Say how you verified it.** "Built and clicked through it", "added a failing
  case then fixed it", the actual commands you ran — anything concrete. Security-
  relevant changes should say what you tried that *should* fail and confirmed did.
- Update `README.md` / `CLAUDE.md` when you change behaviour or conventions.
- If you're changing authorization, roles, invites or the MCP surface, please
  describe the threat you considered.

## Reporting bugs and asking for features

Use the issue templates. For anything security-sensitive, do **not** open a
public issue — see [SECURITY.md](./SECURITY.md).
