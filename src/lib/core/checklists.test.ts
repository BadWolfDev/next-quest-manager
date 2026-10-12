import { randomUUID } from "node:crypto";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceRole } from "@/db/schema";
import type { SessionUser } from "@/lib/authorize";
import { AuthorizationError } from "@/lib/errors";
import { checklistTitleSchema } from "@/lib/validation";

/**
 * Renaming a checklist, against a real Postgres. Skipped when
 * `TEST_DATABASE_URL` is unset — see `lib/authorize.test.ts` for how to run it.
 *
 * Core calls pass an explicit actor (the MCP path); the action tests leave it
 * out and are resolved from a stubbed Auth.js session (the browser path), so
 * both front doors are exercised against the same implementation.
 */
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/auth", () => ({
  auth: async () => (session.userId ? { user: { id: session.userId } } : null),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

let db: typeof import("@/db").db;
let schema: typeof import("@/db/schema");
let ops: typeof import("@/lib/core/board-ops");
let actions: typeof import("@/actions/card-detail");
let drizzle: typeof import("drizzle-orm");
let mcp: typeof import("@/mcp/server");

const ids = {
  member: "",
  viewer: "",
  outsider: "",
  board: "",
  card: "",
  checklist: "",
};

const actor = (id: string): SessionUser => ({
  id,
  email: `${id}@example.test`,
  name: "Test",
  image: null,
  role: "user",
});

