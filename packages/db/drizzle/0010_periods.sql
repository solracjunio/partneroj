CREATE TABLE "periods" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"project_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "periods_ends_after_start" CHECK ("periods"."ends_on" >= "periods"."starts_on"),
	CONSTRAINT "periods_closed_by_and_at" CHECK (("periods"."closed_by" is null) = ("periods"."closed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_closed_by_members_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;