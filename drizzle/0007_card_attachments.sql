CREATE TYPE "public"."attachment_storage" AS ENUM('postgres', 'blob');--> statement-breakpoint
CREATE TABLE "card_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"uploader_id" uuid,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"storage" "attachment_storage" NOT NULL,
	"blob_pathname" text,
	"data" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_attachments_storage_payload" CHECK (("card_attachments"."storage" = 'blob' and "card_attachments"."blob_pathname" is not null and "card_attachments"."data" is null)
        or ("card_attachments"."storage" = 'postgres' and "card_attachments"."data" is not null and "card_attachments"."blob_pathname" is null))
);
--> statement-breakpoint
ALTER TABLE "card_attachments" ADD CONSTRAINT "card_attachments_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_attachments" ADD CONSTRAINT "card_attachments_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_attachments" ADD CONSTRAINT "card_attachments_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_attachments_card_idx" ON "card_attachments" USING btree ("card_id","created_at");--> statement-breakpoint
CREATE INDEX "card_attachments_board_idx" ON "card_attachments" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "card_attachments_uploader_idx" ON "card_attachments" USING btree ("uploader_id");