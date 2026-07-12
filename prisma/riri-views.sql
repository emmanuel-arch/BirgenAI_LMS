-- ─────────────────────────────────────────────────────────────────────────────
-- BirgenAI_LMS — Riri's read surface. The ONLY thing analytics SQL may touch.
--
-- The blueprint asks for a semantic metric layer plus "guarded text-to-SQL on a
-- read path". These views ARE the guard's foundation, and they exist because a
-- table allowlist alone is a promise, not a boundary:
--
--   1. COLUMN SAFETY BY CONSTRUCTION. `StaffUser` carries `passwordHash` and
--      `otpSecret`; `OrgIntegration` carries the lender's decryptable M-Pesa
--      credentials; `Borrower` carries a national ID. A column DENYLIST fails open
--      the day someone adds a column — the next `apiKeyHash` is exposed until a
--      human remembers this file. An allowlist of published columns cannot: a
--      column that is not selected here does not exist as far as Riri is concerned.
--      So the vault, OTP codes, password hashes, raw webhook payloads and every
--      free-text note (arrears calls and hardship tickets are the most sensitive
--      prose in the system) are simply not in the read surface.
--
--   2. NO QUOTED IDENTIFIERS. Every view and column below is lowercase_snake, so
--      valid analytics SQL never needs a double quote — while EVERY Prisma base
--      table needs one ("Loan", "orgId"). That lets the guard reject the double
--      quote character outright (src/lib/riri/guard.ts), which makes the base
--      tables unreachable by construction rather than by pattern-matching. An
--      unquoted `Loan` folds to `loan`, which is not a relation.
--
--   3. PII MINIMISATION. Riri answers questions about a book; she never needs to
--      print a reachable phone number or an ID number to do it. Phones are masked
--      to their last three digits here, national IDs are not published at all.
--
-- ⚠ `security_invoker = true` IS LOAD-BEARING — DO NOT REMOVE IT.
-- These views are owned by `postgres`, which on Supabase carries BYPASSRLS. A
-- normal (definer-ish) view executes with the OWNER's privileges, so RLS on the
-- base tables would be BYPASSED and every lender would read every other lender's
-- book through them — the exact company-ending leak RLS exists to prevent. With
-- security_invoker the base-table policies are evaluated as the *calling* role
-- (`lms_app`, NOBYPASSRLS) against the `app.org_id` GUC, so these views are
-- tenant-scoped by the same fence as everything else. `verify-riri` proves it by
-- reading a second org's rows through the views and asserting it sees none.
-- (Requires PG 15+; this database is 17.)
--
-- Apply with:  npm run db:riri-views     (idempotent)
-- ⚠ Re-run after any schema change that alters a column published below.
-- ─────────────────────────────────────────────────────────────────────────────

-- Loans: the book itself.
DROP VIEW IF EXISTS riri_loans CASCADE;
CREATE VIEW riri_loans WITH (security_invoker = true) AS
SELECT
  l."id"                  AS id,
  l."orgId"               AS org_id,
  l."borrowerId"          AS borrower_id,
  l."productId"           AS product_id,
  l."principal"::float8   AS principal,
  l."interest"::float8    AS interest,
  l."loanAmount"::float8  AS loan_amount,
  l."balance"::float8     AS balance,
  l."status"::text        AS status,
  l."borrowDate"          AS borrowed_at,
  l."disbursedAt"         AS disbursed_at,
  l."clearedAt"           AS cleared_at,
  l."expectedClearDate"   AS expected_clear_date,
  l."createdBy"           AS created_by,
  l."createdAt"           AS created_at
FROM "Loan" l;

-- Installments: the schedule, and where it is late.
DROP VIEW IF EXISTS riri_installments CASCADE;
CREATE VIEW riri_installments WITH (security_invoker = true) AS
SELECT
  i."id"                                       AS id,
  i."orgId"                                    AS org_id,
  i."loanId"                                   AS loan_id,
  i."seq"                                      AS seq,
  i."dueDate"                                  AS due_date,
  i."amountDue"::float8                        AS amount_due,
  i."amountPaid"::float8                       AS amount_paid,
  i."penalty"::float8                          AS penalty,
  (i."amountDue" - i."amountPaid")::float8     AS amount_outstanding,
  i."status"::text                             AS status,
  i."paidAt"                                   AS paid_at,
  -- Days past due is only meaningful on an installment that is actually late;
  -- publishing it as a positive number on a paid one would invite a wrong answer.
  CASE WHEN i."status" = 'OVERDUE'
       THEN GREATEST(0, CURRENT_DATE - i."dueDate"::date)
       ELSE 0 END::int                         AS days_past_due
