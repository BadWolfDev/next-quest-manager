"use client";

import { Check, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { assignCardAction, unassignCardAction } from "@/actions/assignees";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { BoardCardAssignee } from "@/lib/queries";
import { cn } from "@/lib/utils";

export type AssignableMember = {
  userId: string;
  name: string;
  image: string | null;
};

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/** Stacked avatars shown on a card face. */
export function AssigneeChips({
  assignees,
  max = 3,
}: {
  assignees: BoardCardAssignee[];
  max?: number;
}) {
  if (assignees.length === 0) return null;
  const shown = assignees.slice(0, max);
  const extra = assignees.length - shown.length;

  return (
    <span className="flex items-center -space-x-1.5">
      {shown.map((a) => (
        <Avatar
          key={a.userId}
          className="ring-card size-5 ring-2"
          title={a.name}
        >
          {a.image ? <AvatarImage src={a.image} alt="" /> : null}
          <AvatarFallback className="text-[0.55rem]">
            {initials(a.name) || "?"}
          </AvatarFallback>
        </Avatar>
      ))}
      {extra > 0 ? (
        <span className="bg-muted text-muted-foreground ring-card grid size-5 place-items-center rounded-full text-[0.55rem] font-medium ring-2">
          +{extra}
        </span>
      ) : null}
      <span className="sr-only">
        Assigned to {assignees.map((a) => a.name).join(", ")}
      </span>
    </span>
  );
}

/**
 * Assign/unassign popover.
 *
 * Rendered only for callers who may write — a viewer never sees the trigger,
 * and the server actions reject them regardless.
 */
export function AssigneePopover({
  cardId,
  cardTitle,
  assignees,
  members,
}: {
  cardId: string;
  cardTitle: string;
  assignees: BoardCardAssignee[];
  members: AssignableMember[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const assignedIds = new Set(assignees.map((a) => a.userId));

  function toggle(userId: string, isAssigned: boolean) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("cardId", cardId);
      fd.set("userId", userId);
      const result = isAssigned
        ? await unassignCardAction({ ok: false }, fd)
        : await assignCardAction({ ok: false }, fd);

      if (!result.ok) {
        toast.error(result.message ?? "Could not change the assignment.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Assign ${cardTitle}`}
          title="Assign"
          data-card-control=""
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/60 grid size-5 shrink-0 place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2"
        >
          <UserPlus className="size-3.5" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-56 p-1"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <p className="text-muted-foreground px-2 py-1.5 text-xs font-medium">
          Assign to
        </p>
        {members.length === 0 ? (
          <p className="text-muted-foreground px-2 py-2 text-sm">
            No assignable members.
          </p>
        ) : (
          <ul>
            {members.map((m) => {
              const isAssigned = assignedIds.has(m.userId);
              return (
                <li key={m.userId}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => toggle(m.userId, isAssigned)}
                    className={cn(
                      "hover:bg-accent focus-visible:ring-ring/60 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2",
                      pending && "opacity-60",
                    )}
                  >
                    <Avatar className="size-5">
                      {m.image ? <AvatarImage src={m.image} alt="" /> : null}
                      <AvatarFallback className="text-[0.55rem]">
                        {initials(m.name) || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1 truncate">{m.name}</span>
                    <Check
                      className={cn(
                        "size-4 shrink-0",
                        isAssigned ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
