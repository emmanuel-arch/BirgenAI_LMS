-- ─────────────────────────────────────────────────────────────────────────────
-- BirgenAI_LMS — the runtime role. THE OTHER HALF OF rls.sql.
--
-- ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────
--
-- rls.sql enables RLS, FORCEs it, and writes a correct tenant_isolation policy on
-- all 61 tenant tables. Its header explains FORCE like this, and it is right as far
-- as it goes:
--
--     "FORCE is essential: our connection role owns these tables, and owners
--      bypass RLS unless forced."
--
-- There are TWO exemptions, not one, and FORCE only closes the first:
--
--   1. TABLE OWNER   — bypasses RLS on tables it owns.  Closed by FORCE. ✓
--   2. BYPASSRLS     — a role attribute. Policies are NEVER CONSULTED for such a
--                      role, on any table, forced or not. FORCE does nothing to it.
--
-- The app connects to Supabase as `postgres`, and `postgres` has rolbypassrls.
-- Measured 11 Sep 2026: RLS on, FORCE on, policy correct, views security_invoker,
-- readpath stamping app.org_id properly — and a freshly created fixture org read
-- 515 loans instead of its own 4, with another org's balance visible to it. The
-- fence was decoration. `npm run test:riri` has been failing four assertions in its
-- RLS section for exactly this reason.
--
-- readpath.ts already anticipated it in a comment:
--   "the replica URL MUST be the `lms_app` role (NOBYPASSRLS) — a replica reached
--    as postgres would serve every tenant's book to every tenant."
-- That role is in the design. It has never existed. This file creates it.
--
-- ── WHAT CHANGES, AND THE FAILURE MODE IT SWAPS ──────────────────────────────
--
-- Today an unscoped query returns EVERYTHING. Afterwards it returns NOTHING —
-- app_org_id() is NULL, `"orgId" = NULL` is NULL, the row is filtered. That is the
-- fail-closed behaviour rls.sql was written for, but it means anything currently
-- working by accident will now come back empty rather than loud.
--
-- Pre-flight, measured 11 Sep 2026 on this database:
--   · 66 tables. 61 with RLS, and EVERY one has a policy — no table returns zero
--     rows merely because RLS was enabled and a policy forgotten.
--   · 5 without RLS: Org, PlatformAdmin, RateLimit, SharingPool, SharingPoolMember
--     — exactly the set rls.sql documents as deliberate.
--   · Only TWO code paths bypass the tenant stamp (src/lib/ratelimit.ts, via
--     rawPrisma), and both touch RateLimit, which has RLS off. They keep working.
-- So the blast radius is small. Verify it anyway — scripts/verify-rls-role.ts.
--
-- ── RUNNING IT ───────────────────────────────────────────────────────────────
--
-- Needs a role that can CREATE ROLE — on Supabase, `postgres` via DIRECT_URL
-- (port 5432), NOT the pooler. Supply the password as a psql variable so it never
-- enters git:
--
--     psql "$DIRECT_URL" -v app_password="'<a strong password>'" \
--          -f prisma/rls-app-role.sql
--
-- Then, and only after scripts/verify-rls-role.ts passes against the new role:
--
--     DATABASE_URL  → the lms_app user      (runtime; RLS applies)
--     DIRECT_URL    → stays postgres        (migrations need DDL)
--
-- On Supabase's pooler the username carries the project ref:
--     postgresql://lms_app.<project-ref>:<password>@<host>:6543/postgres
--
-- Idempotent. Safe to re-run, and re-running is how you re-grant after a migration
-- if the default privileges below were ever missed.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. The role ──────────────────────────────────────────────────────────────
-- NOBYPASSRLS is the entire point of this file. NOSUPERUSER because a superuser
-- bypasses RLS regardless of the attribute.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_app') THEN
    EXECUTE format(
      'CREATE ROLE lms_app LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT',
      current_setting('app_password', false)
    );
  ELSE
    EXECUTE format('ALTER ROLE lms_app PASSWORD %L', current_setting('app_password', false));
  END IF;
END $$;

-- Belt and braces: if the role already existed with the wrong attributes, fix them.
ALTER ROLE lms_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

-- ── 2. Privileges on what exists today ───────────────────────────────────────
GRANT USAGE ON SCHEMA public TO lms_app;

-- Tables AND views. The riri_* views are security_invoker, so a SELECT through them
-- is evaluated with lms_app's own RLS — which is the property Riri's read path relies
-- on and the reason those views were built that way.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lms_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO lms_app;

-- NOT granted, deliberately: TRUNCATE, REFERENCES, TRIGGER, and anything on other
-- schemas. The runtime never needs them, and a role that cannot TRUNCATE cannot be
-- talked into emptying a table.

-- ── 3. Privileges on what migrations will create ─────────────────────────────
-- Without this the app breaks on the FIRST Prisma migration after the cutover: the
-- new table is owned by postgres and lms_app has no grant on it. Silent, total, and
-- exactly the kind of thing that surfaces at 9am on a Monday.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lms_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO lms_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO lms_app;

-- ⚠ A NEW TENANT TABLE STILL NEEDS ITS POLICY. Default privileges grant access; they
-- do not enable RLS. Add the table to the array in rls.sql and re-run `npm run db:rls`
-- in the same change that creates it, or it ships readable across every tenant.

-- ── 4. Prove the attribute actually took ─────────────────────────────────────
DO $$
DECLARE bypass boolean; super boolean;
BEGIN
  SELECT rolbypassrls, rolsuper INTO bypass, super FROM pg_roles WHERE rolname = 'lms_app';
  IF bypass IS DISTINCT FROM false OR super IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'lms_app still bypasses RLS (bypassrls=%, superuser=%) — do NOT move DATABASE_URL onto it', bypass, super;
  END IF;
  RAISE NOTICE 'lms_app ready: NOSUPERUSER, NOBYPASSRLS, granted on public.';
  RAISE NOTICE 'Next: run scripts/verify-rls-role.ts against the new connection string BEFORE switching DATABASE_URL.';
END $$;
