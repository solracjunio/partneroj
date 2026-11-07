CREATE TYPE "public"."member_role" AS ENUM('admin', 'partner', 'reader');--> statement-breakpoint
CREATE TYPE "public"."project_kind" AS ENUM('construction', 'ongoing');--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"partnership_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" "member_role" NOT NULL,
	"pix_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partnerships" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"tax_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"partnership_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "project_kind" NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"settlement_announced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weights" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"project_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"weight" integer NOT NULL,
	"draw_position" integer NOT NULL,
	CONSTRAINT "weights_member_per_project_unique" UNIQUE("project_id","member_id"),
	CONSTRAINT "weights_draw_position_per_project_unique" UNIQUE("project_id","draw_position"),
	CONSTRAINT "weights_weight_positive" CHECK ("weights"."weight" >= 1)
);
--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_partnership_id_partnerships_id_fk" FOREIGN KEY ("partnership_id") REFERENCES "public"."partnerships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_partnership_id_partnerships_id_fk" FOREIGN KEY ("partnership_id") REFERENCES "public"."partnerships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weights" ADD CONSTRAINT "weights_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weights" ADD CONSTRAINT "weights_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;