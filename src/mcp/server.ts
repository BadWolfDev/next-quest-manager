import "server-only";

import { logError } from "@/lib/log-error";

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  addComment,
  archiveCard,
  assignCard,
  unassignCard,
  createBoard,
  createCard,
  createList,
  getBoardStructure,
  getCardDetail,
  moveCard,
  resolvePlacement,
  searchCards,
  updateCard,
} from "@/lib/core/board-ops";
import { listAssignableMembersFor } from "@/lib/core/members";
import type { Actor } from "@/lib/authorize";
import { listMyWorkspaces, listWorkspaceBoards } from "@/lib/queries";
import { AuthenticationError, AuthorizationError } from "@/lib/errors";

/**
 * The Next Quest Manager MCP tool surface.
 *
 * Every handler runs as the user who owns the bearer token, and every one goes
 * through the same `authorize()` helpers the web UI uses — see
 * `lib/core/board-ops`. There is no MCP-specific authorization path and no
 * duplicated position logic.
 */

export const SERVER_NAME = "next-quest-manager";
export const SERVER_VERSION = "0.1.0";

export const SERVER_INSTRUCTIONS = `Next Quest Manager is a kanban board. Work is organised as
workspaces → boards → lists → cards.

Start with \`list_workspaces\` to find the workspace you need, then \`list_boards\`
and \`get_board\` to see its lists and cards. \`get_board\` returns every list with
its cards in display order, which is usually enough context to act.

Ids are UUIDs and are stable — pass them back verbatim. When placing a card use
\`move_card\` with position "top" or "bottom", or {"after_card_id": "<uuid>"} to
put it directly below a specific card.

You only ever see workspaces the token's owner is a member of. Read-only tokens
can call the list/get/search tools but every mutating tool will refuse.`;

export type McpActorContext = {
  actor: Actor;
  readOnly: boolean;
};

/**
 * Shape stashed in `AuthInfo.extra` by the route's `verifyToken`.
 */
export type McpTokenExtra = {
  userId: string;
  email: string;
  name: string;
  image: string | null;
  role: "user" | "admin";
  tokenId: string;
  readOnly: boolean;
};

/** Minimal view of the SDK's per-call handler context that we rely on. */
type ToolCtx = { http?: { authInfo?: { extra?: unknown } } };

/**
 * Derive the acting user from the *per-call* context.
 *
 * The SDK hands each tool invocation the `AuthInfo` that mcp-handler verified
 * for that HTTP request, so the actor is read fresh per call. Nothing about the
 * caller is held in module scope, which is what keeps concurrent requests from
 * ever seeing each other's identity.
 */
function actorFrom(ctx: ToolCtx): McpActorContext | null {
  const extra = ctx?.http?.authInfo?.extra as McpTokenExtra | undefined;
  if (!extra?.userId) return null;
  return {
    actor: {
      id: extra.userId,
      email: extra.email,
      name: extra.name,
      image: extra.image,
      role: extra.role,
    },
    readOnly: extra.readOnly,
  };
}

/** Text result helper — MCP content blocks. */
function text(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

/**
 * Translate domain errors into MCP tool errors.
 *
 * Authorization failures deliberately say only that the resource is not
 * available — the agent must not be able to probe for the existence of boards
 * its token cannot see.
 */
async function guard<T>(run: () => Promise<T>) {
  try {
    return { ok: true as const, value: await run() };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return {
        ok: false as const,
        message:
          "Not found, or this token's owner does not have access to it.",
      };
    }
    if (error instanceof AuthenticationError) {
      return { ok: false as const, message: "This token is no longer valid." };
    }
    if (error instanceof z.ZodError) {
      return {
        ok: false as const,
        message: `Invalid arguments: ${error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ")}`,
      };
    }
    logError("[mcp] tool failed:", error);
    return { ok: false as const, message: "The operation failed." };
  }
}

const uuid = z.uuid();

