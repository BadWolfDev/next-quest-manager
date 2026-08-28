import { relations, sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* -------------------------------------------------------------------------- */
/* Enums                                                                      */
/* -------------------------------------------------------------------------- */

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const workspaceRoleEnum = pgEnum("workspace_role", [
  "owner",
  "admin",
  "member",
  "viewer",
]);

/* -------------------------------------------------------------------------- */
/* Shared column helpers                                                      */
/* -------------------------------------------------------------------------- */

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow();

const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow();

/**
 * A fractional index (see the `fractional-indexing` package), pinned to the
 * **C collation**.
 *
 * This is not cosmetic. Fractional keys are base-62 strings and the algorithm
 * assumes plain byte ordering, the way JavaScript's `<` compares strings. Under
 * a locale collation such as `en_US.UTF-8`, Postgres sorts `Zz` *after* `a1`,
 * so the moment a key with an uppercase prefix appears — which is exactly what
 * happens when an item is inserted before the first one — `ORDER BY position`
 * silently returns the wrong order.
 *
 * Declaring the collation on the column keeps `ORDER BY position` correct on
 * every deployment regardless of the database's locale, and keeps the
 * `(parent_id, position)` indexes usable for those ordered reads.
 */
const position = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'text collate "C"';
  },
});

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    image: text("image"),
    role: userRoleEnum("role").notNull().default("user"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // Emails are stored lowercased at write time; a plain unique index is enough
    // and keeps lookups index-backed.
    uniqueIndex("users_email_unique").on(table.email),
  ],
);

/* -------------------------------------------------------------------------- */
/* Workspaces                                                                 */
/* -------------------------------------------------------------------------- */

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /** { accent: "violet", ... } — free-form per-workspace theming. */
    theme: jsonb("theme")
      .$type<{ accent?: string }>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("workspaces_slug_unique").on(table.slug),
    index("workspaces_created_by_idx").on(table.createdBy),
  ],
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: workspaceRoleEnum("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("workspace_members_workspace_user_unique").on(
      table.workspaceId,
      table.userId,
    ),
    index("workspace_members_user_idx").on(table.userId),
    index("workspace_members_workspace_idx").on(table.workspaceId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Boards / lists / cards                                                     */
/* -------------------------------------------------------------------------- */

export const boards = pgTable(
  "boards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** { type: "color", value: "#0f172a" } or { type: "gradient", value: "..." } */
    background: jsonb("background")
      .$type<{ type: "color" | "gradient"; value: string }>()
      .notNull()
      .default(sql`'{"type":"color","value":"#6366f1"}'::jsonb`),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    /**
     * Public read-only share token, `nqb_<32 chars base64url>`. Null = private.
     *
     * Deliberately NOT the board's uuid: a separate secret can be rotated or
     * revoked without touching the board's identity, and turning sharing off
     * leaves no guessable residue.
     */
    publicToken: text("public_token"),
    archivedAt: timestamp("archived_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("boards_public_token_unique").on(table.publicToken),
    index("boards_workspace_idx").on(table.workspaceId),
    index("boards_workspace_archived_idx").on(table.workspaceId, table.archivedAt),
  ],
);

export const lists = pgTable(
  "lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Fractional index — see `fractional-indexing`. */
    position: position("position").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("lists_board_idx").on(table.boardId),
    index("lists_board_position_idx").on(table.boardId, table.position),
  ],
);

export const cards = pgTable(
  "cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    /** Denormalised for board-scoped queries and authorization checks. */
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Markdown source. Never rendered as raw HTML. */
    description: text("description"),
    position: position("position").notNull(),
    dueDate: timestamp("due_date", { withTimezone: true, mode: "date" }),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("cards_list_idx").on(table.listId),
    index("cards_board_idx").on(table.boardId),
    index("cards_list_position_idx").on(table.listId, table.position),
    index("cards_due_date_idx").on(table.dueDate),
  ],
);

