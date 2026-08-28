"use client";

import { ChevronsUpDown, KeyRound, LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { signOutAction } from "@/actions/session";
import { AppearancePicker } from "@/components/appearance-picker";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type UserMenuUser = {
  name: string;
  email: string;
  image: string | null;
  role: "user" | "admin";
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function UserMenu({ user }: { user: UserMenuUser }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="hover:bg-sidebar-accent focus-visible:ring-ring/60 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2">
        <Avatar className="size-8">
          {user.image ? <AvatarImage src={user.image} alt="" /> : null}
          <AvatarFallback className="text-xs">
            {initials(user.name) || "?"}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{user.name}</span>
          <span className="text-muted-foreground block truncate text-xs">
            {user.email}
          </span>
        </span>
        <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" side="top" className="w-64">
        <DropdownMenuLabel className="flex items-center justify-between gap-2 font-normal">
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">
              {user.name}
            </span>
            <span className="text-muted-foreground block truncate text-xs">
              {user.email}
            </span>
          </span>
          {user.role === "admin" ? (
            <ShieldCheck className="text-primary size-4 shrink-0" aria-label="Instance administrator" />
          ) : null}
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <AppearancePicker />

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/settings/tokens" className="cursor-pointer">
            <KeyRound className="size-4" />
            Access tokens
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <form action={signOutAction}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full cursor-pointer">
              <LogOut className="size-4" />
              Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
