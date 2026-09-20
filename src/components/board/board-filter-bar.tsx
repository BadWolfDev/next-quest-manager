"use client";

import { Check, Filter, Search, X } from "lucide-react";
import { useId } from "react";

import type { AssignableMember } from "@/components/board/assignee-popover";
import { initials } from "@/components/board/assignee-popover";
import type { BoardCardLabel } from "@/components/board/board-state";
import {
  EMPTY_FILTER,
  isFilterActive,
  type BoardFilter,
  type DueFilter,
} from "@/components/board/board-filter";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const DUE_OPTIONS: { value: DueFilter; label: string }[] = [
  { value: "any", label: "Any due date" },
  { value: "overdue", label: "Overdue" },
  { value: "soon", label: "Due in 24 hours" },
  { value: "none", label: "No due date" },
];

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/**
 * The board's filter bar. Entirely client state — filtering a board is a way of
 * looking at it, not a query, so nothing here round-trips to the server.
 */
export function BoardFilterBar({
  labels,
  members,
  filter,
  onChange,
  hidden,
}: {
  labels: BoardCardLabel[];
  members: AssignableMember[];
  filter: BoardFilter;
  onChange: (next: BoardFilter) => void;
  /** How many cards the current filter is holding back. */
  hidden: number;
}) {
  const searchId = useId();
  const active = isFilterActive(filter);
  const chosen =
    filter.labelIds.length +
    filter.assigneeIds.length +
    (filter.due === "any" ? 0 : 1);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2"
        />
        <Input
          id={searchId}
          type="search"
          value={filter.text}
          aria-label="Filter cards on this board"
          placeholder="Filter cards…"
          className="bg-card h-8 w-44 pl-8 text-sm sm:w-56"
          onChange={(event) =>
            onChange({ ...filter, text: event.currentTarget.value })
          }
        />
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            aria-label={
              chosen > 0
                ? `Filters, ${chosen} active`
                : "Filter by label, assignee or due date"
            }
          >
            <Filter className="size-3.5" />
            Filters
            {chosen > 0 ? (
              <span className="bg-primary text-primary-foreground ml-0.5 grid size-4 place-items-center rounded-full text-[0.65rem] tabular-nums">
                {chosen}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-64 p-0">
          <div className="max-h-[22rem] overflow-y-auto p-1.5">
            <p className="text-muted-foreground px-2 py-1 text-[0.7rem] font-medium uppercase tracking-wide">
              Labels
            </p>
            {labels.length === 0 ? (
              <p className="text-muted-foreground px-2 pb-1.5 text-xs">
                No labels on this board.
              </p>
            ) : (
              labels.map((label) => {
                const on = filter.labelIds.includes(label.id);
                return (
                  <button
                    key={label.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      onChange({
                        ...filter,
                        labelIds: toggle(filter.labelIds, label.id),
                      })
                    }
                    className="hover:bg-accent focus-visible:ring-ring/60 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2"
                  >
                    <span
                      aria-hidden="true"
                      className="size-3 shrink-0 rounded-[4px]"
                      style={{ background: label.color }}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {label.name}
                    </span>
                    {on ? <Check className="size-3.5 shrink-0" /> : null}
                  </button>
                );
              })
            )}

            <p className="text-muted-foreground mt-2 px-2 py-1 text-[0.7rem] font-medium uppercase tracking-wide">
              Assignees
            </p>
            {members.length === 0 ? (
              <p className="text-muted-foreground px-2 pb-1.5 text-xs">
                Nobody to filter by.
              </p>
            ) : (
              members.map((member) => {
                const on = filter.assigneeIds.includes(member.userId);
                return (
                  <button
                    key={member.userId}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      onChange({
                        ...filter,
                        assigneeIds: toggle(filter.assigneeIds, member.userId),
                      })
                    }
                    className="hover:bg-accent focus-visible:ring-ring/60 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2"
                  >
                    <Avatar className="size-5">
                      {member.image ? (
                        <AvatarImage src={member.image} alt="" />
                      ) : null}
                      <AvatarFallback className="text-[0.6rem]">
                        {initials(member.name) || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1 truncate">
                      {member.name}
                    </span>
                    {on ? <Check className="size-3.5 shrink-0" /> : null}
                  </button>
                );
              })
            )}

            <p className="text-muted-foreground mt-2 px-2 py-1 text-[0.7rem] font-medium uppercase tracking-wide">
              Due date
            </p>
            {DUE_OPTIONS.map((option) => {
              const on = filter.due === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange({ ...filter, due: option.value })}
                  className={cn(
                    "hover:bg-accent focus-visible:ring-ring/60 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2",
                    on && "font-medium",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {option.label}
                  </span>
                  {on ? <Check className="size-3.5 shrink-0" /> : null}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      {active ? (
        <>
          <p
            className="text-muted-foreground text-xs"
            role="status"
            aria-live="polite"
          >
            {hidden === 0
              ? "Everything matches"
              : `${hidden} ${hidden === 1 ? "card" : "cards"} hidden`}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => onChange(EMPTY_FILTER)}
          >
            <X className="size-3.5" />
            Clear
          </Button>
        </>
      ) : null}
    </div>
  );
}
