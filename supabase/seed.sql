-- supabase/seed.sql
-- Datos de ejemplo para desarrollo local: un salón de belleza con 3 profesionales

-- Nota: insertar primero en auth.users es necesario para satisfacer FK businesses.owner_id
-- En Supabase local, crear el usuario de prueba desde el Dashboard o via API primero,
-- luego substituir el UUID real aquí.
-- Para entorno local con supabase cli: este seed se ejecuta con `supabase db seed`

DO $$
DECLARE
  v_owner_id   uuid := gen_random_uuid();
  v_business_id uuid;
  v_laura_id   uuid;
  v_maria_id   uuid;
  v_carlos_id  uuid;
BEGIN

INSERT INTO businesses (id, name, slug, sector_type, timezone_id, config, owner_id)
VALUES (
  gen_random_uuid(),
  'Salon Luna',
  'salon-luna',
  'beauty',
  'Europe/Madrid',
  '{
    "branding": {
      "accent_color": "#e91e8c",
      "accent_dark": "#c2185b"
    },
    "booking": {
      "min_advance_hours": 2,
      "max_advance_days": 30,
      "cancellation_hours": 24,
      "buffer_minutes": 0
    }
  }'::jsonb,
  v_owner_id
)
RETURNING id INTO v_business_id;

INSERT INTO resources (id, business_id, resource_type, name, active, metadata)
VALUES (gen_random_uuid(), v_business_id, 'staff', 'Laura García', true,
  '{"specialties": ["corte", "color", "mechas"], "duration_default": 60}'::jsonb)
RETURNING id INTO v_laura_id;

INSERT INTO resources (id, business_id, resource_type, name, active, metadata)
VALUES (gen_random_uuid(), v_business_id, 'staff', 'María López', true,
  '{"specialties": ["manicura", "pedicura", "uñas"], "duration_default": 45}'::jsonb)
RETURNING id INTO v_maria_id;

INSERT INTO resources (id, business_id, resource_type, name, active, metadata)
VALUES (gen_random_uuid(), v_business_id, 'staff', 'Carlos Ruiz', true,
  '{"specialties": ["barbería", "corte caballero"], "duration_default": 30}'::jsonb)
RETURNING id INTO v_carlos_id;

-- Horarios de Laura (Lun–Vie 9:00–19:00, Sáb 9:00–14:00)
INSERT INTO availability_windows (resource_id, day_of_week, open_time, close_time) VALUES
  (v_laura_id, 0, '09:00', '19:00'), (v_laura_id, 1, '09:00', '19:00'),
  (v_laura_id, 2, '09:00', '19:00'), (v_laura_id, 3, '09:00', '19:00'),
  (v_laura_id, 4, '09:00', '19:00'), (v_laura_id, 5, '09:00', '14:00');

-- Horarios de María (Mar–Sáb 10:00–20:00)
INSERT INTO availability_windows (resource_id, day_of_week, open_time, close_time) VALUES
  (v_maria_id, 1, '10:00', '20:00'), (v_maria_id, 2, '10:00', '20:00'),
  (v_maria_id, 3, '10:00', '20:00'), (v_maria_id, 4, '10:00', '20:00'),
  (v_maria_id, 5, '10:00', '20:00');

-- Horarios de Carlos (Lun–Sáb 08:00–18:00)
INSERT INTO availability_windows (resource_id, day_of_week, open_time, close_time) VALUES
  (v_carlos_id, 0, '08:00', '18:00'), (v_carlos_id, 1, '08:00', '18:00'),
  (v_carlos_id, 2, '08:00', '18:00'), (v_carlos_id, 3, '08:00', '18:00'),
  (v_carlos_id, 4, '08:00', '18:00'), (v_carlos_id, 5, '08:00', '18:00');

END $$;
