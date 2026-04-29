-- supabase/migrations/003_functions.sql
-- ADR-004: Two-Phase Booking — funciones que encapsulan la lógica de locks

-- ─── reserve_slot ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reserve_slot(
  p_slot_id    uuid,
  p_session_id text,
  p_ttl_minutes int DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_booking bookings;
BEGIN
  SELECT * INTO v_booking
  FROM bookings
  WHERE id = p_slot_id
    AND status = 'available'
  FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_available');
  END IF;

  UPDATE bookings SET
    status         = 'reserved',
    reserved_until = NOW() + (p_ttl_minutes || ' minutes')::interval,
    session_id     = p_session_id
  WHERE id = p_slot_id;

  RETURN jsonb_build_object(
    'success',        true,
    'id',             p_slot_id,
    'reserved_until', NOW() + (p_ttl_minutes || ' minutes')::interval
  );

EXCEPTION
  WHEN lock_not_available THEN
    RETURN jsonb_build_object('success', false, 'reason', 'concurrent_lock');
END;
$$;

-- ─── confirm_booking ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION confirm_booking(
  p_session_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_booking_id uuid;
BEGIN
  UPDATE bookings
  SET
    status         = 'confirmed',
    session_id     = NULL,
    reserved_until = NULL
  WHERE session_id     = p_session_id
    AND status         = 'reserved'
    AND reserved_until > NOW()
  RETURNING id INTO v_booking_id;

  IF v_booking_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'expired_or_not_found');
  END IF;

  RETURN jsonb_build_object('success', true, 'booking_id', v_booking_id);
END;
$$;

-- ─── release_slot ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION release_slot(
  p_session_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rows_affected int;
BEGIN
  UPDATE bookings
  SET
    status         = 'available',
    session_id     = NULL,
    reserved_until = NULL
  WHERE session_id = p_session_id
    AND status     = 'reserved';

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'released', v_rows_affected);
END;
$$;
