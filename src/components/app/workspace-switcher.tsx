"use client";

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CreateWorkspaceDialog } from "@/components/app/create-workspace-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { WorkspaceSummary } from "@/lib/queries";
import { cn } from "@/lib/utils";

export function WorkspaceSwitcher({
  workspaces,
  activeId,
  onNavigate,
}: {
  workspaces: WorkspaceSummary[];
  activeId: string | null;
  /** Lets the mobile drawer close itself when a workspace is picked. */
  onNavigate?: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="hover:bg-sidebar-accent focus-visible:ring-ring/60 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2">
          <span
            aria-hidden="true"
            className="bg-primary text-primary-foreground grid size-8 shrink-0 place-items-center rounded-lg text-xs font-semibold"
          >
            {(active?.name ?? "?").slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {active?.name ?? "No workspace"}
            </span>
            <span className="text-muted-foreground block truncate text-xs capitalize">
              {active?.role ?? "—"}
            </span>
          </span>
          <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-muted-foreground text-xs">
            Workspaces
          </DropdownMenuLabel>
          {workspaces.map((workspace) => (
            <DropdownMenuItem key={workspace.id} asChild>
              <Link
                href={`/w/${workspace.slug}`}
                onClick={onNavigate}
                className="cursor-pointer"
              >
                <Check
                  className={cn(
                    "size-4",
                    workspace.id === active?.id ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="truncate">{workspace.name}</span>
              </Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setCreating(true);
            }}
            className="cursor-pointer"
          >
            <Plus className="size-4" />
            New workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
