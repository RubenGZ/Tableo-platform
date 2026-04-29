# Phase 2: Motor de Disponibilidad — Spec

**Fecha:** 2026-04-29  
**ADR de referencia:** ADR-002, ADR-004, ADR-006, ADR-010 (nuevo)  
**Depende de:** Phase 1 Foundation (migrations 001–005, `src/lib/supabase/`)  
**Siguiente fase:** Phase 3 — UI Pública de Reserva (`/book/[slug]`)

---

## Goal

Implementar el `AvailabilityAdapter` polimórfico y el `BeautyAdapter` como primera implementación concreta. El motor responde a: **¿qué huecos libres tiene el recurso X el día Y?** y gestiona el ciclo completo de reserva temporal (claim → confirm / release).

---

## Decisiones de diseño

| Decisión | Elección | Razón |
|----------|----------|-------|
| Generación de slots | TypeScript (no PG function) | Testable con Vitest sin DB real |
| Google Calendar sync | Stub en Phase 2 | Implementación real en Phase 5 |
| Concurrencia en claimSlot | Nueva función PG `claim_slot()` | Atómica — sin race conditions |
| `customer_id` en reserved | Nullable | Semánticamente correcto: el cliente llega en confirmación |

---

## File Structure

```
src/
├── modules/availability/
│   ├── types.ts                        ← AvailabilityAdapter + Slot + LockResult
│   ├── factory.ts                      ← getAdapter(sectorType, supabase)
│   ├── beauty-adapter.ts               ← BeautyAdapter: getSlots, claimSlot, confirmBooking, releaseSlot
│   └── __tests__/
│       ├── beauty-adapter.test.ts      ← 12 tests (Vitest, Supabase mockeado)
│       └── factory.test.ts             ← 3 tests
├── lib/
│   ├── dates.ts                        ← toBusinessLocal(), formatSlotTime()
│   └── calendar-sync.ts               ← stub: createEvent() + deleteEvent()
supabase/migrations/
└── 006_claim_slot.sql                  ← claim_slot() + customer_id nullable + CHECK
```

---

## Interfaces TypeScript

### `src/modules/availability/types.ts`

```typescript
import type { SectorType, BookingMetadata } from '@/lib/db/types'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface Slot {
  startAt: Date          // UTC
  endAt: Date            // UTC
  durationMinutes: number
}

export interface LockResult {
  success: boolean
  bookingId?: string
  reservedUntil?: Date
  reason?: 'not_available' | 'concurrent_lock'
}

export interface AvailabilityAdapter {
  readonly sectorType: SectorType

  /**
   * Devuelve los slots disponibles para un recurso en una fecha dada.
   * @param resourceId UUID del recurso (profesional, mesa, etc.)
   * @param date       Fecha en formato 'YYYY-MM-DD' en la timezone del negocio
   * @param timezoneId IANA timezone del negocio (ej. 'Europe/Madrid')
   */
  getSlots(resourceId: string, date: string, timezoneId: string): Promise<Slot[]>

  /**
   * Reserva temporalmente un slot (fase 1 del two-phase booking).
   * TTL: 5 minutos. Llama a la función PG claim_slot().
   */
  claimSlot(
    resourceId: string,
    startAt: Date,
    endAt: Date,
    sessionId: string
  ): Promise<LockResult>

  /**
   * Confirma la reserva asignando cliente y metadata (fase 2).
   * También dispara calendarSync.createEvent() (stub en Phase 2).
   */
  confirmBooking(
    bookingId: string,
    customerId: string,
    metadata: BookingMetadata
  ): Promise<string> // retorna bookingId confirmado

  /**
   * Libera un slot reservado antes de que expire el TTL.
   */
  releaseSlot(sessionId: string): Promise<void>
}

export type AdapterFactory = (
  sectorType: SectorType,
  supabase: SupabaseClient
) => AvailabilityAdapter
```

---

## BeautyAdapter — getSlots() Algorithm

El cálculo se hace completamente en TypeScript. Tres queries a Supabase:

```
1. availability_windows WHERE resource_id = ? AND day_of_week = dayOfWeek(date)
2. blocking_rules       WHERE resource_id = ? AND start_at < endOfDay AND end_at > startOfDay
3. bookings             WHERE resource_id = ? AND status IN ('reserved','confirmed')
                              AND start_at < endOfDay AND end_at > startOfDay
4. resources.metadata.duration_default  (incluido en query 1 con JOIN)
```

**Algoritmo de generación:**

```
cursor = open_time del día (en UTC, usando timezoneId del negocio)
slots  = []

WHILE cursor + duration <= close_time:
  IF no overlap con blocking_rules AND no overlap con bookings:
    slots.push({ startAt: cursor, endAt: cursor+duration, durationMinutes: duration })
  cursor += duration

RETURN slots
```

**Overlap check:** `existingStart < candidateEnd AND existingEnd > candidateStart`

---

## Nueva migración: `006_claim_slot.sql`