/* -------------------------------------------------------------------------- */
/* Labels & assignees                                                         */
/* -------------------------------------------------------------------------- */

export const labels = pgTable(
  "labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    name: text("name").notNull().default(""),
    /** Hex colour, e.g. "#22c55e". */
    color: text("color").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("labels_board_idx").on(table.boardId)],
);

export const cardLabels = pgTable(
  "card_labels",
  {
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.cardId, table.labelId] }),
    index("card_labels_label_idx").on(table.labelId),
  ],
);

export const cardAssignees = pgTable(
  "card_assignees",
  {
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.cardId, table.userId] }),
    index("card_assignees_user_idx").on(table.userId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Comments, checklists                                                       */
/* -------------------------------------------------------------------------- */

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Markdown source. Never rendered as raw HTML. */
    body: text("body").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("comments_card_idx").on(table.cardId),
    index("comments_author_idx").on(table.authorId),
  ],
);

export const checklists = pgTable(
  "checklists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    position: position("position").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("checklists_card_idx").on(table.cardId),
    index("checklists_card_position_idx").on(table.cardId, table.position),
  ],
);

export const checklistItems = pgTable(
  "checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    checklistId: uuid("checklist_id")
      .notNull()
      .references(() => checklists.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    completed: boolean("completed").notNull().default(false),
    position: position("position").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("checklist_items_checklist_idx").on(table.checklistId),
    index("checklist_items_checklist_position_idx").on(
      table.checklistId,
      table.position,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* Activity log                                                               */
/* -------------------------------------------------------------------------- */

export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    boardId: uuid("board_id").references(() => boards.id, {
      onDelete: "cascade",
    }),
    cardId: uuid("card_id").references(() => cards.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** e.g. "board.created", "card.moved" */
    type: text("type").notNull(),
    data: jsonb("data")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (table) => [
    index("activity_log_workspace_idx").on(table.workspaceId, table.createdAt),
    index("activity_log_board_idx").on(table.boardId, table.createdAt),
    index("activity_log_card_idx").on(table.cardId, table.createdAt),
    index("activity_log_actor_idx").on(table.actorId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Invites                                                                    */
/* -------------------------------------------------------------------------- */

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Optional. When set, only this address may redeem the invite. */
    email: text("email"),
    role: workspaceRoleEnum("role").notNull().default("member"),
    /** SHA-256 of the raw token; the raw token is only ever in the invite link. */
    tokenHash: text("token_hash").notNull(),
    /** First 12 characters of the raw token, for display in the UI. */
    tokenPrefix: text("token_prefix").notNull().default(""),
    /**
     * null = unlimited multi-use link, 1 = single-use, N = capped multi-use.
     */
    maxUses: integer("max_uses"),
    useCount: integer("use_count").notNull().default(0),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    invitedBy: uuid("invited_by").references(() => users.id, {
      onDelete: "set null",
    }),
    /** null = never expires. */
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    /** When the invite was first redeemed. */
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("invites_token_hash_unique").on(table.tokenHash),
    index("invites_workspace_idx").on(table.workspaceId),
    index("invites_email_idx").on(table.email),
  ],
);

/* -------------------------------------------------------------------------- */
/* Personal access tokens (MCP / API)                                         */
/* -------------------------------------------------------------------------- */

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Human label chosen at creation, e.g. "Claude Code laptop". */
    name: text("name").notNull(),
    /** First 12 characters of the raw token, for display in the UI only. */
    tokenPrefix: text("token_prefix").notNull(),
    /**
     * SHA-256 of the raw token, hex encoded. The raw value is shown once at
     * creation and never stored. SHA-256 (not argon2) because this is a
     * 256-bit random secret, not a low-entropy password: there is nothing to
     * brute-force, and lookups must be a single indexed query per request.
     */
    tokenHash: text("token_hash").notNull(),
    /** Read-only tokens are refused by every mutating MCP tool. */
    readOnly: boolean("read_only").notNull().default(false),
    lastUsedAt: timestamp("last_used_at", {
      withTimezone: true,
      mode: "date",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("api_tokens_token_hash_unique").on(table.tokenHash),
    index("api_tokens_user_idx").on(table.userId, table.createdAt),
  ],
);

export type ApiToken = typeof apiTokens.$inferSelect;

/* -------------------------------------------------------------------------- */
/* Rate limiting (Postgres-backed — no Redis)                                 */
/* -------------------------------------------------------------------------- */

export const rateLimits = pgTable(
  "rate_limits",
  {
    /** Opaque bucket key, e.g. "login:1.2.3.4:user@example.com". */
    key: text("key").primaryKey(),
    windowStart: timestamp("window_start", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [index("rate_limits_window_start_idx").on(table.windowStart)],
);

/* -------------------------------------------------------------------------- */
/* Notifications                                                              */
/* -------------------------------------------------------------------------- */

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    data: jsonb("data")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    readAt: timestamp("read_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (table) => [
    index("notifications_user_idx").on(table.userId, table.createdAt),
    index("notifications_user_unread_idx").on(table.userId, table.readAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Relations                                                                  */
/* -------------------------------------------------------------------------- */

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(workspaceMembers),
  comments: many(comments),
  notifications: many(notifications),
}));

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  members: many(workspaceMembers),
  boards: many(boards),
  invites: many(invites),
}));

export const workspaceMembersRelations = relations(
  workspaceMembers,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [workspaceMembers.workspaceId],
      references: [workspaces.id],
    }),
    user: one(users, {
      fields: [workspaceMembers.userId],
      references: [users.id],
    }),
  }),
);

