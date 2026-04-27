# ADR-005: Multi-tenancy via Row Level Security (RLS)

**Status:** Accepted  
**Date:** 2026-04-27  
**Deciders:** Equipo Tableo

## Context

Tableo es una plataforma SaaS donde múltiples negocios independientes comparten la misma base de datos. El aislamiento entre negocios es un requisito de seguridad crítico: la peluquería A nunca debe poder ver ni modificar los datos de la peluquería B, ni siquiera en caso de bug en la capa de aplicación.

Hay dos superficies de acceso a los datos:
1. **Dashboard del negocio** (autenticado) — el dueño gestiona sus reservas y recursos
2. **Página pública de reserva** (no autenticado) — el cliente final reserva un slot

Ambas superficies requieren políticas de aislamiento distintas.

## Decision

**Row Level Security (RLS) de PostgreSQL** como capa primaria de aislamiento multi-tenant, implementada directamente en Supabase. El aislamiento vive en la base de datos, no en la capa de aplicación. Un bug en Next.js no puede filtrar datos entre negocios.

## Options Considered

### Option A: RLS en Supabase ✅ ELEGIDO

```sql
-- ACTIVAR RLS EN TODAS LAS TABLAS
ALTER TABLE businesses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE resources        ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocking_rules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers        ENABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════
-- POLÍTICAS: DASHBOARD DEL NEGOCIO (autenticado)
-- ══════════════════════════════════════════════════

-- Un dueño solo ve y modifica sus propios negocios
CREATE POLICY "owners_manage_own_business"
ON businesses
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

-- Un dueño solo ve los recursos de sus negocios
CREATE POLICY "owners_manage_own_resources"
ON resources
USING (
  business_id IN (
    SELECT id FROM businesses WHERE owner_id = auth.uid()
  )
);

-- Un dueño solo ve las reservas de sus negocios
CREATE POLICY "owners_see_own_bookings"
ON bookings
USING (
  resource_id IN (
    SELECT r.id FROM resources r
    JOIN businesses b ON r.business_id = b.id
    WHERE b.owner_id = auth.uid()
  )
);

-- Un dueño solo ve los clientes de sus negocios
CREATE POLICY "owners_see_own_customers"
ON customers
USING (
  business_id IN (
    SELECT id FROM businesses WHERE owner_id = auth.uid()
  )
);

-- ══════════════════════════════════════════════════
-- POLÍTICAS: PÁGINA PÚBLICA DE RESERVA (anónimo)
-- ══════════════════════════════════════════════════

-- Cualquiera puede ver negocios activos (para la página de reserva pública)
CREATE POLICY "public_read_active_businesses"
ON businesses FOR SELECT
USING (true);  -- el filtro real es por slug en la query de la aplicación

-- Cualquiera puede ver recursos activos de un negocio (para mostrar profesionales)
CREATE POLICY "public_read_active_resources"
ON resources FOR SELECT
USING (active = true);

-- Cualquiera puede ver slots disponibles (para el calendario de reservas)
CREATE POLICY "public_read_available_slots"
ON bookings FOR SELECT
USING (status IN ('available', 'reserved'));  -- NO 'confirmed' con datos de cliente

-- El cliente puede crear una reserva (anónimo)
CREATE POLICY "public_create_booking"
ON bookings FOR INSERT
WITH CHECK (status = 'pending');

-- El cliente puede actualizar SU reserva (por session_id)
CREATE POLICY "public_update_own_reservation"
ON bookings FOR UPDATE
USING (session_id = current_setting('app.session_id', true));
```

| Dimensión | Evaluación |
|-----------|------------|
| Seguridad de aislamiento | Máxima — enforced en DB, no en app |
| Complejidad de políticas | Media — requieren diseño cuidadoso |
| Rendimiento | Alta — RLS añade ~1-5ms por query |
| Mantenimiento | Baja — las políticas se escriben una vez |
| Riesgo de misconfiguration | Medio — una política mal escrita puede filtrar datos |

