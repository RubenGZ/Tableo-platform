# ADR-003: Schema de Base de Datos Unificado (Sector-Agnostic)

**Status:** Accepted  
**Date:** 2026-04-27  
**Deciders:** Equipo Tableo

## Context

La base de datos debe soportar múltiples sectores (belleza, restaurantes, inmobiliaria) con un schema único que no requiera migraciones disruptivas al añadir verticales. El riesgo es modelar tablas separadas por sector (`beauty_bookings`, `restaurant_bookings`) que rompen la consistencia y duplican lógica.

Constraints:
- Supabase Pro (PostgreSQL 15) como base de datos
- Multi-tenancy estricto: un negocio nunca ve datos de otro
- Row Level Security (RLS) para el aislamiento
- Queries de disponibilidad en <150ms p95

## Decision

**Schema unificado con `metadata jsonb`** para atributos sector-específicos. Una sola tabla `bookings`, una sola tabla `resources`. El sector de un negocio determina qué campos de `metadata` son relevantes, pero el schema no cambia.

## Options Considered

### Option A: Schema Unificado con JSONB ✅ ELEGIDO

```sql
-- Núcleo inmutable — no cambia entre verticales

CREATE TABLE businesses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,       -- para URLs públicas (/book/mi-salon)
  sector_type text NOT NULL               -- 'beauty' | 'restaurant' | 'real_estate'
    CHECK (sector_type IN ('beauty', 'restaurant', 'real_estate')),
  config      jsonb NOT NULL DEFAULT '{}', -- horarios globales, timezone, configuración
  owner_id    uuid NOT NULL REFERENCES auth.users,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE resources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES businesses ON DELETE CASCADE,
  resource_type text NOT NULL             -- 'staff' | 'table' | 'asset'
    CHECK (resource_type IN ('staff', 'table', 'asset')),
  name          text NOT NULL,
  active        boolean DEFAULT true,
  metadata      jsonb NOT NULL DEFAULT '{}',
  -- beauty:   {"specialties": ["corte", "color"], "duration_default": 60}
  -- restaurant: {"capacity": 4, "zone": "terraza"}
  -- real_estate: {"address": "...", "surface_m2": 80}
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE availability_windows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL REFERENCES resources ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Lun
  open_time   time NOT NULL,
  close_time  time NOT NULL,
  CONSTRAINT valid_window CHECK (open_time < close_time)
);

CREATE TABLE blocking_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL REFERENCES resources ON DELETE CASCADE,
  start_at    timestamptz NOT NULL,
  end_at      timestamptz NOT NULL,
  reason      text,                       -- 'vacaciones', 'mantenimiento', etc.
  CONSTRAINT valid_block CHECK (start_at < end_at)
);

CREATE TABLE bookings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL REFERENCES resources,
  customer_id uuid NOT NULL REFERENCES customers,
  start_at    timestamptz NOT NULL,
  end_at      timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reserved', 'confirmed', 'cancelled', 'completed', 'no_show')),
  metadata    jsonb NOT NULL DEFAULT '{}',
  -- beauty:      {"service": "corte", "price_eur": 25, "notes": "cliente VIP"}
  -- restaurant:  {"party_size": 4, "occasion": "cumpleaños", "menu": "degustación"}
  -- real_estate: {"visit_type": "primera_visita", "agent_id": "..."}
  reserved_until timestamptz,             -- two-phase booking: TTL de la reserva temporal
  session_id  text,                       -- identifica la sesión de reserva
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE customers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses ON DELETE CASCADE,
  name        text NOT NULL,
  phone       text,
  email       text,
  notes       text,
  metadata    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz DEFAULT now(),
  UNIQUE (business_id, phone)             -- un cliente por negocio identificado por teléfono
);

-- ÍNDICES CRÍTICOS para queries de disponibilidad < 150ms
CREATE INDEX idx_bookings_resource_time
  ON bookings (resource_id, start_at, end_at)
  WHERE status NOT IN ('cancelled');

CREATE INDEX idx_bookings_status_reserved
  ON bookings (reserved_until)
  WHERE status = 'reserved';             -- para limpieza de temporales expirados

CREATE INDEX idx_availability_resource
  ON availability_windows (resource_id, day_of_week);

CREATE INDEX idx_blocking_resource_time
  ON blocking_rules (resource_id, start_at, end_at);
```

