"use client";

import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import {
  createTokenAction,
  revokeTokenAction,
  type CreateTokenState,
  type TokenRow,
} from "@/actions/tokens";
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

/** The one-time reveal. Once this dialog closes the raw token is gone. */
function TokenReveal({
  token,
  onClose,
}: {
  token: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      toast.success("Token copied to clipboard.");
    } catch {
      toast.error("Could not copy — select the text and copy it manually.");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Copy your token now</DialogTitle>
          <DialogDescription>
            This is the only time it will be shown. We store a hash, not the
            token, so it cannot be recovered later.
          </DialogDescription>
        </DialogHeader>

        <div className="bg-muted my-4 rounded-lg border p-3">
          <code className="block break-all font-mono text-xs leading-relaxed">
            {token}
          </code>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={copy}>
            {copied ? (
              <Check className="size-4" />
            ) : (
              <Copy className="size-4" />
            )}
            {copied ? "Copied" : "Copy token"}
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TokenManager({ tokens }: { tokens: TokenRow[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);

  const [createState, createFormAction] = useActionState<
    CreateTokenState,
    FormData
  >(async (previous, formData) => {
    const result = await createTokenAction(previous, formData);
    if (result.ok && result.token) {
      setRevealed(result.token);
      setCreating(false);
      router.refresh();
    } else if (!result.ok) {
      toast.error(result.fields?.name ?? result.message ?? "Failed.");
    }
    return result;
  }, idleState as CreateTokenState);

  const [, revokeFormAction] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await revokeTokenAction(previous, formData);
      if (result.ok) {
        toast.success(result.message ?? "Token revoked.");
        router.refresh();
      } else {
        toast.error(result.message ?? "Could not revoke that token.");
      }
      return result;
    },
    idleState,
  );

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Access tokens
          </h1>
          <p className="text-muted-foreground mt-1.5 max-w-prose text-sm leading-relaxed">
            Personal access tokens let AI agents reach your boards over MCP.
            A token acts as you — it can see exactly the workspaces you belong
            to, and nothing else.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          New token
        </Button>
      </div>

      <section className="mt-8" aria-label="Your tokens">
        {tokens.length === 0 ? (
          <div className="rounded-xl border border-dashed px-6 py-12 text-center">
            <KeyRound className="text-muted-foreground mx-auto size-6" />
            <h2 className="mt-3 text-base font-medium">No tokens yet</h2>
            <p className="text-muted-foreground mx-auto mt-1.5 max-w-sm text-sm">
              Create one to connect Claude Code, a claude.ai connector, or any
              other MCP client.
            </p>
          </div>
        ) : (
          <ul className="divide-y rounded-xl border">
            {tokens.map((token) => {
              return (
                <li
                  key={token.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {token.name}
                      </span>
                      {token.readOnly ? (
                        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[0.7rem] font-medium">
                          read-only
                        </span>
                      ) : null}
                      {token.expired ? (
                        <span className="bg-destructive/10 text-destructive rounded-full px-2 py-0.5 text-[0.7rem] font-medium">
                          expired
                        </span>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      <code className="font-mono">{token.tokenPrefix}…</code>
                      {` · last used ${token.lastUsedLabel}`}
                      {token.expiresLabel ? ` · expires ${token.expiresLabel}` : ""}
                    </p>
                  </div>

                  <form action={revokeFormAction}>
                    <input type="hidden" name="tokenId" value={token.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                      Revoke
                    </Button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-md">
          <form action={createFormAction}>
            <DialogHeader>
              <DialogTitle>New access token</DialogTitle>
              <DialogDescription>
                Name it after the machine or agent that will use it, so you know
                what to revoke later.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-5">
              <div className="space-y-1.5">
                <Label htmlFor="token-name">Name</Label>
                <Input
                  id="token-name"
                  name="name"
                  required
                  maxLength={60}
                  autoComplete="off"
                  placeholder="Claude Code on my laptop"
                  aria-invalid={Boolean(createState.fields?.name)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="token-expiry">Expires in (days)</Label>
                <Input
                  id="token-expiry"
                  name="expiresInDays"
                  type="number"
                  min={1}
                  max={3650}
                  placeholder="Leave blank for no expiry"
                />
              </div>

              <label className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  name="readOnly"
                  className="accent-primary mt-0.5 size-4"
                />
                <span>
                  <span className="font-medium">Read-only</span>
                  <span className="text-muted-foreground block text-xs leading-relaxed">
                    The agent can list and read boards but cannot create, move,
                    or archive anything.
                  </span>
                </span>
              </label>

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
              <Submit>Create token</Submit>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {revealed ? (
        <TokenReveal token={revealed} onClose={() => setRevealed(null)} />
      ) : null}
    </>
  );
}
