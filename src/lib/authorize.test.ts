import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it, vi } from "vitest";

import type { WorkspaceRole } from "@/db/schema";
import { AuthorizationError } from "@/lib/errors";
import type { SessionUser } from "@/lib/authorize";

/**
 * Authorization, against a real Postgres.
 *
 * The `authorize()` helpers are membership joins — their whole point is that a
 * row the caller has no membership for never leaves the database. That cannot
 * be proved with a mocked query builder, so these run against a throwaway
 * database and are skipped when `TEST_DATABASE_URL` is unset:
 *
 *   docker compose up -d db
 *   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/nextquest_test \
 *     npm test
 *
 * Auth.js is mocked away entirely. Every call here passes an explicit `actor`,
 * exactly as the MCP front door does, so nothing ever reaches a session.
 */
vi.mock("@/auth", () => ({ auth: async () => null }));

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

type Authorize = typeof import("@/lib/authorize");
type Schema = typeof import("@/db/schema");

let authorize: Authorize;
let db: typeof import("@/db").db;
let schema: Schema;

/** Fixtures, all created once. */
const ids = {
  memberUser: "",
  viewerUser: "",
  outsiderUser: "",
  workspace: "",
  otherWorkspace: "",
  board: "",
  otherBoard: "",
  list: "",
  card: "",
  otherCard: "",
};

function actorFor(userId: string): SessionUser {
  return {
    id: userId,
    email: `${userId}@example.test`,
    name: "Test",
    image: null,
    role: "user",
  };
}