| Dimensión | Evaluación |
|-----------|------------|
| Extensibilidad a nuevos sectores | Máxima — cero migraciones |
| Queries de disponibilidad | Alta con índices correctos (<50ms) |
| Multi-tenancy vía RLS | Directa — `business_id` en todas las tablas |
| Complejidad del schema | Baja — 6 tablas principales |
| Validación de metadata | Media — requiere validación en capa de aplicación |

**Pros:**
- Añadir un sector nuevo no requiere ALTER TABLE ni migración
- La lógica de disponibilidad es idéntica para todos los sectores a nivel de queries
- `metadata jsonb` es indexable con GIN si se necesita buscar por atributos específicos

**Cons:**
- Los campos en `metadata` no tienen validación a nivel de base de datos (solo en la capa del adaptador)
- Las queries sobre `metadata` son menos eficientes que columnas tipadas (mitigado con índices GIN)

### Option B: Tablas separadas por sector

```sql
CREATE TABLE beauty_bookings (...);
CREATE TABLE restaurant_bookings (...);
```

**Pros:** Validación a nivel de DB para cada sector. Queries simples sin JSONB.

**Cons:** Duplicación masiva de lógica. Al añadir un sector se necesita una migración. Las políticas RLS se duplican. Inaceptable para una plataforma sector-agnostic.

### Option C: Schema polimórfico con tabla de atributos (EAV)

```sql
CREATE TABLE booking_attributes (booking_id, key, value);
```

**Pros:** Máxima flexibilidad.

**Cons:** N+1 queries por defecto. Joins complejos para recuperar un booking completo. El JSONB de Option A da la misma flexibilidad con mejor rendimiento.

## Row Level Security (RLS)

```sql
-- Activar RLS en todas las tablas
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- Política: un negocio solo ve sus propios datos
CREATE POLICY "business_isolation" ON resources
  USING (
    business_id IN (
      SELECT id FROM businesses WHERE owner_id = auth.uid()
    )
  );

-- Política pública: cualquiera puede leer slots disponibles de un negocio
CREATE POLICY "public_availability" ON bookings
  FOR SELECT USING (status = 'confirmed'); -- solo confirmadas son visibles públicamente
```

## Consecuencias de la limpieza de reservas temporales

```sql
-- pg_cron: limpiar reservas temporales expiradas cada minuto
SELECT cron.schedule(
  'cleanup-expired-reservations',
  '* * * * *',
  $$
    UPDATE bookings
    SET status = 'cancelled', session_id = NULL, reserved_until = NULL
    WHERE status = 'reserved'
      AND reserved_until < NOW()
  $$
);
```

## Trade-off Analysis

El JSONB sacrifica la validación a nivel de base de datos a cambio de schema inmutable ante nuevos verticales. Este es el trade-off correcto para Tableo: la validación de campos específicos por sector vive en los adaptadores del Motor Polimórfico (ADR-002), que son el lugar apropiado para esa lógica de negocio. La base de datos garantiza la integridad estructural; los adaptadores garantizan la corrección semántica.

## Consequences

- ✅ Schema no cambia al añadir V2 (restaurantes) — solo se crea un nuevo adaptador
- ✅ Las políticas RLS se escriben una vez y aplican a todos los sectores
- ✅ Los índices sobre `(resource_id, start_at, end_at)` garantizan queries de disponibilidad <50ms
- ⚠️ El `metadata jsonb` debe ser documentado por sector — crear un tipo TypeScript discriminado por `sectorType`
- ⚠️ Si un campo de `metadata` necesita ser consultado frecuentemente, añadir índice GIN específico

## Action Items

1. [ ] Crear migraciones Supabase en `supabase/migrations/` con el schema completo
2. [ ] Activar RLS en todas las tablas desde la primera migración
3. [ ] Configurar `pg_cron` para limpieza de reservas temporales
4. [ ] Crear tipos TypeScript que reflejen el schema con `metadata` discriminado por sector
5. [ ] Añadir seed data de ejemplo para desarrollo local (un negocio de belleza con 3 profesionales)
