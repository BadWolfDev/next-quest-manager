"use client";

import { useRouter } from "next/navigation";
import { useActionState, useRef } from "react";
import { useFormStatus } from "react-dom";

import { changePasswordAction, updateProfileAction } from "@/actions/account";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { idleState, type ActionState } from "@/lib/action-result";
import { cn } from "@/lib/utils";

function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Just a moment…" : children}
    </Button>
  );
}

function Notice({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <p
      role="status"
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        state.ok
          ? "border-primary/30 bg-primary/10 text-foreground"
          : "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      {state.message}
    </p>
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

/**
 * Your own account.
 *
 * Neither form carries a user id: both actions are public endpoints and resolve
 * their subject from the session, so there is nothing here to tamper with.
 */
export function AccountSettings({
  name,
  email,
}: {
  name: string;
  email: string;
}) {
  const router = useRouter();
  const passwordForm = useRef<HTMLFormElement>(null);

  const [profileState, updateProfile] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await updateProfileAction(previous, formData);
      // The name is rendered by the app shell, which this page sits inside —
      // refresh so the sidebar stops showing the old one.
      if (result.ok) router.refresh();
      return result;
    },
    idleState,
  );

  const [passwordState, changePassword] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await changePasswordAction(previous, formData);
      if (result.ok) passwordForm.current?.reset();
      return result;
    },
    idleState,
  );

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your profile and sign-in credentials.
        </p>
      </header>

      <section aria-labelledby="profile-heading" className="space-y-4">
        <div>
          <h2 id="profile-heading" className="text-base font-medium">
            Profile
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Signed in as {email}. Email addresses cannot be changed here.
          </p>
        </div>

        <form action={updateProfile} className="max-w-sm space-y-3" noValidate>
          <Notice state={profileState} />
          <div className="space-y-1.5">
            <Label htmlFor="account-name">Display name</Label>
            <Input
              id="account-name"
              name="name"
              defaultValue={name}
              required
              maxLength={80}
              autoComplete="name"
              aria-invalid={Boolean(profileState.fields?.name)}
              aria-describedby={
                profileState.fields?.name ? "account-name-error" : undefined
              }
            />
            <FieldError
              id="account-name-error"
              message={profileState.fields?.name}
            />
          </div>
          <Submit>Save name</Submit>
        </form>
      </section>

      <section aria-labelledby="password-heading" className="space-y-4">
        <div>
          <h2 id="password-heading" className="text-base font-medium">
            Password
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Sessions are stateless JWTs, so changing your password does not sign
            other devices out until their session expires.
          </p>
        </div>

        <form
          ref={passwordForm}
          action={changePassword}
          className="max-w-sm space-y-3"
          noValidate
        >
          <Notice state={passwordState} />

          <div className="space-y-1.5">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
              aria-invalid={Boolean(passwordState.fields?.currentPassword)}
              aria-describedby={
                passwordState.fields?.currentPassword
                  ? "current-password-error"
                  : undefined
              }
            />
            <FieldError
              id="current-password-error"
              message={passwordState.fields?.currentPassword}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              name="newPassword"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              aria-invalid={Boolean(passwordState.fields?.newPassword)}
              aria-describedby={
                passwordState.fields?.newPassword
                  ? "new-password-error"
                  : "new-password-hint"
              }
            />
            {passwordState.fields?.newPassword ? (
              <FieldError
                id="new-password-error"
                message={passwordState.fields.newPassword}
              />
            ) : (
              <p id="new-password-hint" className="text-muted-foreground text-xs">
                At least 10 characters.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              name="confirmPassword"
              type="password"
              required
              autoComplete="new-password"
              aria-invalid={Boolean(passwordState.fields?.confirmPassword)}
              aria-describedby={
                passwordState.fields?.confirmPassword
                  ? "confirm-password-error"
                  : undefined
              }
            />
            <FieldError
              id="confirm-password-error"
              message={passwordState.fields?.confirmPassword}
            />
          </div>

          <Submit>Change password</Submit>
        </form>
      </section>
    </div>
  );
}
