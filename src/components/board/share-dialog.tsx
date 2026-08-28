"use client";

import { Copy, Globe, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { toast } from "sonner";

import {
  disablePublicBoardAction,
  enablePublicBoardAction,
  type ShareState,
} from "@/actions/sharing";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { idleState } from "@/lib/action-result";

/**
 * Public link control.
 *
 * `canShare` (admin+) gates the controls; a plain member sees the current state
 * read-only. The server re-checks admin either way.
 */
export function ShareDialog({
  boardId,
  initialShareUrl,
  canShare,
}: {
  boardId: string;
  initialShareUrl: string | null;
  canShare: boolean;
}) {
  const router = useRouter();
  const [shareUrl, setShareUrl] = useState<string | null>(initialShareUrl);

  const [, enableAction] = useActionState<ShareState, FormData>(
    async (prev, fd) => {
      const result = await enablePublicBoardAction(prev, fd);
      if (result.ok) {
        setShareUrl(result.shareUrl ?? null);
        toast.success("Public link ready.");
        router.refresh();
      } else {
        toast.error(result.message ?? "Could not update sharing.");
      }
      return result;
    },
    idleState as ShareState,
  );

  const [, disableAction] = useActionState<ShareState, FormData>(
    async (prev, fd) => {
      const result = await disablePublicBoardAction(prev, fd);
      if (result.ok) {
        setShareUrl(null);
        toast.success(result.message ?? "Public link turned off.");
        router.refresh();
      } else {
        toast.error(result.message ?? "Could not update sharing.");
      }
      return result;
    },
    idleState as ShareState,
  );

  async function copy() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Link copied.");
    } catch {
      toast.error("Could not copy — select the link and copy it manually.");
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Globe className="size-4" />
          Share
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share this board</DialogTitle>
          <DialogDescription>
            A public link gives anyone read-only access — lists, cards, labels
            and checklists. Nobody can change anything, and member email
            addresses are never included.
          </DialogDescription>
        </DialogHeader>

        {shareUrl ? (
          <div className="my-4 space-y-3">
            <div className="bg-muted rounded-lg border p-3">
              <code className="block break-all font-mono text-xs">
                {shareUrl}
              </code>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={copy}>
                <Copy className="size-4" />
                Copy link
              </Button>
              {canShare ? (
                <>
                  <form action={enableAction}>
                    <input type="hidden" name="boardId" value={boardId} />
                    <Button type="submit" variant="outline" size="sm">
                      <RefreshCw className="size-4" />
                      Regenerate
                    </Button>
                  </form>
                  <form action={disableAction}>
                    <input type="hidden" name="boardId" value={boardId} />
                    <Button type="submit" variant="ghost" size="sm">
                      Turn off
                    </Button>
                  </form>
                </>
              ) : null}
            </div>
            {canShare ? (
              <p className="text-muted-foreground text-xs">
                Regenerating immediately breaks the old link.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="my-4">
            <p className="text-muted-foreground text-sm">
              This board is private.
            </p>
            {canShare ? (
              <form action={enableAction} className="mt-3">
                <input type="hidden" name="boardId" value={boardId} />
                <Button type="submit">
                  <Globe className="size-4" />
                  Create public link
                </Button>
              </form>
            ) : (
              <p className="text-muted-foreground mt-2 text-xs">
                Only a workspace admin can publish it.
              </p>
            )}
          </div>
        )}

        <DialogFooter />
      </DialogContent>
    </Dialog>
  );
}