describe("checklistTitleSchema", () => {
  it("trims, and refuses empty or over-long titles", () => {
    expect(checklistTitleSchema.parse("  Launch  ")).toBe("Launch");
    expect(checklistTitleSchema.safeParse("   ").success).toBe(false);
    expect(checklistTitleSchema.safeParse("x".repeat(80)).success).toBe(true);
    expect(checklistTitleSchema.safeParse("x".repeat(81)).success).toBe(false);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("renameChecklist (Postgres)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.AUTH_SECRET ??= "test-secret-at-least-32-characters-long";

    const [
      { runMigrations },
      dbModule,
      schemaModule,
      opsModule,
      actionsModule,
      drizzleModule,
      mcpModule,
    ] = await Promise.all([
      import("../../../scripts/migrate"),
      import("@/db"),
      import("@/db/schema"),
      import("@/lib/core/board-ops"),
      import("@/actions/card-detail"),
      import("drizzle-orm"),
      import("@/mcp/server"),
    ]);
    await runMigrations(TEST_DATABASE_URL!);
    db = dbModule.db;
    schema = schemaModule;
    ops = opsModule;
    actions = actionsModule;
    drizzle = drizzleModule;
    mcp = mcpModule;

    const suffix = randomUUID().slice(0, 8);
    const user = async (label: string) => {
      const [row] = await db
        .insert(schema.users)
        .values({
          email: `${label}-${suffix}@example.test`,
          name: label,
          passwordHash: "not-a-real-hash",
        })
        .returning({ id: schema.users.id });
      return row.id;
    };
    ids.member = await user("member");
    ids.viewer = await user("viewer");
    ids.outsider = await user("outsider");

    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: "Shared", slug: `cl-${suffix}`, createdBy: ids.member })
      .returning({ id: schema.workspaces.id });

    const roles: [string, WorkspaceRole][] = [
      [ids.member, "member"],
      [ids.viewer, "viewer"],
    ];
    await db
      .insert(schema.workspaceMembers)
      .values(
        roles.map(([userId, role]) => ({ workspaceId: ws.id, userId, role })),
      );

    // The outsider has a workspace of their own, so "not found" is about
    // membership of *this* one rather than having no memberships at all.
    const [own] = await db
      .insert(schema.workspaces)
      .values({ name: "Own", slug: `cl-own-${suffix}`, createdBy: ids.outsider })
      .returning({ id: schema.workspaces.id });
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: own.id, userId: ids.outsider, role: "owner" });

    const [b] = await db
      .insert(schema.boards)
      .values({ workspaceId: ws.id, name: "Board", createdBy: ids.member })
      .returning({ id: schema.boards.id });
    const [l] = await db
      .insert(schema.lists)
      .values({ boardId: b.id, name: "To do", position: "a0" })
      .returning({ id: schema.lists.id });
    const [c] = await db
      .insert(schema.cards)
      .values({
        listId: l.id,
        boardId: b.id,
        title: "Card",
        position: "a0",
        createdBy: ids.member,
      })
      .returning({ id: schema.cards.id });
    ids.board = b.id;
    ids.card = c.id;

    const { checklistId } = await ops.createChecklist(
      { cardId: c.id, title: "Shareable Images for pnl" },
      { actor: actor(ids.member) },
    );
    ids.checklist = checklistId;
  });

  beforeEach(() => {
    session.userId = null;
  });

  it("renames for a member, touching the board and logging from/to", async () => {
    const before = await boardUpdatedAt();
    const result = await ops.renameChecklist(
      { checklistId: ids.checklist, title: "Shareable images" },
      { actor: actor(ids.member), source: "mcp" },
    );

    expect(result).toEqual({ boardId: ids.board, changed: true });
    expect(await checklistTitle()).toBe("Shareable images");
    expect((await boardUpdatedAt()).getTime()).toBeGreaterThan(
      before.getTime(),
    );

    const [entry] = await renamedEntries();
    expect(entry.actorId).toBe(ids.member);
    expect(entry.cardId).toBe(ids.card);
    expect(entry.data).toEqual({
      checklistId: ids.checklist,
      from: "Shareable Images for pnl",
      to: "Shareable images",
      source: "mcp",
    });
  });

  it("treats an unchanged title as a no-op: no activity, no touch", async () => {
    const before = await boardUpdatedAt();
    const entries = (await renamedEntries()).length;

    const result = await ops.renameChecklist(
      { checklistId: ids.checklist, title: await checklistTitle() },
      { actor: actor(ids.member) },
    );

    expect(result.changed).toBe(false);
    expect((await boardUpdatedAt()).getTime()).toBe(before.getTime());
    expect(await renamedEntries()).toHaveLength(entries);
  });

  it("refuses a viewer", async () => {
    const title = await checklistTitle();
    await expect(
      ops.renameChecklist(
        { checklistId: ids.checklist, title: "Viewer was here" },
        { actor: actor(ids.viewer) },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(await checklistTitle()).toBe(title);
  });

  it("answers not-found to a non-member, and to an unknown id", async () => {
    for (const checklistId of [ids.checklist, randomUUID()]) {
      const error = await ops
        .renameChecklist(
          { checklistId, title: "Outsider was here" },
          { actor: actor(ids.outsider) },
        )
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AuthorizationError);
    }
    expect(await checklistTitle()).not.toBe("Outsider was here");
  });

  it("renames through the session-resolved server action", async () => {
    session.userId = ids.member;
    const result = await actions.renameChecklistAction(
      { ok: false },
      form({ checklistId: ids.checklist, title: "  From the UI  " }),
    );

    expect(result).toEqual({ ok: true });
    expect(await checklistTitle()).toBe("From the UI");
    const [entry] = await renamedEntries();
    expect(entry.data).toMatchObject({ to: "From the UI" });
    expect(entry.data).not.toHaveProperty("source");
  });

  it("validates at the action boundary before touching data", async () => {
    session.userId = ids.member;
    const title = await checklistTitle();

    for (const bad of ["   ", "x".repeat(81)]) {
      const result = await actions.renameChecklistAction(
        { ok: false },
        form({ checklistId: ids.checklist, title: bad }),
      );
      expect(result.ok).toBe(false);
      expect(result.fields?.title).toBeTruthy();
    }

    const badId = await actions.renameChecklistAction(
      { ok: false },
      form({ checklistId: "not-a-uuid", title: "Fine" }),
    );
    expect(badId.fields?.checklistId).toBeTruthy();
    expect(await checklistTitle()).toBe(title);
  });

  it("refuses a viewer through the action", async () => {
    session.userId = ids.viewer;
    const title = await checklistTitle();
    const result = await actions.renameChecklistAction(
      { ok: false },
      form({ checklistId: ids.checklist, title: "Viewer was here" }),
    );
    expect(result.ok).toBe(false);
    expect(result.fields).toBeUndefined();
    expect(await checklistTitle()).toBe(title);
  });

  it("exposes rename_checklist over MCP, refusing read-only tokens", async () => {
    const tools = new Map<string, ToolHandler>();
    mcp.registerTools({
      registerTool: (name: string, _def: unknown, handler: ToolHandler) =>
        tools.set(name, handler),
    } as unknown as Parameters<typeof mcp.registerTools>[0]);
    const rename = tools.get("rename_checklist")!;
    const ctx = (userId: string, readOnly: boolean) => ({
      http: {
        authInfo: { extra: { ...actor(userId), userId, tokenId: "t", readOnly } },
      },
    });
    const args = { checklist_id: ids.checklist, title: "Over MCP" };

    const refused = await rename(args, ctx(ids.member, true));
    expect(refused.isError).toBe(true);
    expect(await checklistTitle()).not.toBe("Over MCP");

    const denied = await rename(args, ctx(ids.viewer, false));
    expect(denied.isError).toBe(true);

    const ok = await rename(args, ctx(ids.member, false));
    expect(ok.isError).toBeFalsy();
    expect(await checklistTitle()).toBe("Over MCP");
    const [entry] = await renamedEntries();
    expect(entry.data).toMatchObject({ to: "Over MCP", source: "mcp" });
  });
});

type ToolHandler = (
  args: Record<string, unknown>,
  ctx: unknown,
) => Promise<{ isError?: boolean }>;

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

async function checklistTitle() {
  const [row] = await db
    .select({ title: schema.checklists.title })
    .from(schema.checklists)
    .where(drizzle.eq(schema.checklists.id, ids.checklist));
  return row.title;
}

async function boardUpdatedAt() {
  const [row] = await db
    .select({ updatedAt: schema.boards.updatedAt })
    .from(schema.boards)
    .where(drizzle.eq(schema.boards.id, ids.board));
  return row.updatedAt;
}

/** `checklist.renamed` entries for the test card, newest first. */
async function renamedEntries() {
  return db
    .select({
      actorId: schema.activityLog.actorId,
      cardId: schema.activityLog.cardId,
      data: schema.activityLog.data,
    })
    .from(schema.activityLog)
    .where(
      drizzle.and(
        drizzle.eq(schema.activityLog.cardId, ids.card),
        drizzle.eq(schema.activityLog.type, "checklist.renamed"),
      ),
    )
    .orderBy(drizzle.desc(schema.activityLog.createdAt));
}
