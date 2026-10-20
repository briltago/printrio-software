CREATE TABLE "library_files" (
	"path" text PRIMARY KEY NOT NULL,
	"size" double precision NOT NULL,
	"modified" timestamp with time zone NOT NULL,
	"slicer" text,
	"estimated_seconds" double precision,
	"filament_mm" double precision,
	"filament_grams" double precision,
	"layer_height" double precision,
	"object_height" double precision,
	"material" text,
	"thumbnail_format" text,
	"thumbnail" text,
	"uploaded_by" uuid,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "library_files" ADD CONSTRAINT "library_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;