export const boardsRelations = relations(boards, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [boards.workspaceId],
    references: [workspaces.id],
  }),
  lists: many(lists),
  cards: many(cards),
  labels: many(labels),
}));

export const listsRelations = relations(lists, ({ one, many }) => ({
  board: one(boards, { fields: [lists.boardId], references: [boards.id] }),
  cards: many(cards),
}));

export const cardsRelations = relations(cards, ({ one, many }) => ({
  list: one(lists, { fields: [cards.listId], references: [lists.id] }),
  board: one(boards, { fields: [cards.boardId], references: [boards.id] }),
  comments: many(comments),
  checklists: many(checklists),
  cardLabels: many(cardLabels),
  assignees: many(cardAssignees),
}));

export const labelsRelations = relations(labels, ({ one, many }) => ({
  board: one(boards, { fields: [labels.boardId], references: [boards.id] }),
  cardLabels: many(cardLabels),
}));

export const cardLabelsRelations = relations(cardLabels, ({ one }) => ({
  card: one(cards, { fields: [cardLabels.cardId], references: [cards.id] }),
  label: one(labels, { fields: [cardLabels.labelId], references: [labels.id] }),
}));

export const cardAssigneesRelations = relations(cardAssignees, ({ one }) => ({
  card: one(cards, { fields: [cardAssignees.cardId], references: [cards.id] }),
  user: one(users, { fields: [cardAssignees.userId], references: [users.id] }),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  card: one(cards, { fields: [comments.cardId], references: [cards.id] }),
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
}));

export const checklistsRelations = relations(checklists, ({ one, many }) => ({
  card: one(cards, { fields: [checklists.cardId], references: [cards.id] }),
  items: many(checklistItems),
}));

export const checklistItemsRelations = relations(checklistItems, ({ one }) => ({
  checklist: one(checklists, {
    fields: [checklistItems.checklistId],
    references: [checklists.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

/* -------------------------------------------------------------------------- */
/* Inferred types                                                             */
/* -------------------------------------------------------------------------- */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type WorkspaceRole = (typeof workspaceRoleEnum.enumValues)[number];
export type Board = typeof boards.$inferSelect;
export type List = typeof lists.$inferSelect;
export type Card = typeof cards.$inferSelect;
export type Label = typeof labels.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
