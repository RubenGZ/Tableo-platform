-- supabase/migrations/006_claim_slot.sql
-- ADR-010: claim_slot() para generación dinámica de slots (Phase 2)
-- A diferencia de reserve_slot() (migration 003), esta función crea
-- la fila de booking en lugar de buscar una pre-existente.

-- 1. customer_id pasa a nullable.
--    Semánticamente correcto: una reserva 'reserved' no tiene cliente aún.
--    El cliente se asigna en confirmBooking() (fase 2 del two-phase booking).
ALTER TABLE bookings
  ALTER COLUMN customer_id DROP NOT NULL;

-- 2. CHECK: customer_id obligatorio en estados finales.
ALTER TABLE bookings
  ADD CONSTRAINT bookings_customer_required
  CHECK (
    status NOT IN ('confirmed', 'completed') OR customer_id IS NOT NULL
  );

-- 3. claim_slot() — atómica: check de conflicto + INSERT en una sola transacción.
CREATE OR REPLACE FUNCTION claim_slot(
  p_resource_id uuid,
  p_start_at    timestamptz,
  p_end_at      timestamptz,
  p_session_id  text,
  p_ttl_minutes int DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM bookings
    WHERE resource_id = p_resource_id
      AND status IN ('reserved', 'confirmed')
      AND start_at < p_end_at
      AND end_at   > p_start_at
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_available');
  END IF;

  INSERT INTO bookings (
    resource_id,
    start_at,
    end_at,
    status,
    reserved_until,
    session_id,
    metadata
  )
  VALUES (
    p_resource_id,
    p_start_at,
    p_end_at,
    'reserved',
    NOW() + (p_ttl_minutes || ' minutes')::interval,
    p_session_id,
    '{}'::jsonb
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'success',        true,
    'booking_id',     v_id,
    'reserved_until', NOW() + (p_ttl_minutes || ' minutes')::interval
  );

EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'reason', 'concurrent_lock');
END;
$$;
