ALTER TYPE "public"."workspace_role" ADD VALUE 'viewer';--> statement-breakpoint
ALTER TABLE "invites" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invites" ALTER COLUMN "expires_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "token_prefix" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "max_uses" integer;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "use_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "revoked_at" timestamp with time zone;