**Pros:**
- El aislamiento es garantizado a nivel de base de datos, no de aplicación
- Un bug en Next.js o en Claude Code no puede filtrar datos entre negocios
- Supabase gestiona la autenticación y pasa `auth.uid()` automáticamente a RLS
- No necesitamos filtros manuales `WHERE business_id = ?` en cada query de la aplicación

**Cons:**
- Las políticas RLS mal escritas son silenciosamente permisivas o demasiado restrictivas
- Debuggear RLS puede ser no intuitivo (las queries fallan sin mensaje de error claro)
- Las políticas con subqueries (`IN (SELECT...)`) pueden ser lentas si no están bien indexadas

### Option B: Filtros de tenant en capa de aplicación

```typescript
// Cada query incluye manualmente el filtro de tenant
const bookings = await supabase
  .from('bookings')
  .select('*')
  .eq('business_id', currentUser.businessId)  // filtro manual
```

**Pros:** Simple de entender. Menos configuración en la DB.

**Cons:** Un solo `await supabase.from('bookings').select('*')` sin el filtro manual filtra TODOS los datos de todos los negocios. Un bug de Claude Code o un olvido humano = brecha de seguridad. Inaceptable en producción.

### Option C: Schema separado por tenant (schema-per-tenant)

```sql
CREATE SCHEMA tenant_abc123;
CREATE TABLE tenant_abc123.bookings (...);
```

**Pros:** Aislamiento total a nivel de schema.

**Cons:** Un schema por negocio = miles de schemas en producción. Supabase no está diseñado para esto. Las migraciones se vuelven pesadillas. Inaceptable.

## Variables de Contexto para RLS

```sql
-- Para la página pública de reserva (usuario anónimo con session_id)
-- Llamado desde Next.js antes de cualquier operación de reserva:
SELECT set_config('app.session_id', $session_id, true);

-- Para el dashboard del negocio, Supabase usa auth.uid() automáticamente
-- No requiere configuración adicional
```

## Verificación de Políticas

```sql
-- Verificar que un usuario autenticado solo ve sus negocios
SET ROLE authenticated;
SET request.jwt.claim.sub = 'user-uuid-123';
SELECT * FROM businesses;  -- debe devolver solo los negocios del user-uuid-123

-- Verificar que un usuario anónimo no puede ver datos de clientes
SET ROLE anon;
SELECT * FROM customers;  -- debe devolver 0 rows
```

## Trade-off Analysis

RLS sacrifica algo de rendimiento (1-5ms por query adicional por la evaluación de políticas) a cambio de una garantía de seguridad que no depende de que ningún desarrollador (humano o IA) recuerde añadir filtros de tenant. Para una plataforma SaaS con datos de negocios reales, esta garantía no es negociable.

El riesgo real de RLS no es el rendimiento sino la misconfiguration. Se mitiga con tests de seguridad específicos que verifican el aislamiento desde cuentas de diferentes negocios.

## Consequences

- ✅ Aislamiento multi-tenant garantizado a nivel de base de datos
- ✅ Un bug en la capa de aplicación no puede filtrar datos entre negocios
- ✅ La autenticación Supabase alimenta `auth.uid()` automáticamente en las políticas
- ⚠️ Cada nueva tabla debe tener RLS activado y políticas definidas — incluir en checklist de code review
- ⚠️ Las políticas con subqueries necesitan índices en las columnas de join (`owner_id`, `business_id`)
- ⚠️ Testear el aislamiento en CI: queries desde cuenta A no deben devolver datos de cuenta B

## Action Items

1. [ ] Crear todas las políticas RLS en las migraciones de Supabase (no post-hoc)
2. [ ] Escribir tests de seguridad que verifiquen el aislamiento entre dos negocios de prueba
3. [ ] Añadir índice en `businesses(owner_id)` para que las subqueries RLS sean eficientes
4. [ ] Documentar en CONTRIBUTING.md: "toda tabla nueva debe tener RLS activado + política"
5. [ ] Configurar Supabase Dashboard para alertar si hay tablas sin RLS activado
