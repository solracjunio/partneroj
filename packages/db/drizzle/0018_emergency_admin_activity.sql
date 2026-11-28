ALTER TYPE "public"."activity_action" ADD VALUE 'emergency_admin_created';--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_entry_reference";--> statement-breakpoint
ALTER TABLE "activities" ALTER COLUMN "actor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "target_member_id" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_target_member_id_members_id_fk" FOREIGN KEY ("target_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_member_reference" CHECK (case when "activities"."action"::text = 'emergency_admin_created'
        then "activities"."actor_id" is null and "activities"."target_member_id" is not null
        else "activities"."actor_id" is not null and "activities"."target_member_id" is null end);--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_entry_reference" CHECK (("activities"."action" in ('entry_recorded', 'entry_reversed')) = ("activities"."entry_id" is not null));