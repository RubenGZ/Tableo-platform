# ADR-004: Control de Concurrencia — Two-Phase Booking

**Status:** Accepted  
**Date:** 2026-04-27  
**Deciders:** Equipo Tableo

## Context

El riesgo más crítico de una plataforma de reservas es el double-booking: dos usuarios confirmando el mismo slot simultáneamente. En un negocio de peluquería popular, es habitual que múltiples usuarios consulten disponibilidad al mismo tiempo y compitan por el último slot de un sábado.

Un solo double-booking publicado en redes puede destruir la reputación de Tableo. La solución debe ser robusta aunque haya múltiples instancias de la aplicación corriendo (escenario real en Vercel con serverless functions).

Constraints:
- Debe funcionar en entorno serverless (múltiples instancias sin estado compartido)
- No puede depender de locks en memoria de la aplicación
- El lock debe tener TTL para no bloquear slots indefinidamente si el usuario abandona el flujo
- Latencia de confirmación <300ms p95

## Decision

**Two-Phase Booking con `SELECT FOR UPDATE NOWAIT` de PostgreSQL**, implementado en una transacción de base de datos. El lock vive en Postgres, no en la aplicación — funciona correctamente con múltiples instancias serverless.

## Flujo Completo

```
Usuario                    Next.js API              PostgreSQL
   |                           |                        |
   |-- GET /availability ------>|                        |
   |                           |-- SELECT slots -------->|
   |<-- slots disponibles ------|<-- [slot A, slot B] ---|
   |                           |                        |
   |-- POST /bookings/reserve ->|                        |
   |   {slotId, sessionId}     |-- BEGIN TRANSACTION --->|
   |                           |-- SELECT FOR UPDATE     |
   |                           |   NOWAIT slot A ------->|
   |                           |                    [LOCK ACQUIRED]
   |                           |-- UPDATE status =       |
   |                           |   'reserved'            |
   |                           |   reserved_until = +5m ->|
   |                           |-- COMMIT -------------->|
   |<-- 200 {reservedUntil} ---|                        |
   |                           |                        |
   |  [usuario confirma datos] |                        |
   |                           |                        |
   |-- POST /bookings/confirm ->|                        |
   |   {sessionId}             |-- UPDATE status =       |
   |                           |   'confirmed' --------->|
   |<-- 200 {bookingId} -------|                        |
   |                           |                        |

-- Si otro usuario intenta reservar el mismo slot:
   |-- POST /bookings/reserve ->|                        |
   |   {slotId, sessionId}     |-- SELECT FOR UPDATE     |
   |                           |   NOWAIT slot A ------->|
   |                           |              [LOCK FAILED - NOWAIT]
   |                           |-- ROLLBACK ----------->|
   |<-- 409 "Slot no disponible"|                       |
```

## Options Considered

### Option A: Two-Phase con SELECT FOR UPDATE NOWAIT ✅ ELEGIDO

```sql
-- FASE 1: Reserva temporal (ejecutada en transacción)
BEGIN;

SELECT id, status FROM bookings
WHERE resource_id = $resource_id
  AND start_at = $start_at
  AND status = 'available'
FOR UPDATE NOWAIT;  -- Falla instantáneo si hay lock concurrente

UPDATE bookings SET
  status = 'reserved',
  reserved_until = NOW() + INTERVAL '5 minutes',
  session_id = $session_id
WHERE id = $slot_id;

COMMIT;

-- FASE 2: Confirmar (tras acción del usuario)
UPDATE bookings SET
  status = 'confirmed',
  session_id = NULL,
  reserved_until = NULL
WHERE session_id = $session_id
  AND reserved_until > NOW();  -- Valida que no haya expirado

-- Limpieza automática (pg_cron, cada minuto)
UPDATE bookings SET
  status = 'available',
  session_id = NULL,
  reserved_until = NULL
WHERE status = 'reserved'
  AND reserved_until < NOW();
```

| Dimensión | Evaluación |
|-----------|------------|
| Garantía de no double-booking | Total — lock a nivel de fila en Postgres |
| Funciona con serverless | ✅ — el lock está en la DB, no en la app |
| Latencia de reserva | <50ms para el lock + update |
| Experiencia de usuario | Buena — respuesta inmediata (200 o 409) |
| Complejidad de implementación | Media |

**Pros:**
- `NOWAIT` falla instantáneamente (no espera al timeout) → el usuario recibe respuesta en <100ms
- Funciona con cualquier número de instancias serverless de Next.js
- El TTL de 5 minutos previene slots bloqueados indefinidamente
- `pg_cron` limpia automáticamente sin necesidad de un proceso separado

