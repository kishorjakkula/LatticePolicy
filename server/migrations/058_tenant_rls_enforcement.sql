BEGIN;

-- Makes tenant row-level security enforceable at runtime.
--
-- RLS has been enabled on tenant tables since 001_init.sql, but the API
-- connects as the role that owns the tables (and, in Docker Compose, as a
-- superuser), and Postgres does not apply policies to a table's owner. The
-- policies were therefore never evaluated.
--
-- This migration adds a restricted, non-owner role that withTenantTx can
-- switch into for the length of a tenant transaction (SET LOCAL ROLE) when
-- TENANT_RLS_ENFORCED is on. Inside that role every policy applies. The
-- owner connection is still used for migrations and for the few cross-tenant
-- worker queries that claim rows before entering a tenant transaction.
--
-- It also closes the policy gaps that would otherwise make enforcement
-- unsafe: four tables had RLS enabled with no policy (default deny for a
-- non-owner), and three tenant tables had no RLS at all.
--
-- Nothing here changes behavior while TENANT_RLS_ENFORCED is off.

-- 1. Restricted role -----------------------------------------------------------
-- Roles are cluster-wide, so tolerate it already existing. A database user
-- without CREATEROLE cannot create it; in that case the migration still
-- applies and an operator creates the role before turning enforcement on.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lattice_tenant_rls') THEN
    BEGIN
      CREATE ROLE lattice_tenant_rls NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'lattice_tenant_rls role not created (CREATEROLE required); create it before enabling TENANT_RLS_ENFORCED';
      WHEN duplicate_object THEN
        NULL;
    END;
  END IF;
END $$;

-- 2. Privileges ----------------------------------------------------------------
DO $$
DECLARE
  target_schema text := current_schema();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lattice_tenant_rls') THEN
    RETURN;
  END IF;

  -- Membership lets a non-superuser application role SET ROLE into it.
  BEGIN
    EXECUTE format('GRANT lattice_tenant_rls TO %I', current_user);
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'could not grant lattice_tenant_rls to %; grant it before enabling TENANT_RLS_ENFORCED', current_user;
  END;

  EXECUTE format('GRANT USAGE ON SCHEMA %I TO lattice_tenant_rls', target_schema);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO lattice_tenant_rls', target_schema);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO lattice_tenant_rls', target_schema);
  -- Tables and sequences added by later migrations (run by this same user).
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lattice_tenant_rls', target_schema);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO lattice_tenant_rls', target_schema);
  -- Migration bookkeeping is never tenant work.
  EXECUTE format('REVOKE ALL ON TABLE %I.schema_migrations FROM lattice_tenant_rls', target_schema);
END $$;

-- 3. Policies for tables that had RLS enabled but no policy -----------------
-- These child tables carry no tenant_id; scope them through their parent,
-- whose own tenant policy applies to the subquery.
DROP POLICY IF EXISTS tenant_isolation ON user_roles;
CREATE POLICY tenant_isolation ON user_roles
  USING (EXISTS (
    SELECT 1 FROM users u
     WHERE u.user_id = user_roles.user_id
       AND u.tenant_id = current_setting('app.tenant_id', true)))
  WITH CHECK (EXISTS (
    SELECT 1 FROM users u
     WHERE u.user_id = user_roles.user_id
       AND u.tenant_id = current_setting('app.tenant_id', true)));

DROP POLICY IF EXISTS tenant_isolation ON party_contacts;
CREATE POLICY tenant_isolation ON party_contacts
  USING (EXISTS (
    SELECT 1 FROM parties p
     WHERE p.party_id = party_contacts.party_id
       AND p.tenant_id = current_setting('app.tenant_id', true)))
  WITH CHECK (EXISTS (
    SELECT 1 FROM parties p
     WHERE p.party_id = party_contacts.party_id
       AND p.tenant_id = current_setting('app.tenant_id', true)));

DROP POLICY IF EXISTS tenant_isolation ON party_licenses;
CREATE POLICY tenant_isolation ON party_licenses
  USING (EXISTS (
    SELECT 1 FROM parties p
     WHERE p.party_id = party_licenses.party_id
       AND p.tenant_id = current_setting('app.tenant_id', true)))
  WITH CHECK (EXISTS (
    SELECT 1 FROM parties p
     WHERE p.party_id = party_licenses.party_id
       AND p.tenant_id = current_setting('app.tenant_id', true)));

DROP POLICY IF EXISTS tenant_isolation ON party_roles;
CREATE POLICY tenant_isolation ON party_roles
  USING (EXISTS (
    SELECT 1 FROM parties p
     WHERE p.party_id = party_roles.party_id
       AND p.tenant_id = current_setting('app.tenant_id', true)))
  WITH CHECK (EXISTS (
    SELECT 1 FROM parties p
     WHERE p.party_id = party_roles.party_id
       AND p.tenant_id = current_setting('app.tenant_id', true)));

-- 4. Tenant tables that had no RLS at all ----------------------------------------
ALTER TABLE auto_vehicles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON auto_vehicles;
CREATE POLICY tenant_isolation ON auto_vehicles
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE dwellings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dwellings;
CREATE POLICY tenant_isolation ON dwellings
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE short_rate_tables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON short_rate_tables;
CREATE POLICY tenant_isolation ON short_rate_tables
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

COMMIT;
