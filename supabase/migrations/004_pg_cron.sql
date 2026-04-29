-- supabase/migrations/004_pg_cron.sql
-- ADR-004: limpieza automática de reservas temporales expiradas
-- pg_cron está preinstalado en Supabase Pro

-- Ejecuta cada minuto: libera slots 'reserved' cuyo TTL ha expirado
SELECT cron.schedule(
  'cleanup-expired-reservations',
  '* * * * *',
  $$
    UPDATE bookings
    SET
      status         = 'available',
      session_id     = NULL,
      reserved_until = NULL
    WHERE status         = 'reserved'
      AND reserved_until < NOW()
  $$
);
