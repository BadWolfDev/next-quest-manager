CREATE TABLE "card_watchers" (
	"card_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_watchers_card_id_user_id_pk" PRIMARY KEY("card_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "due_reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "card_watchers" ADD CONSTRAINT "card_watchers_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_watchers" ADD CONSTRAINT "card_watchers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_watchers_card_idx" ON "card_watchers" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "card_watchers_user_idx" ON "card_watchers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cards_due_reminder_idx" ON "cards" USING btree ("due_date","due_reminded_at");--> statement-breakpoint
-- Backfill watchers. `card_watchers` is now the single source of truth for who
-- hears about a card, so every existing creator and assignee who is still a
-- member of the card's workspace gets a row. Without this, cards that predate
-- the table would go silent.
INSERT INTO "card_watchers" ("card_id", "user_id")
SELECT "cards"."id", "cards"."created_by"
FROM "cards"
JOIN "boards" ON "boards"."id" = "cards"."board_id"
JOIN "workspace_members" ON "workspace_members"."workspace_id" = "boards"."workspace_id"
  AND "workspace_members"."user_id" = "cards"."created_by"
WHERE "cards"."created_by" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "card_watchers" ("card_id", "user_id")
SELECT "card_assignees"."card_id", "card_assignees"."user_id"
FROM "card_assignees"
JOIN "cards" ON "cards"."id" = "card_assignees"."card_id"
JOIN "boards" ON "boards"."id" = "cards"."board_id"
JOIN "workspace_members" ON "workspace_members"."workspace_id" = "boards"."workspace_id"
  AND "workspace_members"."user_id" = "card_assignees"."user_id"
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Start the reminder sweep quiet. Every card already past its deadline is
-- marked as announced, so the first cron run reports on the next 24 hours
-- rather than on the whole history of the instance.
UPDATE "cards" SET "due_reminded_at" = now() WHERE "due_date" < now();