**Cons:**
- Requiere que la lógica de reserva viva en una transacción de base de datos, no en varias llamadas HTTP separadas
- El slot aparece como "no disponible" durante 5 minutos si el usuario abandona el flujo sin cancelar

### Option B: Optimistic Locking con versión

```sql
UPDATE bookings SET status = 'reserved', version = version + 1
WHERE id = $slot_id AND version = $expected_version AND status = 'available';
-- Si 0 rows afectadas → conflicto, reintentar
```

**Pros:** Sin locks en la DB. Funciona bien con carga alta.

**Cons:** Requiere lógica de reintento en la aplicación. En alta concurrencia, todos los usuarios retrying al mismo tiempo → thundering herd. Más complejo de implementar correctamente.

### Option C: Cola de reservas (Redis/SQS)

**Pros:** Máxima resiliencia. Las reservas se procesan en orden FIFO garantizado.

**Cons:** Introduce Redis o SQS como dependencia. El usuario no recibe confirmación inmediata (debe hacer polling). Latencia de confirmación de segundos, no milisegundos. Overkill para el volumen del MVP.

### Option D: Lock a nivel de aplicación (Mutex en memoria)

**Pros:** Simple de implementar.

**Cons:** No funciona con múltiples instancias serverless. Un deploy nuevo de Vercel = nuevo proceso = locks perdidos. Inaceptable.

## Implementación en la Capa de Aplicación

```typescript
// src/availability/adapters/beauty.adapter.ts

async lockSlot(request: BookingRequest): Promise<LockResult> {
  const { data, error } = await supabase.rpc('reserve_slot', {
    p_slot_id: request.slotId,
    p_session_id: request.sessionId,
    p_ttl_minutes: 5
  })

  if (error?.code === '55P03') {  // lock_not_available en PostgreSQL
    return { success: false }
  }

  if (error) throw error

  return {
    success: true,
    reservedUntil: new Date(data.reserved_until),
    bookingId: data.id
  }
}
```

```sql
-- Función PostgreSQL que encapsula la transacción
CREATE OR REPLACE FUNCTION reserve_slot(
  p_slot_id uuid,
  p_session_id text,
  p_ttl_minutes int DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_booking bookings;
BEGIN
  SELECT * INTO v_booking
  FROM bookings
  WHERE id = p_slot_id AND status = 'available'
  FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_available');
  END IF;

  UPDATE bookings SET
    status = 'reserved',
    reserved_until = NOW() + (p_ttl_minutes || ' minutes')::interval,
    session_id = p_session_id
  WHERE id = p_slot_id;

  RETURN jsonb_build_object(
    'success', true,
    'id', p_slot_id,
    'reserved_until', NOW() + (p_ttl_minutes || ' minutes')::interval
  );
EXCEPTION
  WHEN lock_not_available THEN
    RETURN jsonb_build_object('success', false, 'reason', 'concurrent_lock');
END;
$$;
```

## Trade-off Analysis

El Two-Phase Booking con `SELECT FOR UPDATE NOWAIT` es la solución más simple que garantiza correctitud total. El trade-off principal es que un usuario que abandona el flujo de reserva bloquea el slot durante 5 minutos. En la práctica, 5 minutos es tiempo suficiente para completar una reserva y corto suficiente para no frustrar a otros usuarios que quieran ese slot.

La alternativa de optimistic locking sería igualmente válida pero añade complejidad de reintento que `NOWAIT` elimina completamente.

## Consequences

- ✅ Garantía matemática de cero double-bookings
- ✅ Funciona en entorno serverless multi-instancia sin cambios
- ✅ Respuesta inmediata al usuario (200 o 409) sin esperas
- ✅ `pg_cron` gestiona la limpieza automáticamente
- ⚠️ Slot bloqueado 5 minutos si el usuario abandona el flujo — aceptable y configurable
- ⚠️ La función `reserve_slot` debe ejecutarse dentro de una transacción Supabase — no como llamada RPC aislada

## Action Items

1. [ ] Crear función PostgreSQL `reserve_slot` en migraciones de Supabase
2. [ ] Crear función `confirm_booking` y `release_slot` complementarias
3. [ ] Configurar `pg_cron` con la job de limpieza de reservas expiradas
4. [ ] Test de carga: 50 usuarios simultáneos intentando reservar el mismo slot — verificar que exactamente 1 tiene éxito
5. [ ] Monitorizar el error code `55P03` en logs de producción para detectar alta contención
