"use client";

import { Copy, Plus, ShieldCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import {
  createUserInviteAction,
  revokeUserInviteAction,
  type CreateUserInviteState,
  type InstanceUserRow,
  type UserInviteRow,
} from "@/actions/user-invites";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { idleState, type ActionState } from "@/lib/action-result";

function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Working…" : children}
    </Button>
  );
}

export function UserInviteManager({
  invites,
  people,
  adminEmail,
}: {
  invites: UserInviteRow[];
  people: InstanceUserRow[];
  adminEmail: string;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const [createState, createAction] = useActionState<
    CreateUserInviteState,
    FormData
  >(async (previous, formData) => {
    const result = await createUserInviteAction(previous, formData);
    if (result.ok && result.inviteUrl) {
      setInviteUrl(result.inviteUrl);
      setCreating(false);
      router.refresh();
    } else if (!result.ok) {
      toast.error(result.message ?? "Could not create the invite.");
    }
    return result;
  }, idleState as CreateUserInviteState);

  const [, revokeAction] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await revokeUserInviteAction(previous, formData);
      if (result.ok) {
        toast.success(result.message ?? "Invite revoked.");
        router.refresh();
      } else {
        toast.error(result.message ?? "Could not revoke that invite.");
      }
      return result;
    },
    idleState,
  );

  async function copy(url: string) {
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
          <h1 className="text-2xl font-semibold tracking-tight">People</h1>
          <p className="text-muted-foreground mt-1.5 max-w-prose text-sm leading-relaxed">
            This instance is invite-only. New accounts are created only through
            a link you mint here.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          Invite someone
        </Button>
      </div>

      <section className="mt-8">
        <h2 className="text-base font-semibold">Open invites</h2>
        {invites.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">
            No open invite links.
          </p>
        ) : (
          <ul className="mt-3 divide-y rounded-xl border">
            {invites.map((invite) => (
              <li key={invite.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {invite.email ?? "Anyone with the link"}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    <code className="font-mono">{invite.tokenPrefix}…</code>
                    {" · used "}
                    {invite.useCount}
                    {invite.maxUses ? `/${invite.maxUses}` : ""}
                    {invite.expiresLabel
                      ? ` · expires ${invite.expiresLabel}`
                      : " · no expiry"}
                  </p>
                </div>
                <form action={revokeAction}>
                  <input type="hidden" name="inviteId" value={invite.id} />
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

      <section className="mt-10">
        <h2 className="text-base font-semibold">Accounts</h2>
        <ul className="mt-3 divide-y rounded-xl border">
          {people.map((person) => (
            <li key={person.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                  {person.name}
                  {person.email === adminEmail ? (
                    <ShieldCheck
                      className="text-primary size-3.5 shrink-0"
                      aria-label="Instance administrator"
                    />
                  ) : null}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {person.email} · joined {person.joinedLabel}
                </p>
              </div>
              <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-[0.7rem] font-medium">
                {person.role}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-md">
          <form action={createAction}>
            <DialogHeader>
              <DialogTitle>Invite someone to this instance</DialogTitle>
              <DialogDescription>
                Creates a link that lets one person set up an account. No email
                is sent.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-5">
              <div className="space-y-1.5">
                <Label htmlFor="ui-expiry">Expires</Label>
                <select
                  id="ui-expiry"
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
                <Label htmlFor="ui-max">Maximum uses</Label>
                <Input
                  id="ui-max"
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
                <Label htmlFor="ui-email">Restrict to email (optional)</Label>
                <Input
                  id="ui-email"
                  name="email"
                  type="email"
                  autoComplete="off"
                  placeholder="person@example.com"
                />
              </div>

              {createState.message && !createState.ok ? (
                <p role="alert" className="text-destructive text-xs">
                  {createState.message}
                </p>
              ) : null}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreating(false)}
              >
                Cancel
              </Button>
              <Submit>Create link</Submit>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {inviteUrl ? (
        <Dialog open onOpenChange={(open) => !open && setInviteUrl(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Share this link</DialogTitle>
              <DialogDescription>
                Anyone with this link can create an account on this instance. It
                won&rsquo;t be shown again.
              </DialogDescription>
            </DialogHeader>
            <div className="bg-muted my-4 rounded-lg border p-3">
              <code className="block break-all font-mono text-xs">
                {inviteUrl}
              </code>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => copy(inviteUrl)}>
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
