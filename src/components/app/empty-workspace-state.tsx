"use client";

import { FolderPlus } from "lucide-react";
import { useState } from "react";

import { CreateWorkspaceDialog } from "@/components/app/create-workspace-dialog";
import { Button } from "@/components/ui/button";

export function EmptyWorkspaceState() {
  const [open, setOpen] = useState(false);

  return (
    <div className="grid min-h-[60dvh] place-items-center px-6 text-center">
      <div className="max-w-sm">
        <div className="bg-primary/10 text-primary mx-auto grid size-12 place-items-center rounded-xl">
          <FolderPlus className="size-6" />
        </div>
        <h1 className="mt-4 text-lg font-semibold tracking-tight">
          You&rsquo;re not in a workspace yet
        </h1>
        <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
          Workspaces hold your boards and the people who can see them. Create one
          to get going.
        </p>
        <Button className="mt-5" onClick={() => setOpen(true)}>
          Create a workspace
        </Button>
      </div>
      <CreateWorkspaceDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