export function registerTools(server: McpServer) {
  /** Wrap a mutating handler so read-only tokens are refused consistently. */
  function mutating<A>(
    handler: (args: A, ctx: McpActorContext) => Promise<unknown>,
  ) {
    return async (args: A, ctx: ToolCtx) => {
      const who = actorFrom(ctx);
      if (!who) return errorResult("This request is not authenticated.");
      if (who.readOnly) {
        return errorResult(
          "This token is read-only. Create a token without the read-only flag to make changes.",
        );
      }
      const result = await guard(() => handler(args, who));
      return result.ok ? text(result.value) : errorResult(result.message);
    };
  }

  function reading<A>(
    handler: (args: A, ctx: McpActorContext) => Promise<unknown>,
  ) {
    return async (args: A, ctx: ToolCtx) => {
      const who = actorFrom(ctx);
      if (!who) return errorResult("This request is not authenticated.");
      const result = await guard(() => handler(args, who));
      return result.ok ? text(result.value) : errorResult(result.message);
    };
  }

  /* ------------------------------ reads ------------------------------ */

  server.registerTool(
    "list_workspaces",
    {
      title: "List workspaces",
      description:
        "List every workspace the token's owner belongs to, with their ids, slugs and the owner's role.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    reading(async (_args, { actor }) => {
      const rows = await listMyWorkspaces(actor);
      return rows.map((w) => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
        role: w.role,
      }));
    }),
  );

  server.registerTool(
    "list_boards",
    {
      title: "List boards",
      description:
        "List the boards in a workspace. Pass the workspace id from list_workspaces.",
      inputSchema: z.object({
        workspace_id: uuid.describe("Workspace id from list_workspaces."),
        include_archived: z
          .boolean()
          .default(false)
          .describe("Include archived boards."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    reading(async ({ workspace_id, include_archived }, { actor }) => {
      const rows = await listWorkspaceBoards(
        workspace_id,
        { includeArchived: include_archived },
        actor,
      );
      return rows.map((b) => ({
        id: b.id,
        name: b.name,
        archived: Boolean(b.archivedAt),
        updated_at: b.updatedAt.toISOString(),
      }));
    }),
  );

  server.registerTool(
    "get_board",
    {
      title: "Get board",
      description:
        "Get a board with all of its lists and the cards in each, in display order. This is the main way to see the state of a board.",
      inputSchema: z.object({
        board_id: uuid.describe("Board id from list_boards."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    reading(async ({ board_id }, { actor }) => {
      const page = await getBoardStructure(board_id, actor);
      return {
        id: page.board.id,
        name: page.board.name,
        workspace: { id: page.workspace.id, name: page.workspace.name },
        lists: page.lists.map((l) => ({
          id: l.id,
          name: l.name,
          cards: l.cards.map((c) => ({
            id: c.id,
            title: c.title,
            description: c.description ?? undefined,
            due_date: c.dueDate?.toISOString(),
            assignees: c.assignees.map((a) => ({
              user_id: a.userId,
              name: a.name,
            })),
          })),
        })),
      };
    }),
  );

  server.registerTool(
    "get_card",
    {
      title: "Get card",
      description:
        "Get one card in full: description, due date, which list it is in, and its comments.",
      inputSchema: z.object({ card_id: uuid }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    reading(async ({ card_id }, { actor }) => {
      const detail = await getCardDetail(card_id, actor);
      return {
        id: detail.card.id,
        title: detail.card.title,
        description: detail.card.description ?? undefined,
        due_date: detail.card.dueDate?.toISOString(),
        archived: Boolean(detail.card.archivedAt),
        list: { id: detail.card.listId, name: detail.card.listName },
        board: { id: detail.board.id, name: detail.board.name },
        assignees: detail.assignees.map((a) => ({
          user_id: a.userId,
          name: a.name,
        })),
        comments: detail.comments.map((c) => ({
          id: c.id,
          author: c.authorName ?? "(deleted user)",
          body: c.body,
          created_at: c.createdAt.toISOString(),
        })),
      };
    }),
  );

  server.registerTool(
    "search_cards",
    {
      title: "Search cards",
      description:
        "Find cards whose title or description contains the query text, across every board the token's owner can see. Optionally restrict to one workspace.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(200),
        workspace_id: uuid
          .nullish()
          .describe("Restrict the search to one workspace."),
        limit: z.number().int().min(1).max(100).default(25),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    reading(async ({ query, workspace_id, limit }, { actor }) => {
      const rows = await searchCards(
        { query, workspaceId: workspace_id ?? null, limit },
        actor,
      );
      return rows.map((r) => ({
        card_id: r.cardId,
        title: r.title,
        list: r.listName,
        board: { id: r.boardId, name: r.boardName },
        workspace: r.workspaceName,
        due_date: r.dueDate?.toISOString(),
      }));
    }),
  );

  /* ---------------------------- mutations ---------------------------- */

  server.registerTool(
    "create_board",
    {
      title: "Create board",
      description:
        "Create a board in a workspace. It starts with Backlog / In Progress / Done lists and a starter label set.",
      inputSchema: z.object({
        workspace_id: uuid,
        name: z.string().trim().min(1).max(80),
        background: z
          .string()
          .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
          .default("#6366f1")
          .describe("Hex colour for the board tile."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    mutating(async ({ workspace_id, name, background }, { actor }) => {
      const opts = { actor, source: "mcp" as const };
      const { boardId } = await createBoard(
        { workspaceId: workspace_id, name, background },
        opts,
      );
      return { board_id: boardId, name };
    }),
  );

  server.registerTool(
    "create_list",
    {
      title: "Create list",
      description: "Add a list to the right-hand end of a board.",
      inputSchema: z.object({
        board_id: uuid,
        name: z.string().trim().min(1).max(80),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    mutating(async ({ board_id, name }, { actor }) => {
      const opts = { actor, source: "mcp" as const };
      const { listId } = await createList({ boardId: board_id, name }, opts);
      return { list_id: listId, name };
    }),
  );

  server.registerTool(
    "create_card",
    {
      title: "Create card",
      description:
        "Add a card to the bottom of a list. The description is markdown.",
      inputSchema: z.object({
        list_id: uuid,
        title: z.string().trim().min(1).max(500),
        description: z.string().max(20_000).nullish(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    mutating(async ({ list_id, title, description }, { actor }) => {
      const opts = { actor, source: "mcp" as const };
      const { cardId } = await createCard(
        { listId: list_id, title, description: description ?? null },
        opts,
      );
      return { card_id: cardId, title };
    }),
  );

  server.registerTool(
    "update_card",
    {
      title: "Update card",
      description:
        "Change a card's title, description or due date. Omit a field to leave it unchanged; pass null to clear the description or due date.",
      inputSchema: z.object({
        card_id: uuid,
        title: z.string().trim().min(1).max(500).optional(),
        description: z.string().max(20_000).nullish(),
        due_date: z
          .string()
          .nullish()
          .describe("ISO 8601 timestamp, or null to clear."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    mutating(async ({ card_id, title, description, due_date }, { actor }) => {
      const opts = { actor, source: "mcp" as const };
      let dueDate: Date | null | undefined;
      if (due_date === undefined) dueDate = undefined;
      else if (due_date === null) dueDate = null;
      else {
        const parsed = new Date(due_date);
        if (Number.isNaN(parsed.getTime())) {
          throw new z.ZodError([
            {
              code: "custom",
              path: ["due_date"],
              message: "Not a valid ISO 8601 timestamp.",
            },
          ]);
        }
        dueDate = parsed;
      }

      await updateCard(
        {
          cardId: card_id,
          ...(title !== undefined ? { title } : {}),
          ...(description !== undefined
            ? { description: description ?? null }
            : {}),
          ...(dueDate !== undefined ? { dueDate } : {}),
        },
        opts,
      );
      return { card_id, updated: true };
    }),
  );

  server.registerTool(
    "move_card",
    {
      title: "Move card",
      description:
        'Move a card to a list and position it. Position is "top", "bottom", or an object {"after_card_id": "<uuid>"} to place it directly below that card.',
      inputSchema: z.object({
        card_id: uuid,
        target_list_id: uuid,
        position: z
          .union([
            z.literal("top"),
            z.literal("bottom"),
            z.object({ after_card_id: uuid }),
          ])
          .default("bottom"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    mutating(async ({ card_id, target_list_id, position }, { actor }) => {
      const opts = { actor, source: "mcp" as const };
      const placement =
        typeof position === "string"
          ? position
          : { afterCardId: position.after_card_id };

      const { afterCardId, beforeCardId } = await resolvePlacement(
        target_list_id,
        placement,
        card_id,
      );

      await moveCard(
        {
          cardId: card_id,
          targetListId: target_list_id,
          afterCardId,
          beforeCardId,
        },
        opts,
      );
      return { card_id, moved: true };
    }),
  );

  server.registerTool(
    "archive_card",
    {
      title: "Archive card",
      description:
        "Archive a card. It disappears from the board but is not deleted and can be restored later.",
      inputSchema: z.object({ card_id: uuid }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    mutating(async ({ card_id }, { actor }) => {
      const opts = { actor, source: "mcp" as const };
      await archiveCard({ cardId: card_id }, opts);
      return { card_id, archived: true };
    }),
  );

  server.registerTool(
    "add_comment",
    {
      title: "Add comment",
      description:
        "Post a comment on a card, authored by the token's owner. The body is markdown.",
      inputSchema: z.object({
        card_id: uuid,
        body: z.string().trim().min(1).max(20_000),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    mutating(async ({ card_id, body }, { actor }) => {
      const opts = { actor, source: "mcp" as const };
      const { commentId } = await addComment({ cardId: card_id, body }, opts);
      return { comment_id: commentId };
    }),
  );
  server.registerTool(
    "list_members",
    {
      title: "List workspace members",
      description:
        "List the people in a workspace who can be assigned cards, with their user ids. Use this before assign_card.",
      inputSchema: z.object({ workspace_id: uuid }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    reading(async ({ workspace_id }, { actor }) => {
      const rows = await listAssignableMembersFor(workspace_id, actor);
      return rows.map((m) => ({ user_id: m.userId, name: m.name }));
    }),
  );

  server.registerTool(
    "assign_card",
    {
      title: "Assign card",
      description:
        "Assign a card to a workspace member. Get user ids from list_members. Assigning someone who is already assigned does nothing.",
      inputSchema: z.object({ card_id: uuid, user_id: uuid }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    mutating(async ({ card_id, user_id }, { actor }) => {
      const opts = { actor, source: "mcp" as const };
      const { alreadyAssigned } = await assignCard(
        { cardId: card_id, userId: user_id },
        opts,
      );
      return { card_id, user_id, already_assigned: alreadyAssigned };
    }),
  );

  server.registerTool(
    "unassign_card",
    {
      title: "Unassign card",
      description: "Remove a member's assignment from a card.",
      inputSchema: z.object({ card_id: uuid, user_id: uuid }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    mutating(async ({ card_id, user_id }, { actor }) => {
      const opts = { actor, source: "mcp" as const };
      await unassignCard({ cardId: card_id, userId: user_id }, opts);
      return { card_id, user_id, unassigned: true };
    }),
  );
}
