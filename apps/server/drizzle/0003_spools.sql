CREATE TABLE "filaments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor" text,
	"name" text NOT NULL,
	"material" text NOT NULL,
	"color_name" text,
	"color_hex" text,
	"diameter" double precision DEFAULT 1.75 NOT NULL,
	"density" double precision NOT NULL,
	"spool_weight" double precision,
	"empty_spool_weight" double precision,
	"price" double precision,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "filaments_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "spools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filament_id" uuid NOT NULL,
	"initial_weight" double precision NOT NULL,
	"remaining_weight" double precision NOT NULL,
	"empty_spool_weight" double precision,
	"price" double precision,
	"location" text,
	"lot" text,
	"notes" text,
	"archived" boolean DEFAULT false NOT NULL,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spools_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
ALTER TABLE "printers" ADD COLUMN "active_spool_id" uuid;--> statement-breakpoint
ALTER TABLE "spools" ADD CONSTRAINT "spools_filament_id_filaments_id_fk" FOREIGN KEY ("filament_id") REFERENCES "public"."filaments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printers" ADD CONSTRAINT "printers_active_spool_id_spools_id_fk" FOREIGN KEY ("active_spool_id") REFERENCES "public"."spools"("id") ON DELETE set null ON UPDATE no action;