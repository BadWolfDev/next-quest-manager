"use client";

import {
  Archive,
  ArrowDownToLine,
  ArrowUpToLine,
  ExternalLink,
  Link2,
  MoreHorizontal,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { toast } from "sonner";

import { archiveCardAction } from "@/actions/card-detail";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { idleState, type ActionState } from "@/lib/action-result";

export type CardEdge = "top" | "bottom";

/**
 * The "…" menu on a card tile.
 *
 * The whole tile is the drag handle, so every control layered on it must carry
 * `data-card-control` (the tile's click handler skips those) and swallow
 * pointer/key events before dnd-kit's sensors see them — otherwise opening the
 * menu starts a drag.
 */
export function CardMenu({
  cardId,
  cardTitle,
  boardId,
  canMoveUp,
  canMoveDown,
  onMoveToEdge,
}: {
  cardId: string;
  cardTitle: string;
  boardId: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveToEdge: (cardId: string, edge: CardEdge) => void;
}) {
  const router = useRouter();

  const [, archive] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await archiveCardAction(previous, formData);
      if (result.ok) {
        toast.success(`Archived “${cardTitle}”.`);
        router.refresh();
      } else {
        toast.error(result.message ?? "Could not archive that card.");
      }
      return result;
    },
    idleState,
  );

  async function copyLink() {
    const url = `${window.location.origin}/b/${boardId}/c/${cardId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied.");
    } catch {
      // Clipboard access is denied in plenty of ordinary situations (insecure
      // origin, permissions policy). Show the link rather than failing mutely.
      toast.error("Could not copy. The link is: " + url);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Actions for ${cardTitle}`}
          title="Card actions"
          data-card-control=""
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          className="text-muted-foreground hover:text-foreground size-5 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/card:opacity-100 group-focus-within/card:opacity-100"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="w-48"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenuItem
          className="cursor-pointer"
          onSelect={() => router.push(`/b/${boardId}/c/${cardId}`)}
        >
          <ExternalLink className="size-4" />
          Open card
        </DropdownMenuItem>

        <DropdownMenuItem
          className="cursor-pointer"
          onSelect={() => {
            void copyLink();
          }}
        >
          <Link2 className="size-4" />
          Copy link
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="cursor-pointer"
          disabled={!canMoveUp}
          onSelect={() => onMoveToEdge(cardId, "top")}
        >
          <ArrowUpToLine className="size-4" />
          Move to top
        </DropdownMenuItem>

        <DropdownMenuItem
          className="cursor-pointer"
          disabled={!canMoveDown}
          onSelect={() => onMoveToEdge(cardId, "bottom")}
        >
          <ArrowDownToLine className="size-4" />
          Move to bottom
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <form action={archive}>
          <input type="hidden" name="cardId" value={cardId} />
          <input type="hidden" name="boardId" value={boardId} />
          <DropdownMenuItem asChild variant="destructive">
            <button type="submit" className="w-full cursor-pointer">
              <Archive className="size-4" />
              Archive card
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
