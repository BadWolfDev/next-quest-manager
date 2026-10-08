import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it, vi } from "vitest";

import type { WorkspaceRole } from "@/db/schema";
import type { SessionUser } from "@/lib/authorize";
import { AuthorizationError, UploadRejectedError } from "@/lib/errors";

/**
 * Card attachments, against a real Postgres, on the Postgres-fallback backend
 * (`BLOB_READ_WRITE_TOKEN` is cleared, except in the one test that sets it,
 * against an in-memory fake of the store's network calls). Skipped when `TEST_DATABASE_URL` is
 * unset — see `lib/authorize.test.ts` for how to run it.
 *
 * Every call passes an explicit actor, so Auth.js is never consulted.
 */
vi.mock("@/auth", () => ({ auth: async () => null }));

/** An in-memory stand-in for the private Blob store's network calls. */
const blobStore = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock("@/lib/attachment-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/attachment-storage")>()),
  putBlobObject: vi.fn(async (pathname: string, bytes: Uint8Array) => {
    blobStore.set(pathname, new Uint8Array(bytes));
    return pathname;
  }),
  getBlobObject: vi.fn(async (pathname: string) => {
    const bytes = blobStore.get(pathname);
    return bytes ? new Blob([bytes as Uint8Array<ArrayBuffer>]).stream() : null;
  }),
  deleteBlobObjects: vi.fn(async (pathnames: string[]) => {
    for (const p of pathnames) blobStore.delete(p);
  }),
}));

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

let db: typeof import("@/db").db;
let schema: typeof import("@/db/schema");
let ops: typeof import("@/lib/core/attachments");
let boardOps: typeof import("@/lib/core/board-ops");
let drizzle: typeof import("drizzle-orm");

const ids = {
  uploader: "",
  otherMember: "",
  admin: "",
  viewer: "",
  outsider: "",
  workspace: "",
  board: "",
  secondBoard: "",
  secondList: "",
  card: "",
  fullCard: "",
};

const actor = (id: string): SessionUser => ({
  id,
  email: `${id}@example.test`,
  name: "Test",
  image: null,
  role: "user",
});

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44,
  0x52,
]);
const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
);

/** A readFile stub that records whether the body was ever read. */
function file(bytes: Uint8Array, filename = "shot.png") {
  const readFile = vi.fn(async () => ({ filename, bytes }));
  return readFile;
}

