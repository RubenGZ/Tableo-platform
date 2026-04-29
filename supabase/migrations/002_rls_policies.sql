-- supabase/migrations/002_rls_policies.sql
-- ADR-005: Row Level Security — aislamiento multi-tenant

-- ACTIVAR RLS EN TODAS LAS TABLAS
ALTER TABLE businesses         ENABLE ROW LEVEL SECURITY;
ALTER TABLE resources          ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocking_rules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers          ENABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════
-- POLÍTICAS: DASHBOARD (autenticado con auth.uid())
-- ══════════════════════════════════════════════════

CREATE POLICY "owners_manage_own_business"
ON businesses
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

CREATE POLICY "owners_manage_own_resources"
ON resources
USING (
  business_id IN (
    SELECT id FROM businesses WHERE owner_id = auth.uid()
  )
);

CREATE POLICY "owners_see_own_bookings"
ON bookings
USING (
  resource_id IN (
    SELECT r.id FROM resources r
    JOIN businesses b ON r.business_id = b.id
    WHERE b.owner_id = auth.uid()
  )
);

CREATE POLICY "owners_see_own_customers"
ON customers
USING (
  business_id IN (
    SELECT id FROM businesses WHERE owner_id = auth.uid()
  )
);

CREATE POLICY "owners_manage_own_windows"
ON availability_windows
USING (
  resource_id IN (
    SELECT r.id FROM resources r
    JOIN businesses b ON r.business_id = b.id
    WHERE b.owner_id = auth.uid()
  )
);

CREATE POLICY "owners_manage_own_blocks"
ON blocking_rules
USING (
  resource_id IN (
    SELECT r.id FROM resources r
    JOIN businesses b ON r.business_id = b.id
    WHERE b.owner_id = auth.uid()
  )
);

-- ══════════════════════════════════════════════════
-- POLÍTICAS: PÁGINA PÚBLICA (anónimo)
-- ══════════════════════════════════════════════════

CREATE POLICY "public_read_active_businesses"
ON businesses FOR SELECT
USING (true);

CREATE POLICY "public_read_active_resources"
ON resources FOR SELECT
USING (active = true);

CREATE POLICY "public_read_available_slots"
ON bookings FOR SELECT
USING (status IN ('available', 'reserved'));

CREATE POLICY "public_create_booking"
ON bookings FOR INSERT
WITH CHECK (status = 'pending');

CREATE POLICY "public_update_own_reservation"
ON bookings FOR UPDATE
USING (session_id = current_setting('app.session_id', true));
