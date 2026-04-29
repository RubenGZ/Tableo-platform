-- supabase/migrations/007_ai_booking.sql
-- AI Agent API Layer: nuevo status y columna de origen

-- 1. Ampliar CHECK de status para incluir pending_ai_confirmation
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN (
    'pending', 'reserved', 'confirmed', 'cancelled',
    'completed', 'no_show', 'disputed', 'pending_ai_confirmation'
  ));

-- 2. Columna que identifica reservas originadas desde la API de IA
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS ai_source boolean NOT NULL DEFAULT false;

-- 3. Índice para el dashboard — filtra reservas de IA pendientes de aprobación
CREATE INDEX IF NOT EXISTS idx_bookings_ai_pending
  ON bookings (ai_source, status)
  WHERE ai_source = true AND status = 'pending_ai_confirmation';
