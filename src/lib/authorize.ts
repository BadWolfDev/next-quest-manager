import "server-only";

import { and, eq } from "drizzle-orm";
import { cache } from "react";

import { auth } from "@/auth";
import { db } from "@/db";
import {
  boards,
  cards,
  lists,
  users,
  workspaceMembers,
  workspaces,
  type WorkspaceRole,
} from "@/db/schema";
import { AuthenticationError, AuthorizationError } from "@/lib/errors";

/**
 * Central authorization policy.
 *
 * RULE: every server action and every data query in NQM goes through one of
 * these helpers. They resolve the caller from the session and then re-check
 * membership **in SQL**, joining through `workspace_members`, so a row that the
 * caller has no membership for simply never comes back. Nothing is filtered in
 * the client and nothing trusts an id from the URL.
 */

export { AuthenticationError, AuthorizationError };

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: "user" | "admin";
};

/** Role hierarchy — higher number satisfies every lower requirement. */
const ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

/**
 * The floor for anything that writes. Viewers sit below it, so passing
 * "member" (the default) to any require*Access helper is what makes a route
 * read-only for them. Read paths must opt down to "viewer" explicitly — the
 * default stays at "member" so a new call site fails closed rather than
 * silently admitting viewers to a mutation.
 */
export const WRITE_MIN_ROLE = "member" as const;
export const READ_MIN_ROLE = "viewer" as const;

export function roleSatisfies(actual: WorkspaceRole, minimum: WorkspaceRole) {
  return ROLE_RANK[actual] >= ROLE_RANK[minimum];
}

/**
 * Resolve the session to a user that actually exists.
 *
 * A JWT is self-contained, so a cookie minted before the row was deleted (a
 * recreated dev database, a removed account) still verifies and still carries a
 * user id. Trusting it hands a dangling id to any insert that references
 * `users` — which surfaced as a raw foreign-key violation from
 * `createWorkspaceAction` instead of "you are not signed in".
 *
 * So the token is only ever a *claim*: we confirm the row against the database
 * before treating anyone as authenticated. One indexed primary-key lookup,
 * memoised per request with React `cache()`, so a page that calls
 * requireUser() several times pays for it once.
 *
 * Reading the row also means name, avatar and role changes take effect without
 * waiting for the JWT to be reissued.
 */
const resolveSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  const claimedId = session?.user?.id;
  if (!claimedId) return null;

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      image: users.image,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, claimedId))
    .limit(1);

  // The token verified but the account is gone: not authenticated.
  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    image: row.image,
    role: row.role,
  };
});

/** The signed-in user, or `null`. Never throws. */
export async function getSessionUser(): Promise<SessionUser | null> {
  return resolveSessionUser();
}

/** The signed-in user, or throw. Use at the top of every server action. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthenticationError();
  return user;
}

/**
 * Who an authorization check runs as.
 *
 * Browser requests leave this undefined and the caller is resolved from the
 * Auth.js session. The MCP endpoint passes an actor resolved from a personal
 * access token instead. Everything downstream — the membership joins, the role
 * checks — is identical either way, so there is exactly one authorization code
 * path regardless of how the caller authenticated.
 */
export type Actor = SessionUser;

async function resolveActor(actor?: Actor): Promise<SessionUser> {
  return actor ?? requireUser();
}

export type WorkspaceContext = {
  user: SessionUser;
  workspace: { id: string; name: string; slug: string; theme: { accent?: string } };
  role: WorkspaceRole;
};

/**
 * Assert the caller is a member of `workspaceId` with at least `minRole`.
 * The membership join is the query — there is no separate "fetch then check".
 */
export async function requireWorkspaceMember(
  workspaceId: string,
  minRole: WorkspaceRole = "member",
  actor?: Actor,
): Promise<WorkspaceContext> {
  const user = await resolveActor(actor);

  const [row] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      theme: workspaces.theme,
      role: workspaceMembers.role,
    })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, workspaces.id),
        eq(workspaceMembers.userId, user.id),
      ),
    )
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  if (!row) throw new AuthorizationError();
  if (!roleSatisfies(row.role, minRole)) {
    throw new AuthorizationError(
      `This action requires the ${minRole} role in this workspace.`,
    );
  }

  return {
    user,
    workspace: { id: row.id, name: row.name, slug: row.slug, theme: row.theme },
    role: row.role,
  };
}