describe.skipIf(!TEST_DATABASE_URL)("authorize (Postgres)", () => {
  beforeAll(async () => {
    // `db/index.ts` opens its pool as a module side effect, so the environment
    // has to be in place before it is imported.
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.AUTH_SECRET ??= "test-secret-at-least-32-characters-long";

    const [{ runMigrations }, dbModule, schemaModule, authorizeModule] =
      await Promise.all([
        import("../../scripts/migrate"),
        import("@/db"),
        import("@/db/schema"),
        import("@/lib/authorize"),
      ]);

    await runMigrations(TEST_DATABASE_URL!);

    db = dbModule.db;
    schema = schemaModule;
    authorize = authorizeModule;

    const suffix = randomUUID().slice(0, 8);

    const insertUser = async (label: string) => {
      const [row] = await db
        .insert(schema.users)
        .values({
          email: `${label}-${suffix}@example.test`,
          name: label,
          // Never verified here — every call passes an explicit actor.
          passwordHash: "not-a-real-hash",
        })
        .returning({ id: schema.users.id });
      return row.id;
    };

    ids.memberUser = await insertUser("member");
    ids.viewerUser = await insertUser("viewer");
    ids.outsiderUser = await insertUser("outsider");

    const insertWorkspace = async (label: string, createdBy: string) => {
      const [row] = await db
        .insert(schema.workspaces)
        .values({
          name: label,
          slug: `${label}-${suffix}`,
          createdBy,
        })
        .returning({ id: schema.workspaces.id });
      return row.id;
    };

    ids.workspace = await insertWorkspace("shared", ids.memberUser);
    // A second workspace the outsider *does* belong to, so a failure below is
    // "no membership in this workspace" rather than "no memberships at all".
    ids.otherWorkspace = await insertWorkspace("private", ids.outsiderUser);

    await db.insert(schema.workspaceMembers).values([
      { workspaceId: ids.workspace, userId: ids.memberUser, role: "member" },
      { workspaceId: ids.workspace, userId: ids.viewerUser, role: "viewer" },
      {
        workspaceId: ids.otherWorkspace,
        userId: ids.outsiderUser,
        role: "owner",
      },
    ]);

    const insertBoard = async (workspaceId: string, name: string) => {
      const [row] = await db
        .insert(schema.boards)
        .values({ workspaceId, name, createdBy: ids.memberUser })
        .returning({ id: schema.boards.id });
      return row.id;
    };

    ids.board = await insertBoard(ids.workspace, "Shared board");
    ids.otherBoard = await insertBoard(ids.otherWorkspace, "Private board");

    const [list] = await db
      .insert(schema.lists)
      .values({ boardId: ids.board, name: "To do", position: "a0" })
      .returning({ id: schema.lists.id });
    ids.list = list.id;

    const [otherList] = await db
      .insert(schema.lists)
      .values({ boardId: ids.otherBoard, name: "To do", position: "a0" })
      .returning({ id: schema.lists.id });

    const [card] = await db
      .insert(schema.cards)
      .values({
        listId: ids.list,
        boardId: ids.board,
        title: "A card",
        position: "a0",
        createdBy: ids.memberUser,
      })
      .returning({ id: schema.cards.id });
    ids.card = card.id;

    const [otherCard] = await db
      .insert(schema.cards)
      .values({
        listId: otherList.id,
        boardId: ids.otherBoard,
        title: "Secret",
        position: "a0",
        createdBy: ids.outsiderUser,
      })
      .returning({ id: schema.cards.id });
    ids.otherCard = otherCard.id;
  });

  describe("a non-member", () => {
    it("cannot reach the workspace", async () => {
      await expect(
        authorize.requireWorkspaceMember(
          ids.workspace,
          "viewer",
          actorFor(ids.outsiderUser),
        ),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    it("cannot reach the board, even read-only", async () => {
      await expect(
        authorize.requireBoardAccess(
          ids.board,
          authorize.READ_MIN_ROLE,
          actorFor(ids.outsiderUser),
        ),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    it("cannot reach the list", async () => {
      await expect(
        authorize.requireListAccess(
          ids.list,
          authorize.READ_MIN_ROLE,
          actorFor(ids.outsiderUser),
        ),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    it("cannot reach the card", async () => {
      await expect(
        authorize.requireCardAccess(
          ids.card,
          authorize.READ_MIN_ROLE,
          actorFor(ids.outsiderUser),
        ),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    it("gets the same answer as for a board that does not exist", async () => {
      // Existence is not disclosed: an invisible board and an absent one are
      // indistinguishable to the caller.
      const invisible = await authorize
        .requireBoardAccess(ids.board, "viewer", actorFor(ids.outsiderUser))
        .catch((e: Error) => e.message);
      const absent = await authorize
        .requireBoardAccess(randomUUID(), "viewer", actorFor(ids.outsiderUser))
        .catch((e: Error) => e.message);
      expect(invisible).toBe(absent);
    });

    it("still reaches their own workspace, so this is scoping not a blanket deny", async () => {
      const ctx = await authorize.requireBoardAccess(
        ids.otherBoard,
        "owner",
        actorFor(ids.outsiderUser),
      );
      expect(ctx.board.id).toBe(ids.otherBoard);
    });
  });

  describe("a viewer", () => {
    const viewer = () => actorFor(ids.viewerUser);

    it("reads the board at READ_MIN_ROLE", async () => {
      const ctx = await authorize.requireBoardAccess(
        ids.board,
        authorize.READ_MIN_ROLE,
        viewer(),
      );
      expect(ctx.board.id).toBe(ids.board);
      expect(ctx.role).toBe("viewer");
      expect(ctx.workspace.id).toBe(ids.workspace);
    });

    it("reads the card at READ_MIN_ROLE", async () => {
      const ctx = await authorize.requireCardAccess(
        ids.card,
        authorize.READ_MIN_ROLE,
        viewer(),
      );
      expect(ctx.board.id).toBe(ids.board);
    });

    it("fails the default write floor on a board", async () => {
      await expect(
        authorize.requireBoardAccess(ids.board, undefined, viewer()),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    it("fails the default write floor on a list", async () => {
      await expect(
        authorize.requireListAccess(ids.list, undefined, viewer()),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    it("fails the default write floor on a card", async () => {
      await expect(
        authorize.requireCardAccess(ids.card, undefined, viewer()),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    it("is told which role it lacks — the resource is not secret from a member", async () => {
      await expect(
        authorize.requireBoardAccess(ids.board, "member", viewer()),
      ).rejects.toThrow(/requires the member role/);
    });

    it("fails every role above the write floor too", async () => {
      for (const role of ["member", "admin", "owner"] as WorkspaceRole[]) {
        await expect(
          authorize.requireWorkspaceMember(ids.workspace, role, viewer()),
        ).rejects.toBeInstanceOf(AuthorizationError);
      }
    });
  });

  describe("a member", () => {
    const member = () => actorFor(ids.memberUser);

    it("passes the default write floor on the board", async () => {
      const ctx = await authorize.requireBoardAccess(
        ids.board,
        undefined,
        member(),
      );
      expect(ctx.role).toBe("member");
      expect(ctx.board.name).toBe("Shared board");
    });

    it("passes on the list, resolving the owning board", async () => {
      const ctx = await authorize.requireListAccess(
        ids.list,
        undefined,
        member(),
      );
      expect(ctx.board.id).toBe(ids.board);
    });

    it("passes on the card, resolving the owning board", async () => {
      const ctx = await authorize.requireCardAccess(
        ids.card,
        undefined,
        member(),
      );
      expect(ctx.board.id).toBe(ids.board);
      expect(ctx.workspace.id).toBe(ids.workspace);
    });

    it("resolves the workspace by slug as well as by id", async () => {
      const byId = await authorize.requireWorkspaceMember(
        ids.workspace,
        "member",
        member(),
      );
      const bySlug = await authorize.requireWorkspaceMemberBySlug(
        byId.workspace.slug,
        "member",
        member(),
      );
      expect(bySlug.workspace.id).toBe(ids.workspace);
    });

    it("is still refused admin and owner actions", async () => {
      for (const role of ["admin", "owner"] as WorkspaceRole[]) {
        await expect(
          authorize.requireWorkspaceMember(ids.workspace, role, member()),
        ).rejects.toBeInstanceOf(AuthorizationError);
      }
    });

    it("cannot reach another workspace's card", async () => {
      await expect(
        authorize.requireCardAccess(
          ids.otherCard,
          authorize.READ_MIN_ROLE,
          member(),
        ),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });
  });

  describe("roleSatisfies", () => {
    it("ranks owner > admin > member > viewer", async () => {
      const { roleSatisfies } = authorize;
      expect(roleSatisfies("owner", "admin")).toBe(true);
      expect(roleSatisfies("admin", "member")).toBe(true);
      expect(roleSatisfies("member", "viewer")).toBe(true);
      expect(roleSatisfies("viewer", "member")).toBe(false);
      expect(roleSatisfies("member", "admin")).toBe(false);
      expect(roleSatisfies("admin", "owner")).toBe(false);
    });

    it("is reflexive", async () => {
      for (const role of ["viewer", "member", "admin", "owner"] as const) {
        expect(authorize.roleSatisfies(role, role)).toBe(true);
      }
    });

    it("defaults the write floor to member", () => {
      expect(authorize.WRITE_MIN_ROLE).toBe("member");
      expect(authorize.READ_MIN_ROLE).toBe("viewer");
    });
  });
});
