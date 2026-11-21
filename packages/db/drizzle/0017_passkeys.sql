CREATE TYPE "public"."webauthn_purpose" AS ENUM('register', 'login');--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"member_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "credentials_credential_id_unique" UNIQUE("credential_id"),
	CONSTRAINT "credentials_credential_id_base64url" CHECK ("credentials"."credential_id" ~ '^[A-Za-z0-9_-]+$'),
	CONSTRAINT "credentials_public_key_base64url" CHECK ("credentials"."public_key" ~ '^[A-Za-z0-9_-]+$'),
	CONSTRAINT "credentials_counter_unsigned_32_bit" CHECK ("credentials"."counter" between 0 and 4294967295)
);
--> statement-breakpoint
CREATE TABLE "webauthn_challenges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"challenge_hash" text NOT NULL,
	"purpose" "webauthn_purpose" NOT NULL,
	"session_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webauthn_challenges_challenge_hash_unique" UNIQUE("challenge_hash"),
	CONSTRAINT "webauthn_challenges_session_by_purpose" CHECK (("webauthn_challenges"."purpose" = 'register') = ("webauthn_challenges"."session_id" is not null)),
	CONSTRAINT "webauthn_challenges_expire_after_creation" CHECK ("webauthn_challenges"."expires_at" > "webauthn_challenges"."created_at")
);
--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- A lost phone revokes its passkeys (revoked_at); the row stays, so the
-- audit can still name the passkey (0006 grants DELETE on every new table).
-- Expired challenges keep DELETE: nothing points at them.
REVOKE DELETE ON credentials FROM partneroj_app;
