"use client";

import { Eye, EyeOff } from "lucide-react";

import { unwatchCardAction, watchCardAction } from "@/actions/card-detail";
import { initials } from "@/components/board/assignee-popover";
import { useQuickAction } from "@/components/card/card-hooks";
import type { CardDetailPerson } from "@/components/card/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

/**
 * Follow / unfollow, plus the faces already following.
 *
 * Offered to viewers too: `watchCard` is authorised at the *read* floor
 * because it writes one row keyed to the caller themselves and changes
 * nothing anybody else can see.
 */
export function CardWatch({
  cardId,
  watchers,
  watching,
}: {
  cardId: string;
  watchers: CardDetailPerson[];
  watching: boolean;
}) {
  const [pending, quick] = useQuickAction();

  return (
    <div>
      <h2 className="nqm-skin-kicker text-muted-foreground mb-2 text-xs uppercase tracking-wide">
        Watching
      </h2>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={watching ? "secondary" : "outline"}
          className="h-7 text-xs"
          disabled={pending}
          aria-pressed={watching}
          onClick={() =>
            quick(
              watching ? unwatchCardAction : watchCardAction,
              { cardId },
              { successMessage: true },
            )
          }
        >
          {watching ? (
            <Eye className="size-3.5" aria-hidden="true" />
          ) : (
            <EyeOff className="size-3.5" aria-hidden="true" />
          )}
          {watching ? "Watching" : "Watch"}
        </Button>

        {watchers.length > 0 ? (
          <span className="flex items-center -space-x-1.5">
            {watchers.slice(0, 4).map((w) => (
              <Avatar key={w.userId} className="ring-card size-5 ring-2" title={w.name}>
                {w.image ? <AvatarImage src={w.image} alt="" /> : null}
                <AvatarFallback className="text-[0.55rem]">
                  {initials(w.name) || "?"}
                </AvatarFallback>
              </Avatar>
            ))}
            {watchers.length > 4 ? (
              <span className="bg-muted text-muted-foreground ring-card grid size-5 place-items-center rounded-full text-[0.55rem] font-medium ring-2">
                +{watchers.length - 4}
              </span>
            ) : null}
            <span className="sr-only">
              Watched by {watchers.map((w) => w.name).join(", ")}
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