describe.skipIf(!TEST_DATABASE_URL)("card attachments (Postgres)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.AUTH_SECRET ??= "test-secret-at-least-32-characters-long";
    delete process.env.BLOB_READ_WRITE_TOKEN;

    const [
      { runMigrations },
      dbModule,
      schemaModule,
      opsModule,
      boardOpsModule,
      drizzleModule,
    ] = await Promise.all([
      import("../../../scripts/migrate"),
      import("@/db"),
      import("@/db/schema"),
      import("@/lib/core/attachments"),
      import("@/lib/core/board-ops"),
      import("drizzle-orm"),
    ]);
    await runMigrations(TEST_DATABASE_URL!);
    db = dbModule.db;
    schema = schemaModule;
    ops = opsModule;
    boardOps = boardOpsModule;
    drizzle = drizzleModule;

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
    ids.uploader = await user("uploader");
    ids.otherMember = await user("other-member");
    ids.admin = await user("admin");
    ids.viewer = await user("viewer");
    ids.outsider = await user("outsider");

    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: "Shared", slug: `att-${suffix}`, createdBy: ids.admin })
      .returning({ id: schema.workspaces.id });
    ids.workspace = ws.id;

    const roles: [string, WorkspaceRole][] = [
      [ids.uploader, "member"],
      [ids.otherMember, "member"],
      [ids.admin, "admin"],
      [ids.viewer, "viewer"],
    ];
    await db
      .insert(schema.workspaceMembers)
      .values(
        roles.map(([userId, role]) => ({ workspaceId: ws.id, userId, role })),
      );

    const board = async (name: string) => {
      const [b] = await db
        .insert(schema.boards)
        .values({ workspaceId: ws.id, name, createdBy: ids.admin })
        .returning({ id: schema.boards.id });
      const [l] = await db
        .insert(schema.lists)
        .values({ boardId: b.id, name: "To do", position: "a0" })
        .returning({ id: schema.lists.id });
      return { boardId: b.id, listId: l.id };
    };
    const first = await board("Board");
    const second = await board("Second board");
    ids.board = first.boardId;
    ids.secondBoard = second.boardId;
    ids.secondList = second.listId;

    const card = async (title: string, position: string) => {
      const [c] = await db
        .insert(schema.cards)
        .values({
          listId: first.listId,
          boardId: first.boardId,
          title,
          position,
          createdBy: ids.uploader,
        })
        .returning({ id: schema.cards.id });
      return c.id;
    };
    ids.card = await card("Card", "a0");
    ids.fullCard = await card("Full card", "a1");

    // Fill one card to the cap directly, without spending rate-limit budget.
    const { MAX_ATTACHMENTS_PER_CARD } = await import("@/lib/attachments");
    await db.insert(schema.cardAttachments).values(
      Array.from({ length: MAX_ATTACHMENTS_PER_CARD }, (_, i) => ({
        cardId: ids.fullCard,
        boardId: ids.board,
        uploaderId: ids.uploader,
        filename: `${i}.png`,
        contentType: "image/png",
        byteSize: PNG.byteLength,
        storage: "postgres" as const,
        data: Buffer.from(PNG),
      })),
    );
  });

  it("stores an upload in Postgres, sniffing the type and sanitising the name", async () => {
    const before = await boardUpdatedAt();
    const { attachment, boardId } = await ops.uploadAttachment(
      { cardId: ids.card, readFile: file(PNG, "../../evil\u202egpj.exe") },
      { actor: actor(ids.uploader) },
    );

    expect(boardId).toBe(ids.board);
    expect(attachment.contentType).toBe("image/png");
    expect(attachment.filename).toBe("evilgpj.exe");

    const [row] = await db
      .select()
      .from(schema.cardAttachments)
      .where(drizzle.eq(schema.cardAttachments.id, attachment.id));
    expect(row.storage).toBe("postgres");
    expect(row.blobPathname).toBeNull();
    expect(new Uint8Array(row.data!)).toEqual(PNG);
    expect(row.boardId).toBe(ids.board);
    expect(row.uploaderId).toBe(ids.uploader);

    const activity = await db
      .select({ type: schema.activityLog.type })
      .from(schema.activityLog)
      .where(drizzle.eq(schema.activityLog.cardId, ids.card));
    expect(activity.map((a) => a.type)).toContain("attachment.added");
    expect((await boardUpdatedAt()).getTime()).toBeGreaterThanOrEqual(
      before.getTime(),
    );
  });

  it("refuses a viewer and an outsider before reading the body", async () => {
    for (const who of [ids.viewer, ids.outsider]) {
      const readFile = file(PNG);
      await expect(
        ops.uploadAttachment(
          { cardId: ids.card, readFile },
          { actor: actor(who) },
        ),
      ).rejects.toBeInstanceOf(AuthorizationError);
      expect(readFile).not.toHaveBeenCalled();
    }
  });

  it("refuses a full card before reading the body", async () => {
    const readFile = file(PNG);
    await expect(
      ops.uploadAttachment(
        { cardId: ids.fullCard, readFile },
        { actor: actor(ids.uploader) },
      ),
    ).rejects.toBeInstanceOf(UploadRejectedError);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("accepts SVG and other non-images, stored and served as opaque downloads", async () => {
    const { attachment } = await ops.uploadAttachment(
      { cardId: ids.card, readFile: file(SVG, "innocent.png") },
      { actor: actor(ids.uploader) },
    );
    expect(attachment.contentType).toBe("application/octet-stream");
    expect(attachment.filename).toBe("innocent.png");

    const opened = await ops.openAttachment(attachment.id, actor(ids.viewer));
    if (!opened || opened.notModified) throw new Error("expected bytes");
    const { servedAs } = await import("@/lib/attachments");
    const served = servedAs(opened.contentType, opened.filename);
    expect(served.inline).toBe(false);
    expect(served.contentType).toBe("application/octet-stream");
    expect(served.contentDisposition.startsWith("attachment;")).toBe(true);
  });

  it("rejects an empty file", async () => {
    const error = await ops
      .uploadAttachment(
        { cardId: ids.card, readFile: file(new Uint8Array(), "empty.txt") },
        { actor: actor(ids.uploader) },
      )
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UploadRejectedError);
  });

  it("enforces the single per-file cap", async () => {
    const { MAX_ATTACHMENT_BYTES } = await import("@/lib/attachments");
    const big = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
    big.set(PNG);
    const readFile = vi.fn(async (maxBytes: number) => {
      expect(maxBytes).toBe(MAX_ATTACHMENT_BYTES);
      return { filename: "big.png", bytes: big };
    });
    const error = await ops
      .uploadAttachment(
        { cardId: ids.card, readFile },
        { actor: actor(ids.uploader) },
      )
      .catch((e: unknown) => e);
    expect((error as UploadRejectedError).status).toBe(413);
  });

  it("stores in the private Blob store when configured, and deletes the object with the row", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_fake_for_tests";
    try {
      const { attachment } = await ops.uploadAttachment(
        { cardId: ids.card, readFile: file(PNG, "shot.png") },
        { actor: actor(ids.uploader) },
      );
      const [row] = await db
        .select()
        .from(schema.cardAttachments)
        .where(drizzle.eq(schema.cardAttachments.id, attachment.id));
      expect(row.storage).toBe("blob");
      expect(row.data).toBeNull();
      expect(row.blobPathname).toBe(`attachments/${attachment.id}`);
      expect(blobStore.get(row.blobPathname!)).toEqual(PNG);

      const opened = await ops.openAttachment(attachment.id, actor(ids.viewer));
      expect(opened && !opened.notModified && opened.contentType).toBe(
        "image/png",
      );

      await ops.deleteAttachment(
        { attachmentId: attachment.id },
        { actor: actor(ids.uploader) },
      );
      expect(blobStore.has(row.blobPathname!)).toBe(false);
    } finally {
      delete process.env.BLOB_READ_WRITE_TOKEN;
    }
  });

  it("serves bytes to a viewer and 404s an outsider", async () => {
    const { attachment } = await ops.uploadAttachment(
      { cardId: ids.card, readFile: file(PNG) },
      { actor: actor(ids.uploader) },
    );

    const opened = await ops.openAttachment(attachment.id, actor(ids.viewer));
    if (!opened || opened.notModified) throw new Error("expected bytes");
    expect(opened.contentType).toBe("image/png");
    expect(opened.etag).toBe(`"${attachment.id}"`);
    // The Postgres fallback hands back the driver's Buffer uncopied.
    expect(new Uint8Array(opened.body as Uint8Array)).toEqual(PNG);

    await expect(
      ops.openAttachment(attachment.id, actor(ids.outsider)),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      ops.openAttachment(randomUUID(), actor(ids.uploader)),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("answers a matching If-None-Match with not-modified only after authorization", async () => {
    const { attachment } = await ops.uploadAttachment(
      { cardId: ids.card, readFile: file(PNG) },
      { actor: actor(ids.uploader) },
    );
    const etag = `"${attachment.id}"`;

    const revalidated = await ops.openAttachment(attachment.id, actor(ids.viewer), {
      ifNoneMatch: etag,
    });
    expect(revalidated).toEqual({ notModified: true, etag });

    const stale = await ops.openAttachment(attachment.id, actor(ids.viewer), {
      ifNoneMatch: '"something-else"',
    });
    expect(stale?.notModified).toBe(false);

    // An outsider presenting the right validator still gets "not found".
    await expect(
      ops.openAttachment(attachment.id, actor(ids.outsider), { ifNoneMatch: etag }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    // So does anyone, once the attachment is gone.
    await ops.deleteAttachment(
      { attachmentId: attachment.id },
      { actor: actor(ids.uploader) },
    );
    await expect(
      ops.openAttachment(attachment.id, actor(ids.uploader), { ifNoneMatch: etag }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("lists metadata on the card without bytes, with the delete rule applied", async () => {
    const asOther = await boardOps.getCardModalData(
      ids.card,
      actor(ids.otherMember),
    );
    expect(asOther.attachments.length).toBeGreaterThan(0);
    for (const a of asOther.attachments) {
      expect(a).not.toHaveProperty("data");
      expect(a).not.toHaveProperty("blobPathname");
      expect(a.canDelete).toBe(false);
    }
    const asAdmin = await boardOps.getCardModalData(ids.card, actor(ids.admin));
    expect(asAdmin.attachments.every((a) => a.canDelete)).toBe(true);
  });

  it("lets the uploader or an admin delete, but not another member or a viewer", async () => {
    const upload = () =>
      ops.uploadAttachment(
        { cardId: ids.card, readFile: file(PNG) },
        { actor: actor(ids.uploader) },
      );

    const first = await upload();
    for (const who of [ids.otherMember, ids.viewer, ids.outsider]) {
      await expect(
        ops.deleteAttachment(
          { attachmentId: first.attachment.id },
          { actor: actor(who) },
        ),
      ).rejects.toBeInstanceOf(AuthorizationError);
    }

    await ops.deleteAttachment(
      { attachmentId: first.attachment.id },
      { actor: actor(ids.uploader) },
    );
    const second = await upload();
    await ops.deleteAttachment(
      { attachmentId: second.attachment.id },
      { actor: actor(ids.admin), source: "mcp" },
    );

    const left = await db
      .select({ id: schema.cardAttachments.id })
      .from(schema.cardAttachments)
      .where(
        drizzle.inArray(schema.cardAttachments.id, [
          first.attachment.id,
          second.attachment.id,
        ]),
      );
    expect(left).toHaveLength(0);

    const deletions = await db
      .select({ data: schema.activityLog.data })
      .from(schema.activityLog)
      .where(
        drizzle.and(
          drizzle.eq(schema.activityLog.cardId, ids.card),
          drizzle.eq(schema.activityLog.type, "attachment.deleted"),
        ),
      );
    const ours = deletions.filter((d) =>
      ([first.attachment.id, second.attachment.id] as string[]).includes(
        d.data.attachmentId as string,
      ),
    );
    expect(ours).toHaveLength(2);
    expect(ours.some((d) => d.data.source === "mcp")).toBe(true);
  });

  it("logs a concurrent double delete exactly once", async () => {
    const { attachment } = await ops.uploadAttachment(
      { cardId: ids.card, readFile: file(PNG) },
      { actor: actor(ids.uploader) },
    );
    const remove = () =>
      ops.deleteAttachment(
        { attachmentId: attachment.id },
        { actor: actor(ids.uploader) },
      );

    const results = await Promise.allSettled([remove(), remove()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(AuthorizationError);

    const entries = await db
      .select({ data: schema.activityLog.data })
      .from(schema.activityLog)
      .where(
        drizzle.and(
          drizzle.eq(schema.activityLog.cardId, ids.card),
          drizzle.eq(schema.activityLog.type, "attachment.deleted"),
        ),
      );
    expect(
      entries.filter((e) => e.data.attachmentId === attachment.id),
    ).toHaveLength(1);
  });

  it("counts per card and follows the card to another board", async () => {
    const counts = await ops.attachmentCountsForBoard(ids.board);
    expect(counts.get(ids.fullCard)).toBe(20);
    expect(counts.get(ids.card)).toBeGreaterThan(0);

    await boardOps.moveCardToBoard(
      { cardId: ids.card, targetListId: ids.secondList },
      { actor: actor(ids.uploader) },
    );

    const rows = await db
      .select({ boardId: schema.cardAttachments.boardId })
      .from(schema.cardAttachments)
      .where(drizzle.eq(schema.cardAttachments.cardId, ids.card));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.boardId === ids.secondBoard)).toBe(true);
    expect((await ops.attachmentCountsForBoard(ids.board)).has(ids.card)).toBe(
      false,
    );
  });
});

async function boardUpdatedAt() {
  const [row] = await db
    .select({ updatedAt: schema.boards.updatedAt })
    .from(schema.boards)
    .where(drizzle.eq(schema.boards.id, ids.board));
  return row.updatedAt;
}
