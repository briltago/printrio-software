CREATE TABLE "print_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"printer_id" uuid,
	"printer_name" text NOT NULL,
	"file_name" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"print_seconds" double precision DEFAULT 0 NOT NULL,
	"filament_mm" double precision DEFAULT 0 NOT NULL,
	"filament_grams" double precision,
	"spool_id" uuid,
	"spool_label" text,
	"spool_color_hex" text,
	"material" text,
	"material_cost" double precision,
	"energy_kwh" double precision,
	"energy_cost" double precision,
	"total_cost" double precision,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "printers" ADD COLUMN "power_watts" integer;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_printer_id_printers_id_fk" FOREIGN KEY ("printer_id") REFERENCES "public"."printers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_spool_id_spools_id_fk" FOREIGN KEY ("spool_id") REFERENCES "public"."spools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "print_jobs_started_idx" ON "print_jobs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "print_jobs_printer_idx" ON "print_jobs" USING btree ("printer_id","started_at");