FROM "Installment" i;

-- Borrowers: identity minimised. No national ID, no reachable phone.
DROP VIEW IF EXISTS riri_borrowers CASCADE;
CREATE VIEW riri_borrowers WITH (security_invoker = true) AS
SELECT
  b."id"                                                                  AS id,
  b."orgId"                                                               AS org_id,
  NULLIF(btrim(coalesce(b."firstName", '') || ' ' || coalesce(b."otherName", '')), '') AS name,
  ('***' || right(b."phone", 3))                                          AS phone_masked,
  b."kycStatus"::text                                                     AS kyc_status,
  b."creditScore"                                                         AS credit_score,
  b."riskBand"                                                            AS risk_band,
  b."loanLimit"::float8                                                   AS loan_limit,
  b."graduationCount"                                                     AS graduation_count,
  b."gender"                                                              AS gender,
  b."locationType"                                                        AS location_type,
  b."createdAt"                                                           AS created_at
FROM "Borrower" b;

-- Products: the catalogue a loan was priced from.
DROP VIEW IF EXISTS riri_products CASCADE;
CREATE VIEW riri_products WITH (security_invoker = true) AS
SELECT
  p."id"                      AS id,
  p."orgId"                   AS org_id,
  p."name"                    AS name,
  p."interestRate"::float8    AS interest_rate,
  p."interestMethod"          AS interest_method,
  p."minPrincipal"::float8    AS min_principal,
  p."maxPrincipal"::float8    AS max_principal,
  p."repaymentPeriod"         AS repayment_period,
  p."repaymentPeriodUnit"     AS repayment_period_unit,
  p."disbursementMode"::text  AS disbursement_mode,
  p."isActive"                AS is_active,
  p."createdAt"               AS created_at
FROM "Product" p;

-- Applications: the origination funnel and its training labels.
DROP VIEW IF EXISTS riri_applications CASCADE;
CREATE VIEW riri_applications WITH (security_invoker = true) AS
SELECT
  a."id"                          AS id,
  a."orgId"                       AS org_id,
  a."borrowerId"                  AS borrower_id,
  a."productId"                   AS product_id,
  a."amountRequested"::float8     AS amount_requested,
  a."status"::text                AS status,
  a."score"                       AS score,
  a."pd"::float8                  AS pd,
  a."decision"                    AS decision,
  a."fusionEngine"                AS fusion_engine,
  a."outcome"                     AS outcome,
  a."daysToDefault"               AS days_to_default,
  a."decidedAt"                   AS decided_at,
  a."createdAt"                   AS created_at
FROM "LoanApplication" a;

-- Disbursements: money leaving. Borrower phone and the raw Daraja payload stay out.
DROP VIEW IF EXISTS riri_disbursements CASCADE;
CREATE VIEW riri_disbursements WITH (security_invoker = true) AS
SELECT
  d."id"                AS id,
  d."orgId"             AS org_id,
  d."loanId"            AS loan_id,
  d."amount"::float8    AS amount,
  d."state"::text       AS state,
  d."payeeName"         AS payee_name,
  d."makerId"           AS maker_id,
  d."checkerId"         AS checker_id,
  d."createdAt"         AS created_at,
  -- A confirmed disbursement's last write IS its settlement; the console's
  -- "disbursed today" tile has always read it that way.
  d."updatedAt"         AS settled_at
FROM "Disbursement" d;

-- Payments: paybill receipts and STK repayments as ONE stream. This union is the
-- semantic layer earning its keep — "collected" is one concept to a lender, but
-- two tables to the database.
DROP VIEW IF EXISTS riri_payments CASCADE;
CREATE VIEW riri_payments WITH (security_invoker = true) AS
SELECT
  r."id"                                  AS id,
  r."orgId"                               AS org_id,
  r."allocatedLoanId"                     AS loan_id,
  r."amount"::float8                      AS amount,
  'PAYBILL'::text                         AS channel,
  r."transId"                             AS receipt,
  r."createdAt"                           AS received_at,
  (r."allocatedLoanId" IS NOT NULL)       AS allocated
FROM "C2BReceipt" r
UNION ALL
SELECT
  p."id"                                  AS id,
  p."orgId"                               AS org_id,
  p."loanId"                              AS loan_id,
  p."amount"::float8                      AS amount,
  'STK'::text                             AS channel,
  p."mpesaReceipt"                        AS receipt,
  p."updatedAt"                           AS received_at,
  (p."loanId" IS NOT NULL)                AS allocated
