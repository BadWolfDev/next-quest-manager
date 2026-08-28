"use client";

import { Copy, LogOut, MoreHorizontal, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import {
  createInviteAction,
  revokeInviteAction,
  type CreateInviteState,
  type PendingInvite,
} from "@/actions/invites";
import {
  changeMemberRoleAction,
  leaveWorkspaceAction,
  removeMemberAction,
  type MemberRow,
} from "@/actions/members";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { idleState, type ActionState } from "@/lib/action-result";
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Working…" : children}
    </Button>
  );
}

export function MembersManager({
  workspaceId,
  workspaceName,
  myRole,
  members,
  invites,
}: {
  workspaceId: string;
  workspaceName: string;
  myRole: string;
  members: MemberRow[];
  invites: PendingInvite[];
}) {
  const router = useRouter();
  const [inviting, setInviting] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const isOwner = myRole === "owner";
  const canManage = myRole === "owner" || myRole === "admin";

  const [inviteState, inviteFormAction] = useActionState<
    CreateInviteState,
    FormData
  >(async (previous, formData) => {
    const result = await createInviteAction(previous, formData);
    if (result.ok && result.inviteUrl) {
      setInviteUrl(result.inviteUrl);
      setInviting(false);
      router.refresh();
    } else if (!result.ok) {
      toast.error(result.message ?? "Could not create the invite.");
    }
    return result;
  }, idleState as CreateInviteState);

  function bindAction(
    action: (p: ActionState, f: FormData) => Promise<ActionState>,
    successMessage?: string,
  ) {
    return async (previous: ActionState, formData: FormData) => {
      const result = await action(previous, formData);
      if (result.ok) {
        if (successMessage || result.message) {
          toast.success(result.message ?? successMessage!);
        }
        router.refresh();
      } else {
        toast.error(result.message ?? "That didn't work.");
      }
      return result;
    };
  }

  const [, roleFormAction] = useActionState<ActionState, FormData>(
    bindAction(changeMemberRoleAction),
    idleState,
  );
  const [, removeFormAction] = useActionState<ActionState, FormData>(
    bindAction(removeMemberAction),
    idleState,
  );
  const [, revokeFormAction] = useActionState<ActionState, FormData>(
    bindAction(revokeInviteAction),
    idleState,
  );
  const [, leaveFormAction] = useActionState<ActionState, FormData>(
    leaveWorkspaceAction,
    idleState,
  );

  async function copyInvite(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Invite link copied.");
    } catch {
      toast.error("Could not copy — select the link and copy it manually.");
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
          <p className="text-muted-foreground mt-1.5 text-sm">
            Who can see and change {workspaceName}.
          </p>
        </div>
        {canManage ? (
          <Button onClick={() => setInviting(true)}>
            <Plus className="size-4" />
            Invite people
          </Button>
        ) : null}
      </div>

      {/* Members ------------------------------------------------------- */}
      <ul className="mt-8 divide-y rounded-xl border">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center gap-3 px-4 py-3.5">
            <Avatar className="size-9 shrink-0">
              {m.image ? <AvatarImage src={m.image} alt="" /> : null}
              <AvatarFallback className="text-xs">
                {initials(m.name) || "?"}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {m.name}
                {m.isSelf ? (
                  <span className="text-muted-foreground font-normal"> (you)</span>
                ) : null}
              </p>
              <p className="text-muted-foreground truncate text-xs">
                {m.email} · joined {m.joinedLabel}
              </p>
            </div>

            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[0.7rem] font-medium",
                m.role === "owner"
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {ROLE_LABEL[m.role] ?? m.role}
            </span>

            {canManage && !m.isSelf ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    aria-label={`Manage ${m.name}`}
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="text-muted-foreground text-xs">
                    Change role
                  </DropdownMenuLabel>
                  {(["owner", "admin", "member", "viewer"] as const)
                    // Only an owner may grant owner/admin — the server enforces
                    // this too; hiding it here just avoids a pointless error.
                    .filter((r) => (r === "owner" || r === "admin" ? isOwner : true))
                    .map((role) => (
                      <form key={role} action={roleFormAction}>
                        <input type="hidden" name="workspaceId" value={workspaceId} />
                        <input type="hidden" name="userId" value={m.userId} />
                        <input type="hidden" name="role" value={role} />
                        <DropdownMenuItem asChild>
                          <button
                            type="submit"
                            className="w-full cursor-pointer"
                            disabled={m.role === role}
                          >
                            {ROLE_LABEL[role]}
                            {m.role === role ? " ✓" : ""}
                          </button>
                        </DropdownMenuItem>
                      </form>
                    ))}
                  <DropdownMenuSeparator />
                  <form action={removeFormAction}>
                    <input type="hidden" name="workspaceId" value={workspaceId} />
                    <input type="hidden" name="userId" value={m.userId} />
                    <DropdownMenuItem asChild variant="destructive">
                      <button type="submit" className="w-full cursor-pointer">
                        <Trash2 className="size-4" />
                        Remove from workspace
                      </button>
                    </DropdownMenuItem>
                  </form>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </li>
        ))}
      </ul>

      {/* Pending invites ----------------------------------------------- */}
      {canManage ? (
        <section className="mt-10">
          <h2 className="text-base font-semibold">Pending invites</h2>
          {invites.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-sm">
              No open invite links.
            </p>
          ) : (
            <ul className="mt-3 divide-y rounded-xl border">
              {invites.map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {inv.email ?? "Anyone with the link"}
                      <span className="text-muted-foreground font-normal">
                        {" · "}
                        {ROLE_LABEL[inv.role] ?? inv.role}
                      </span>
                    </p>
                    <p className="text-muted-foreground truncate text-xs">
                      <code className="font-mono">{inv.tokenPrefix}…</code>
                      {" · used "}
                      {inv.useCount}
                      {inv.maxUses ? `/${inv.maxUses}` : ""}
                      {inv.expiresLabel ? ` · expires ${inv.expiresLabel}` : " · no expiry"}
                    </p>
                  </div>
                  <form action={revokeFormAction}>
                    <input type="hidden" name="workspaceId" value={workspaceId} />
                    <input type="hidden" name="inviteId" value={inv.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                    >
                      <X className="size-4" />
                      Revoke
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/* Leave ---------------------------------------------------------- */}
      <section className="mt-10 rounded-xl border border-dashed px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">Leave this workspace</h2>
            <p className="text-muted-foreground mt-0.5 text-xs">
              You&rsquo;ll lose access to its boards.
              {myRole === "owner"
                ? " The last owner must promote someone else first."
                : ""}
            </p>
          </div>
          <form action={leaveFormAction}>
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <Button type="submit" variant="outline" size="sm">
              <LogOut className="size-4" />
              Leave
            </Button>
          </form>
        </div>
      </section>

      {/* Invite dialog -------------------------------------------------- */}
      <Dialog open={inviting} onOpenChange={setInviting}>
        <DialogContent className="sm:max-w-md">
          <form action={inviteFormAction}>
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <DialogHeader>
              <DialogTitle>Invite people</DialogTitle>
              <DialogDescription>
                Creates a link you can share. No email is sent.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-5">
              <div className="space-y-1.5">
                <Label htmlFor="invite-role">Role</Label>
                <select
                  id="invite-role"
                  name="role"
                  defaultValue="member"
                  className="border-input bg-background focus-visible:ring-ring/60 h-9 w-full rounded-md border px-3 text-sm focus-visible:outline-none focus-visible:ring-2"
                >
                  {isOwner ? <option value="admin">Admin</option> : null}
                  <option value="member">Member</option>
                  <option value="viewer">Viewer (read-only)</option>
                </select>
                {!isOwner ? (
                  <p className="text-muted-foreground text-xs">
                    Only an owner can invite admins.
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="invite-expiry">Expires</Label>
                <select
                  id="invite-expiry"
                  name="expiry"
                  defaultValue="7d"
                  className="border-input bg-background focus-visible:ring-ring/60 h-9 w-full rounded-md border px-3 text-sm focus-visible:outline-none focus-visible:ring-2"
                >
                  <option value="24h">In 24 hours</option>
                  <option value="7d">In 7 days</option>
                  <option value="never">Never</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="invite-max">Maximum uses</Label>
                <Input
                  id="invite-max"
                  name="maxUses"
                  type="number"
                  min={1}
                  max={1000}
                  placeholder="Blank for unlimited"
                />
                <p className="text-muted-foreground text-xs">
                  Set to 1 for a single-use invite.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="invite-email">Restrict to email (optional)</Label>
                <Input
                  id="invite-email"
                  name="email"
                  type="email"
                  autoComplete="off"
                  placeholder="person@example.com"
                />
              </div>

              {inviteState.message && !inviteState.ok ? (
                <p role="alert" className="text-destructive text-xs">
                  {inviteState.message}
                </p>
              ) : null}
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setInviting(false)}>
                Cancel
              </Button>
              <Submit>Create link</Submit>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Show-once invite link ------------------------------------------ */}
      {inviteUrl ? (
        <Dialog open onOpenChange={(open) => !open && setInviteUrl(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Share this link</DialogTitle>
              <DialogDescription>
                Anyone with this link can join with the role you chose. It
                won&rsquo;t be shown again.
              </DialogDescription>
            </DialogHeader>
            <div className="bg-muted my-4 rounded-lg border p-3">
              <code className="block break-all font-mono text-xs">{inviteUrl}</code>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => copyInvite(inviteUrl)}>
                <Copy className="size-4" />
                Copy link
              </Button>
              <Button onClick={() => setInviteUrl(null)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
