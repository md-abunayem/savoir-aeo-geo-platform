-- Migration: 0024_billing_and_admin
-- Phase 5 Step 5.2: M15 Platform Administration & Stripe Billing (ADM)

-- 1. Tenant Status
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "status" varchar(24) DEFAULT 'active' NOT NULL;
--> statement-breakpoint

-- 2. Tenant Subscriptions & Stripe Billing
CREATE TABLE IF NOT EXISTS "tenant_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "stripe_customer_id" varchar(120),
  "stripe_subscription_id" varchar(120),
  "plan_tier" varchar(32) DEFAULT 'starter' NOT NULL,
  "status" varchar(32) DEFAULT 'active' NOT NULL,
  "current_period_start" timestamp with time zone,
  "current_period_end" timestamp with time zone,
  "cancel_at_period_end" boolean DEFAULT false NOT NULL,
  "monthly_credits" integer DEFAULT 2000 NOT NULL,
  "monthly_crawl_credits" integer DEFAULT 500 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tenant_subscriptions_tenant_unique" UNIQUE ("tenant_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_subs_tenant_idx" ON "tenant_subscriptions" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_subs_stripe_cust_idx" ON "tenant_subscriptions" ("stripe_customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_subs_stripe_sub_idx" ON "tenant_subscriptions" ("stripe_subscription_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_subs_status_idx" ON "tenant_subscriptions" ("status");
--> statement-breakpoint
ALTER TABLE "tenant_subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenant_subscriptions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_subscriptions_policy ON "tenant_subscriptions" TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

-- 3. Credit Ledger Entries (Atomic Immutable History)
CREATE TABLE IF NOT EXISTS "credit_ledger_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "entry_type" varchar(40) NOT NULL,
  "category" varchar(24) DEFAULT 'monitoring' NOT NULL,
  "amount" integer NOT NULL,
  "balance_after" integer NOT NULL,
  "reference_id" varchar(120),
  "description" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_ledger_tenant_idx" ON "credit_ledger_entries" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_ledger_created_idx" ON "credit_ledger_entries" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_ledger_category_idx" ON "credit_ledger_entries" ("tenant_id", "category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_ledger_type_idx" ON "credit_ledger_entries" ("tenant_id", "entry_type");
--> statement-breakpoint
ALTER TABLE "credit_ledger_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "credit_ledger_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY credit_ledger_entries_policy ON "credit_ledger_entries" TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

-- 4. Crawl Credits (Separate metering for website crawls)
CREATE TABLE IF NOT EXISTS "crawl_credits" (
  "tenant_id" uuid PRIMARY KEY REFERENCES "tenants"("id") ON DELETE CASCADE NOT NULL,
  "available" integer DEFAULT 500 NOT NULL,
  "used" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crawl_credits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "crawl_credits" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY crawl_credits_policy ON "crawl_credits" TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

-- 5. Operator Audit Logs (Cross-tenant administrative audit trail)
CREATE TABLE IF NOT EXISTS "operator_audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "operator_id" varchar(150) NOT NULL,
  "action" varchar(64) NOT NULL,
  "target_tenant_id" uuid REFERENCES "tenants"("id") ON DELETE SET NULL,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "ip_address" varchar(45),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operator_audit_created_idx" ON "operator_audit_logs" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operator_audit_action_idx" ON "operator_audit_logs" ("action");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operator_audit_tenant_idx" ON "operator_audit_logs" ("target_tenant_id");
--> statement-breakpoint
ALTER TABLE "operator_audit_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "operator_audit_logs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY operator_audit_logs_policy ON "operator_audit_logs" TO CURRENT_USER USING (true) WITH CHECK (true);