FROM "PaymentIntent" p
WHERE p."state" = 'SUCCESS';

-- Scores: the closed ML loop (features and reason JSON deliberately not published).
DROP VIEW IF EXISTS riri_scores CASCADE;
CREATE VIEW riri_scores WITH (security_invoker = true) AS
SELECT
  s."id"              AS id,
  s."orgId"           AS org_id,
  s."borrowerId"      AS borrower_id,
  s."applicationId"   AS application_id,
  s."modelKind"       AS model_kind,
  s."modelVersion"    AS model_version,
  s."score"           AS score,
  s."pd"::float8      AS pd,
  s."riskBand"        AS risk_band,
  s."outcome"         AS outcome,
  s."createdAt"       AS created_at
FROM "ScoreSnapshot" s;

-- Staff: name and role only. passwordHash, otpSecret, email and phone are not
-- published — an analytics surface is never a reason to expose a credential.
DROP VIEW IF EXISTS riri_staff CASCADE;
CREATE VIEW riri_staff WITH (security_invoker = true) AS
SELECT
  u."id"                                                                  AS id,
  u."orgId"                                                               AS org_id,
  NULLIF(btrim(coalesce(u."firstName", '') || ' ' || coalesce(u."otherName", '')), '') AS name,
  u."title"                                                               AS title,
  u."status"::text                                                        AS status,
  u."branchId"                                                            AS branch_id,
  u."isFieldAgent"                                                        AS is_field_agent,
  u."lastLoginAt"                                                         AS last_login_at,
  u."createdAt"                                                           AS created_at
FROM "StaffUser" u;

DROP VIEW IF EXISTS riri_branches CASCADE;
CREATE VIEW riri_branches WITH (security_invoker = true) AS
SELECT
  br."id"      AS id,
  br."orgId"   AS org_id,
  br."name"    AS name,
  br."parentId" AS parent_id,
  br."active"  AS active
FROM "Branch" br;

-- Field visits: where the agents went (notes and photos excluded).
DROP VIEW IF EXISTS riri_field_visits CASCADE;
CREATE VIEW riri_field_visits WITH (security_invoker = true) AS
SELECT
  v."id"              AS id,
  v."orgId"           AS org_id,
  v."borrowerId"      AS borrower_id,
  v."applicationId"   AS application_id,
  v."kind"::text      AS kind,
  v."status"::text    AS status,
  v."agentId"         AS agent_id,
  v."distanceKm"      AS distance_km,
  v."allocatedAt"     AS allocated_at,
  v."visitedAt"       AS visited_at,
  v."createdAt"       AS created_at
FROM "FieldVisit" v;

-- Collections: the chase, as counts and states. The free-text notes on a call and
-- the detail on a hardship ticket are the most sensitive prose in the system and
-- are not published to an analytics surface.
DROP VIEW IF EXISTS riri_promises CASCADE;
CREATE VIEW riri_promises WITH (security_invoker = true) AS
SELECT
  p."id"                  AS id,
  p."orgId"               AS org_id,
  p."loanId"              AS loan_id,
  p."borrowerId"          AS borrower_id,
  p."amount"::float8      AS amount,
  p."paidAmount"::float8  AS paid_amount,
  p."dueDate"             AS due_date,
  p."status"::text        AS status,
  p."createdBy"           AS created_by,
  p."resolvedAt"          AS resolved_at,
  p."createdAt"           AS created_at
FROM "PromiseToPay" p;

DROP VIEW IF EXISTS riri_calls CASCADE;
CREATE VIEW riri_calls WITH (security_invoker = true) AS
SELECT
  c."id"            AS id,
  c."orgId"         AS org_id,
  c."loanId"        AS loan_id,
  c."borrowerId"    AS borrower_id,
  c."outcome"::text AS outcome,
  c."createdBy"     AS created_by,
  c."createdAt"     AS created_at
FROM "CollectionCall" c;

DROP VIEW IF EXISTS riri_tickets CASCADE;
CREATE VIEW riri_tickets WITH (security_invoker = true) AS
SELECT
  t."id"            AS id,
  t."orgId"         AS org_id,
  t."borrowerId"    AS borrower_id,
  t."loanId"        AS loan_id,
  t."kind"::text    AS kind,
  t."status"::text  AS status,
  t."assignedToId"  AS assigned_to_id,
  t."resolvedAt"    AS resolved_at,
  t."createdAt"     AS created_at
FROM "CollectionTicket" t;
