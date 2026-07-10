-- ─────────────────────────────────────────────────────────────────────────────
-- BirgenAI_LMS — Postgres Row-Level Security.
--
-- Defense-in-depth for the boundary the blueprint calls company-ending if it
-- fails. App code scopes by orgId; these policies make the database enforce it,
-- so a forgotten `where: { orgId }` returns nothing instead of another lender's
-- book.
--
-- Mechanism: src/lib/prisma.ts stamps every transaction with
--   set_config('app.org_id', '<uuid>', TRUE)     -- tenant request
--   set_config('app.platform', 'on', TRUE)       -- platform/cron/webhook/seed
-- and each policy compares the row's orgId against that GUC. With no GUC set,
-- app_org_id() is NULL, `"orgId" = NULL` is NULL, and the row is filtered out —
-- fail-closed by construction.
--
-- FORCE is essential: our connection role owns these tables, and owners bypass
-- RLS unless forced.
--
-- Three tables are deliberately NOT protected, all for the same reason — they
-- are read before (or outside) any tenant context, and none holds tenant data:
--   Org            the tenant registry itself; slug/name/branding are already
--                  public on the borrower funnel. Lookups run under runAsPlatform().
--   RateLimit      coarse request counters keyed by phone/IP/email. The limiter
--                  guards staff login and OTP issuance, which run before any org
--                  is resolved. Reached through rawPrisma (see src/lib/ratelimit.ts).
--   PlatformAdmin  the founder-level accounts that oversee EVERY tenant — they
--                  have no orgId by definition. Only /platform surfaces touch it,
--                  always under runAsPlatform().
--
-- Apply with:  npm run db:rls      (idempotent — safe to re-run)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app_org_id() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.org_id', true), '') $$;

CREATE OR REPLACE FUNCTION app_is_platform() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.platform', true), 'off') = 'on' $$;

-- ── Tenant-scoped tables (every table carrying an orgId column) ──────────────
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'OrgIntegration','OrgSubscription','Branch','Role','StaffUser','FieldVisit','KycSession',
    'OtpChallenge','AuditLog','Borrower','Consent','KycCheck','Product','Workflow',
    'LoanApplication','LoanOffer','Guarantor','Collateral','Document','Loan','Installment','Disbursement','PaymentIntent','C2BReceipt',
    'FloatLedger','ReconciliationException','SmsMessage','SmsTemplate','SmsWallet','SmsTopUp','ScoreSnapshot','GeoPin','UsageEvent','TuningProfile','Invoice','InvoiceLine'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (app_is_platform() OR "orgId" = app_org_id())
        WITH CHECK (app_is_platform() OR "orgId" = app_org_id())
    $f$, t);
  END LOOP;
END $$;

-- ── WorkflowStage has no orgId; it inherits its tenant through its Workflow. ──
ALTER TABLE "WorkflowStage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkflowStage" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "WorkflowStage";
CREATE POLICY tenant_isolation ON "WorkflowStage"
  USING (
    app_is_platform() OR EXISTS (
      SELECT 1 FROM "Workflow" w WHERE w."id" = "WorkflowStage"."workflowId" AND w."orgId" = app_org_id()
    )
  )
  WITH CHECK (
    app_is_platform() OR EXISTS (
      SELECT 1 FROM "Workflow" w WHERE w."id" = "WorkflowStage"."workflowId" AND w."orgId" = app_org_id()
    )
  );
