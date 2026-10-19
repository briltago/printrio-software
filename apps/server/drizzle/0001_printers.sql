CREATE TABLE "printer_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "printers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"driver" text DEFAULT 'moonraker' NOT NULL,
	"url" text NOT NULL,
	"api_key_encrypted" text,
	"group_id" uuid,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "printers" ADD CONSTRAINT "printers_group_id_printer_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."printer_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "printer_groups_name_lower_idx" ON "printer_groups" USING btree (lower("name"));