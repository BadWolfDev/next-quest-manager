"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { signInAction, signUpAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { idleState, type ActionState } from "@/lib/action-result";
import { cn } from "@/lib/utils";

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Just a moment…" : children}
    </Button>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-destructive text-xs">
      {message}
    </p>
  );
}

type Props = { mode: "signin" | "signup"; next?: string };

export function AuthForm({ mode, next }: Props) {
  const isSignUp = mode === "signup";
  const action = isSignUp ? signUpAction : signInAction;
  const [state, formAction] = useActionState<ActionState, FormData>(
    action,
    idleState,
  );

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {state.message ? (
        <p
          role="alert"
          className={cn(
            "rounded-lg border px-3 py-2 text-sm",
            state.ok
              ? "border-primary/30 bg-primary/10 text-foreground"
              : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          {state.message}
        </p>
      ) : null}

      {isSignUp ? (
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            name="name"
            autoComplete="name"
            required
            maxLength={80}
            placeholder="Ada Lovelace"
            aria-invalid={Boolean(state.fields?.name)}
            aria-describedby={state.fields?.name ? "name-error" : undefined}
          />
          <FieldError id="name-error" message={state.fields?.name} />
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          aria-invalid={Boolean(state.fields?.email)}
          aria-describedby={state.fields?.email ? "email-error" : undefined}
        />
        <FieldError id="email-error" message={state.fields?.email} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          required
          minLength={isSignUp ? 10 : undefined}
          placeholder={isSignUp ? "At least 10 characters" : "••••••••••"}
          aria-invalid={Boolean(state.fields?.password)}
          aria-describedby={
            state.fields?.password
              ? "password-error"
              : isSignUp
                ? "password-hint"
                : undefined
          }
        />
        <FieldError id="password-error" message={state.fields?.password} />
        {isSignUp && !state.fields?.password ? (
          <p id="password-hint" className="text-muted-foreground text-xs">
            At least 10 characters. Stored as an argon2id hash — never in plain
            text.
          </p>
        ) : null}
      </div>

      <SubmitButton>{isSignUp ? "Create account" : "Sign in"}</SubmitButton>

      <p className="text-muted-foreground text-center text-sm">
        {isSignUp ? "Already have an account? " : "New here? "}
        <Link
          href={isSignUp ? "/login" : "/signup"}
          className="text-foreground font-medium underline underline-offset-4 hover:text-primary"
        >
          {isSignUp ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}