```sql
-- 1. customer_id pasa a nullable (los slots 'reserved' no tienen cliente aún)
ALTER TABLE bookings
  ALTER COLUMN customer_id DROP NOT NULL;

-- 2. CHECK: cliente obligatorio en estados finales
ALTER TABLE bookings
  ADD CONSTRAINT bookings_customer_required
  CHECK (
    status NOT IN ('confirmed', 'completed') OR customer_id IS NOT NULL
  );

-- 3. claim_slot() — atómica: check de conflicto + INSERT en una transacción
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
  -- Verificar que no hay conflicto de horario
  IF EXISTS (
    SELECT 1 FROM bookings
    WHERE resource_id = p_resource_id
      AND status IN ('reserved', 'confirmed')
      AND start_at < p_end_at
      AND end_at   > p_start_at
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_available');
  END IF;

  -- Insertar la reserva temporal
  INSERT INTO bookings (
    resource_id, start_at, end_at, status,
    reserved_until, session_id, metadata
  )
  VALUES (
    p_resource_id, p_start_at, p_end_at, 'reserved',
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
```

---

## calendarSync stub

```typescript
// src/lib/calendar-sync.ts
// Stub — Phase 5 implementa la integración real con Google Calendar API

export interface CalendarEvent {
  calendarId: string
  summary: string
  startAt: Date
  endAt: Date
  timezoneId: string
}

export async function createEvent(event: CalendarEvent): Promise<void> {
  // Phase 5: POST a Google Calendar API
  console.log('[calendarSync] createEvent stub:', event.summary, event.startAt.toISOString())
}

export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  // Phase 5: DELETE en Google Calendar API
  console.log('[calendarSync] deleteEvent stub:', calendarId, eventId)
}
```

---

## dates.ts

```typescript
// src/lib/dates.ts
import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'

/**
 * Convierte una fecha UTC a la hora local del negocio para mostrar en UI.
 * NUNCA usar en la capa de datos — solo en presentación.
 */
export function toBusinessLocal(utcDate: Date, timezoneId: string): string {
  return new TZDate(utcDate, timezoneId).toLocaleString('es-ES', {
    dateStyle: 'full',
    timeStyle: 'short',
  })
}

/**
 * Formatea la hora de un slot para mostrar en el SlotPicker.
 * Ej: "10:30"
 */
export function formatSlotTime(utcDate: Date, timezoneId: string): string {
  const local = new TZDate(utcDate, timezoneId)
  return format(local, 'HH:mm')
}

/**
 * Convierte 'YYYY-MM-DD' + timezoneId a los límites UTC del día.
 * Usado por getSlots() para calcular el rango de la query.
 */
export function dayBoundsUTC(
  date: string,
  timezoneId: string
): { startOfDay: Date; endOfDay: Date } {
  const startOfDay = new TZDate(`${date}T00:00:00`, timezoneId)
  const endOfDay   = new TZDate(`${date}T23:59:59`, timezoneId)
  return {
    startOfDay: new Date(startOfDay.getTime()),
    endOfDay:   new Date(endOfDay.getTime()),
  }
}
```

---

## Testing Strategy

**12 tests en `beauty-adapter.test.ts`:**

| Test | Descripción |
|------|-------------|
| getSlots — día laboral sin reservas | Retorna todos los slots dentro del horario |
| getSlots — día laboral con reservas | Excluye slots solapados con reservas existentes |
| getSlots — con blocking rule | Excluye slots solapados con el bloqueo |
| getSlots — día sin horario (domingo) | Retorna array vacío |
| getSlots — slot exacto al límite | Slot que acaba en close_time es válido |
| getSlots — slot que sobrepasa close_time | No se incluye |
| claimSlot — slot libre | Retorna `{ success: true, bookingId, reservedUntil }` |
| claimSlot — slot ocupado (DB devuelve not_available) | Retorna `{ success: false, reason: 'not_available' }` |
| claimSlot — concurrencia (DB devuelve concurrent_lock) | Retorna `{ success: false, reason: 'concurrent_lock' }` |
| confirmBooking — booking existente | Actualiza customer_id + metadata + status='confirmed', llama createEvent stub |
| confirmBooking — booking no encontrado | Lanza error con mensaje claro |
| releaseSlot — libera sesión | Llama `release_slot()` PG con session_id, verifica que retorna `success: true` |

**3 tests en `factory.test.ts`:**
- `getAdapter('beauty', supabase)` → instancia de BeautyAdapter
- `getAdapter('restaurant', supabase)` → lanza NotImplementedError
- `getAdapter('real_estate', supabase)` → lanza NotImplementedError

**Mocks:** Supabase mockeado con Vitest (`vi.mock`), patrón thenable real (`then: (fn) => Promise.resolve(data).then(fn)`). No se necesita DB real.

---

## Dependencias nuevas

```bash
pnpm add @date-fns/tz date-fns
```

`date-fns` ya puede estar instalado transitivamente — verificar antes de añadir.

---

## Lo que NO entra en Phase 2

- UI de reserva (SlotPicker, BookingCountdown) → Phase 3
- Google Calendar API real → Phase 5
- `RestaurantAdapter`, `RealEstateAdapter` → V2
- Onboarding wizard → Phase 4
- Dashboard UI → Phase 4