/** Same, addressed by the workspace slug used in `/w/[workspaceSlug]`. */
export async function requireWorkspaceMemberBySlug(
  slug: string,
  minRole: WorkspaceRole = "member",
  actor?: Actor,
): Promise<WorkspaceContext> {
  const user = await resolveActor(actor);

  const [row] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      theme: workspaces.theme,
      role: workspaceMembers.role,
    })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, workspaces.id),
        eq(workspaceMembers.userId, user.id),
      ),
    )
    .where(eq(workspaces.slug, slug))
    .limit(1);

  if (!row) throw new AuthorizationError();
  if (!roleSatisfies(row.role, minRole)) {
    throw new AuthorizationError(
      `This action requires the ${minRole} role in this workspace.`,
    );
  }

  return {
    user,
    workspace: { id: row.id, name: row.name, slug: row.slug, theme: row.theme },
    role: row.role,
  };
}

export type BoardContext = WorkspaceContext & {
  board: {
    id: string;
    name: string;
    workspaceId: string;
    background: { type: "color" | "gradient"; value: string };
    archivedAt: Date | null;
    /** Bumped by every board mutation; the freshness endpoint reads it. */
    updatedAt: Date;
  };
};

/**
 * Assert the caller may act on `boardId` at `minRole`, resolving the board's
 * workspace through the same membership join.
 */
export async function requireBoardAccess(
  boardId: string,
  minRole: WorkspaceRole = "member",
  actor?: Actor,
): Promise<BoardContext> {
  const user = await resolveActor(actor);

  const [row] = await db
    .select({
      boardId: boards.id,
      boardName: boards.name,
      background: boards.background,
      archivedAt: boards.archivedAt,
      updatedAt: boards.updatedAt,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      workspaceSlug: workspaces.slug,
      theme: workspaces.theme,
      role: workspaceMembers.role,
    })
    .from(boards)
    .innerJoin(workspaces, eq(workspaces.id, boards.workspaceId))
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, workspaces.id),
        eq(workspaceMembers.userId, user.id),
      ),
    )
    .where(eq(boards.id, boardId))
    .limit(1);

  if (!row) throw new AuthorizationError();
  if (!roleSatisfies(row.role, minRole)) {
    throw new AuthorizationError(
      `This action requires the ${minRole} role in this workspace.`,
    );
  }

  return {
    user,
    workspace: {
      id: row.workspaceId,
      name: row.workspaceName,
      slug: row.workspaceSlug,
      theme: row.theme,
    },
    role: row.role,
    board: {
      id: row.boardId,
      name: row.boardName,
      workspaceId: row.workspaceId,
      background: row.background,
      archivedAt: row.archivedAt,
      updatedAt: row.updatedAt,
    },
  };
}

/** Assert access to the board that owns `listId`. */
export async function requireListAccess(
  listId: string,
  minRole: WorkspaceRole = "member",
  actor?: Actor,
) {
  const user = await resolveActor(actor);

  const [row] = await db
    .select({ boardId: lists.boardId })
    .from(lists)
    .innerJoin(boards, eq(boards.id, lists.boardId))
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, boards.workspaceId),
        eq(workspaceMembers.userId, user.id),
      ),
    )
    .where(eq(lists.id, listId))
    .limit(1);

  if (!row) throw new AuthorizationError();
  return requireBoardAccess(row.boardId, minRole, user);
}

/** Assert access to the board that owns `cardId`. */
export async function requireCardAccess(
  cardId: string,
  minRole: WorkspaceRole = "member",
  actor?: Actor,
) {
  const user = await resolveActor(actor);

  const [row] = await db
    .select({ boardId: cards.boardId })
    .from(cards)
    .innerJoin(boards, eq(boards.id, cards.boardId))
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, boards.workspaceId),
        eq(workspaceMembers.userId, user.id),
      ),
    )
    .where(eq(cards.id, cardId))
    .limit(1);

  if (!row) throw new AuthorizationError();
  return requireBoardAccess(row.boardId, minRole, user);
}
