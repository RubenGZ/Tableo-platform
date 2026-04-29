# Phase 2: Motor de Disponibilidad — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar el `AvailabilityAdapter` polimórfico y el `BeautyAdapter` que calcula slots libres desde `availability_windows`, gestiona `claimSlot()` con concurrencia segura via PG, y confirma reservas con stub de Google Calendar.

**Architecture:** Strategy + Factory (ADR-002). Slots generados en TypeScript (no PG). Nueva función PG `claim_slot()` en migration 006 para atomicidad. `customer_id` nullable en `reserved`, obligatorio en `confirmed`. `calendarSync.createEvent()` es stub hasta Phase 5.

**Tech Stack:** Next.js 15, TypeScript strict, Supabase JS v2, Vitest 2, `@date-fns/tz` v3, `date-fns` v3.

---

## File Structure

```
src/
├── lib/
│   ├── dates.ts                              ← CREAR: toBusinessLocal, formatSlotTime, dayBoundsUTC
│   ├── calendar-sync.ts                      ← CREAR: stub createEvent/deleteEvent
│   └── __tests__/
│       └── dates.test.ts                     ← CREAR: 3 tests
├── modules/availability/
│   ├── types.ts                              ← CREAR: AvailabilityAdapter, Slot, LockResult
│   ├── factory.ts                            ← CREAR: getAdapter(sectorType, supabase)
│   ├── beauty-adapter.ts                     ← CREAR: BeautyAdapter implements AvailabilityAdapter
│   └── __tests__/
│       ├── beauty-adapter.test.ts            ← CREAR: 12 tests
│       └── factory.test.ts                   ← CREAR: 3 tests
supabase/migrations/
└── 006_claim_slot.sql                        ← CREAR: claim_slot() + customer_id nullable + CHECK
```

---

## Task 1: Instalar @date-fns/tz y crear dates.ts

**Files:**
- Modify: `package.json` (via pnpm)
- Create: `src/lib/dates.ts`
- Create: `src/lib/__tests__/dates.test.ts`

- [ ] **Step 1.1: Instalar dependencias**

```bash
cd C:\Users\Rubén\Desktop\Tableo
pnpm add date-fns @date-fns/tz
```

Expected: ambos paquetes en `dependencies`. `date-fns` puede ya estar instalado — pnpm deduplica.

- [ ] **Step 1.2: Escribir los tests que deben fallar**

```typescript
// src/lib/__tests__/dates.test.ts
import { describe, it, expect } from 'vitest'
import { toBusinessLocal, formatSlotTime, dayBoundsUTC } from '../dates'

describe('dayBoundsUTC', () => {
  it('devuelve los límites UTC correctos para timezone UTC+0', () => {
    // Atlantic/Reykjavik es UTC+0 todo el año (sin DST) — fácil de verificar
    const { startOfDay, endOfDay } = dayBoundsUTC('2024-06-15', 'Atlantic/Reykjavik')
    expect(startOfDay.getUTCHours()).toBe(0)
    expect(startOfDay.getUTCMinutes()).toBe(0)
    expect(endOfDay.getUTCHours()).toBe(23)
    expect(endOfDay.getUTCMinutes()).toBe(59)
  })

  it('devuelve los límites UTC correctos para Europe/Madrid (UTC+2 en verano)', () => {
    const { startOfDay } = dayBoundsUTC('2024-06-15', 'Europe/Madrid')
    // Medianoche en Madrid (UTC+2) = 22:00 UTC del día anterior
    expect(startOfDay.getUTCHours()).toBe(22)
    expect(startOfDay.getUTCDate()).toBe(14) // 14 de junio UTC
  })
})

describe('formatSlotTime', () => {
  it('formatea hora UTC a la hora local del negocio', () => {
    // 10:00 UTC en timezone UTC+0 = "10:00"
    const utcDate = new Date('2024-06-15T10:00:00Z')
    expect(formatSlotTime(utcDate, 'Atlantic/Reykjavik')).toBe('10:00')
  })
})
```

- [ ] **Step 1.3: Ejecutar para verificar que fallan**

```bash
cd C:\Users\Rubén\Desktop\Tableo && pnpm test src/lib/__tests__/dates.test.ts 2>&1
```

Expected: FAIL — `Cannot find module '../dates'`

- [ ] **Step 1.4: Crear `src/lib/dates.ts`**

```typescript
// src/lib/dates.ts
// Conversión de fechas UTC ↔ timezone del negocio (ADR-006)
// REGLA: esta capa solo se usa en presentación — NUNCA en la capa de datos.

import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'

/**
 * Convierte una fecha UTC a la hora local del negocio para mostrar en UI.
 */
export function toBusinessLocal(utcDate: Date, timezoneId: string): string {
  return new TZDate(utcDate, timezoneId).toLocaleString('es-ES', {
    dateStyle: 'full',
    timeStyle: 'short',
  })
}

/**
 * Formatea la hora de un slot para mostrar en el SlotPicker.
 * Ejemplo: "10:30"
 */
export function formatSlotTime(utcDate: Date, timezoneId: string): string {
  const local = new TZDate(utcDate, timezoneId)
  return format(local, 'HH:mm')
}

/**
 * Convierte 'YYYY-MM-DD' + timezoneId a los límites UTC del día.
 * Usado por BeautyAdapter.getSlots() para construir el rango de queries.
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

- [ ] **Step 1.5: Ejecutar tests para verificar que pasan**

```bash
cd C:\Users\Rubén\Desktop\Tableo && pnpm test src/lib/__tests__/dates.test.ts 2>&1
```

Expected: `3 tests passed`

- [ ] **Step 1.6: Commit**

```bash
git add src/lib/dates.ts src/lib/__tests__/dates.test.ts package.json pnpm-lock.yaml
git commit -m "feat: add date-fns timezone utilities (toBusinessLocal, formatSlotTime, dayBoundsUTC)"
```

---

## Task 2: Crear calendar-sync.ts stub

**Files:**
- Create: `src/lib/calendar-sync.ts`

- [ ] **Step 2.1: Crear `src/lib/calendar-sync.ts`**

```typescript
// src/lib/calendar-sync.ts
// Stub de integración con Google Calendar.
// Phase 5 implementa la llamada real a Google Calendar API.
// El BeautyAdapter llama a createEvent() en confirmBooking() — el hook ya existe.

export interface CalendarEvent {
  calendarId: string   // Phase 5: business.googleCalendarId
  summary: string
  startAt: Date
  endAt: Date
  timezoneId: string
}

/**
 * Crea un evento en Google Calendar al confirmar una reserva.
 * Stub: solo loguea — no lanza error para no bloquear el flujo.
 */
export async function createEvent(event: CalendarEvent): Promise<void> {
  console.log(
    '[calendarSync] createEvent stub:',
    event.summary,
    event.startAt.toISOString(),
    '→',
    event.endAt.toISOString()
  )
}

/**
 * Elimina un evento de Google Calendar al cancelar una reserva.
 * Stub: solo loguea.
 */
export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  console.log('[calendarSync] deleteEvent stub:', calendarId, eventId)
}
```

- [ ] **Step 2.2: Verificar que TypeScript compila sin errores**

```bash
cd C:\Users\Rubén\Desktop\Tableo && pnpm tsc --noEmit 2>&1
```

Expected: sin errores.

- [ ] **Step 2.3: Commit**

```bash
git add src/lib/calendar-sync.ts
git commit -m "feat: add calendar-sync stub (Phase 5 hook for Google Calendar)"
```

---

## Task 3: Crear availability/types.ts

**Files:**
- Create: `src/modules/availability/types.ts`

- [ ] **Step 3.1: Crear `src/modules/availability/types.ts`**

```typescript
// src/modules/availability/types.ts
// Contrato público del Motor de Disponibilidad (ADR-002).
// Ningún consumidor importa BeautyAdapter directamente — solo esta interfaz.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { SectorType, BookingMetadata } from '@/lib/db/types'

export interface Slot {
  startAt: Date          // UTC — conversión a local solo en UI
  endAt: Date            // UTC
  durationMinutes: number
}

export interface LockResult {
  success: boolean
  bookingId?: string       // presente si success: true
  reservedUntil?: Date     // presente si success: true — UTC
  reason?: 'not_available' | 'concurrent_lock'  // presente si success: false
}

export interface AvailabilityAdapter {
  readonly sectorType: SectorType

  /**
   * Devuelve los slots disponibles para un recurso en una fecha dada.
   * @param resourceId  UUID del recurso
   * @param date        'YYYY-MM-DD' en la timezone del negocio
   * @param timezoneId  IANA timezone ID (ej. 'Europe/Madrid')
   */
  getSlots(resourceId: string, date: string, timezoneId: string): Promise<Slot[]>

  /**
   * Reserva temporalmente un slot (fase 1 del two-phase booking). TTL: 5 min.
   * Llama a la función PG claim_slot() — atómica, sin race conditions.
   */
  claimSlot(
    resourceId: string,
    startAt: Date,
    endAt: Date,
    sessionId: string
  ): Promise<LockResult>

  /**
   * Confirma la reserva asignando cliente y metadata (fase 2).
   * Actualiza status → 'confirmed'. Llama calendarSync.createEvent() (stub Phase 2).
   * @returns bookingId confirmado
   */
  confirmBooking(
    bookingId: string,
    customerId: string,
    metadata: BookingMetadata
  ): Promise<string>

  /**
   * Libera un slot reservado antes de que expire el TTL.
   * Llama release_slot() PG con el sessionId.
   */
  releaseSlot(sessionId: string): Promise<void>
}
```

- [ ] **Step 3.2: Verificar que TypeScript compila**

```bash
cd C:\Users\Rubén\Desktop\Tableo && pnpm tsc --noEmit 2>&1
```

Expected: sin errores.

- [ ] **Step 3.3: Commit**

```bash
git add src/modules/availability/types.ts
git commit -m "feat: add AvailabilityAdapter interface and Slot/LockResult types"
```

---

## Task 4: Migración 006 — claim_slot() y customer_id nullable

**Files:**
- Create: `supabase/migrations/006_claim_slot.sql`

- [ ] **Step 4.1: Crear `supabase/migrations/006_claim_slot.sql`**

```sql
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
--    No se puede confirmar una reserva sin cliente.
ALTER TABLE bookings
  ADD CONSTRAINT bookings_customer_required
  CHECK (
    status NOT IN ('confirmed', 'completed') OR customer_id IS NOT NULL
  );

-- 3. claim_slot() — atómica: check de conflicto + INSERT en una sola transacción.
--    Si dos usuarios intentan el mismo slot simultáneamente, solo uno gana.
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
  -- Verificar que no hay reserva solapada activa
  IF EXISTS (
    SELECT 1 FROM bookings
    WHERE resource_id = p_resource_id
      AND status IN ('reserved', 'confirmed')
      AND start_at < p_end_at
      AND end_at   > p_start_at
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_available');
  END IF;

  -- Insertar la reserva temporal sin cliente (se añade en confirmBooking)
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
    -- Dos inserts concurrentes exactamente al mismo tiempo
    RETURN jsonb_build_object('success', false, 'reason', 'concurrent_lock');
END;
$$;
```

- [ ] **Step 4.2: Aplicar en Supabase SQL Editor**

Copiar el contenido de `006_claim_slot.sql` y ejecutarlo en Supabase Dashboard → SQL Editor.

Expected: `Success. No rows returned.`

Verificar:
```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_type = 'FUNCTION';
```

Debe aparecer `claim_slot` en los resultados.

- [ ] **Step 4.3: Commit**

```bash
git add supabase/migrations/006_claim_slot.sql
git commit -m "feat: add claim_slot() PG function and make bookings.customer_id nullable for reserved state"
```

---

## Task 5: BeautyAdapter — getSlots()

**Files:**
- Create: `src/modules/availability/beauty-adapter.ts`
- Create: `src/modules/availability/__tests__/beauty-adapter.test.ts` (6 tests de getSlots)

- [ ] **Step 5.1: Escribir los 6 tests de getSlots que deben fallar**

```typescript
// src/modules/availability/__tests__/beauty-adapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BeautyAdapter } from '../beauty-adapter'

// ─── Mock factory de Supabase ─────────────────────────────────────────────────
// Crea un cliente Supabase falso que devuelve los datos que le pasamos.
// Soporta .from(table).select().eq()...then() y .single()

function makeQueryChain(data: unknown) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnValue(undefined),
    eq: vi.fn().mockReturnValue(undefined),
    in: vi.fn().mockReturnValue(undefined),
    lt: vi.fn().mockReturnValue(undefined),
    gt: vi.fn().mockReturnValue(undefined),
    update: vi.fn().mockReturnValue(undefined),
    single: vi.fn().mockResolvedValue({ data, error: null }),
    then: (fn: (v: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data, error: null }).then(fn),
  }
  // Todos los métodos de query retornan el mismo chain (fluent API)
  chain.select = vi.fn().mockReturnValue(chain)
  chain.eq = vi.fn().mockReturnValue(chain)
  chain.in = vi.fn().mockReturnValue(chain)
  chain.lt = vi.fn().mockReturnValue(chain)
  chain.gt = vi.fn().mockReturnValue(chain)
  chain.update = vi.fn().mockReturnValue(chain)
  return chain
}

function makeSupabase(tables: Record<string, unknown>, rpcData?: unknown) {
  return {
    from: vi.fn().mockImplementation((table: string) =>
      makeQueryChain(tables[table] ?? null)
    ),
    rpc: vi.fn().mockResolvedValue({ data: rpcData ?? null, error: null }),
  } as unknown as SupabaseClient
}

// ─── Datos de referencia ──────────────────────────────────────────────────────
// Lunes 2024-06-17. Laura: 09:00–11:00 (dur: 60min) → slots 09:00, 10:00
const WINDOW_MON_9_11 = { open_time: '09:00:00', close_time: '11:00:00' }
const RESOURCE_60MIN  = { metadata: { duration_default: 60 } }
const TIMEZONE = 'Atlantic/Reykjavik' // UTC+0 todo el año — tests sin DST

describe('BeautyAdapter.getSlots', () => {
  let adapter: BeautyAdapter

  it('retorna todos los slots disponibles en un día sin reservas', async () => {
    adapter = new BeautyAdapter(makeSupabase({
      availability_windows: [WINDOW_MON_9_11],
      resources: RESOURCE_60MIN,
      blocking_rules: [],
      bookings: [],
    }))

    const slots = await adapter.getSlots('res-1', '2024-06-17', TIMEZONE)

    expect(slots).toHaveLength(2)
    expect(slots[0].startAt.getUTCHours()).toBe(9)
    expect(slots[1].startAt.getUTCHours()).toBe(10)
    expect(slots[0].durationMinutes).toBe(60)
  })

  it('excluye slots que solapan con reservas existentes', async () => {
    // Reserva de 09:00 a 10:00 UTC
    const existingBooking = {
      start_at: '2024-06-17T09:00:00Z',
      end_at:   '2024-06-17T10:00:00Z',
    }
    adapter = new BeautyAdapter(makeSupabase({
      availability_windows: [WINDOW_MON_9_11],
      resources: RESOURCE_60MIN,
      blocking_rules: [],
      bookings: [existingBooking],
    }))

    const slots = await adapter.getSlots('res-1', '2024-06-17', TIMEZONE)

    expect(slots).toHaveLength(1)
    expect(slots[0].startAt.getUTCHours()).toBe(10)
  })

  it('excluye slots que solapan con blocking rules', async () => {
    // Bloqueo de 09:00 a 10:00 UTC
    const block = {
      start_at: '2024-06-17T09:00:00Z',
      end_at:   '2024-06-17T10:00:00Z',
    }
    adapter = new BeautyAdapter(makeSupabase({
      availability_windows: [WINDOW_MON_9_11],
      resources: RESOURCE_60MIN,
      blocking_rules: [block],
      bookings: [],
    }))

    const slots = await adapter.getSlots('res-1', '2024-06-17', TIMEZONE)

    expect(slots).toHaveLength(1)
    expect(slots[0].startAt.getUTCHours()).toBe(10)
  })

  it('retorna array vacío si no hay ventana de disponibilidad ese día', async () => {
    adapter = new BeautyAdapter(makeSupabase({
      availability_windows: [], // sin ventanas para ese día
      resources: RESOURCE_60MIN,
      blocking_rules: [],
      bookings: [],
    }))

    const slots = await adapter.getSlots('res-1', '2024-06-17', TIMEZONE)

    expect(slots).toHaveLength(0)
  })

  it('incluye el slot que termina exactamente en close_time', async () => {
    // Ventana 09:00–10:00, dur 60min → un slot 09:00–10:00 (termina en close_time)
    const tightWindow = { open_time: '09:00:00', close_time: '10:00:00' }
    adapter = new BeautyAdapter(makeSupabase({
      availability_windows: [tightWindow],
      resources: RESOURCE_60MIN,
      blocking_rules: [],
      bookings: [],
    }))

    const slots = await adapter.getSlots('res-1', '2024-06-17', TIMEZONE)

    expect(slots).toHaveLength(1)
  })

  it('no incluye un slot que sobrepasaría close_time', async () => {
    // Ventana 09:00–10:30, dur 60min → slot 09:00–10:00 cabe, 10:00–11:00 no cabe
    const window = { open_time: '09:00:00', close_time: '10:30:00' }
    adapter = new BeautyAdapter(makeSupabase({
      availability_windows: [window],
      resources: RESOURCE_60MIN,
      blocking_rules: [],
      bookings: [],
    }))

    const slots = await adapter.getSlots('res-1', '2024-06-17', TIMEZONE)

    expect(slots).toHaveLength(1)
    expect(slots[0].startAt.getUTCHours()).toBe(9)
  })
})
```

- [ ] **Step 5.2: Ejecutar para verificar que fallan**

```bash
cd C:\Users\Rubén\Desktop\Tableo && pnpm test src/modules/availability/__tests__/beauty-adapter.test.ts 2>&1
```

Expected: FAIL — `Cannot find module '../beauty-adapter'`

- [ ] **Step 5.3: Crear `src/modules/availability/beauty-adapter.ts` con getSlots()**

```typescript
// src/modules/availability/beauty-adapter.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AvailabilityAdapter, Slot, LockResult } from './types'
import type { SectorType, BookingMetadata } from '@/lib/db/types'
import { dayBoundsUTC } from '@/lib/dates'
import { createEvent } from '@/lib/calendar-sync'

interface TimeRange {
  start: Date
  end: Date
}

function hasOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && a.end > b.start
}

export class BeautyAdapter implements AvailabilityAdapter {
  readonly sectorType: SectorType = 'beauty'

  constructor(private readonly supabase: SupabaseClient) {}

  async getSlots(resourceId: string, date: string, timezoneId: string): Promise<Slot[]> {
    const { startOfDay, endOfDay } = dayBoundsUTC(date, timezoneId)

    // day_of_week en el schema: 0=Lunes, 1=Martes, ..., 6=Domingo (ADR-003)
    // JS getDay(): 0=Domingo, 1=Lunes, ..., 6=Sábado
    const jsDay = startOfDay.getDay()
    const dbDayOfWeek = jsDay === 0 ? 6 : jsDay - 1

    // 1. Ventana de disponibilidad del día
    const { data: windows } = await this.supabase
      .from('availability_windows')
      .select('open_time, close_time')
      .eq('resource_id', resourceId)
      .eq('day_of_week', dbDayOfWeek)

    if (!windows?.length) return []

    // 2. Duración del servicio desde resource.metadata
    const { data: resource } = await this.supabase
      .from('resources')
      .select('metadata')
      .eq('id', resourceId)
      .single()

    const durationMinutes: number =
      (resource?.metadata as { duration_default?: number })?.duration_default ?? 60
    const durationMs = durationMinutes * 60 * 1000

    // 3. Bloqueos activos ese día
    const { data: blocks } = await this.supabase
      .from('blocking_rules')
      .select('start_at, end_at')
      .eq('resource_id', resourceId)
      .lt('start_at', endOfDay.toISOString())
      .gt('end_at', startOfDay.toISOString())

    // 4. Reservas existentes ese día (reserved o confirmed)
    const { data: bookings } = await this.supabase
      .from('bookings')
      .select('start_at, end_at')
      .eq('resource_id', resourceId)
      .in('status', ['reserved', 'confirmed'])
      .lt('start_at', endOfDay.toISOString())
      .gt('end_at', startOfDay.toISOString())

    const occupied: TimeRange[] = [
      ...(blocks ?? []).map((b: { start_at: string; end_at: string }) => ({
        start: new Date(b.start_at),
        end: new Date(b.end_at),
      })),
      ...(bookings ?? []).map((b: { start_at: string; end_at: string }) => ({
        start: new Date(b.start_at),
        end: new Date(b.end_at),
      })),
    ]

    const slots: Slot[] = []

    for (const window of windows as { open_time: string; close_time: string }[]) {
      // Convertir HH:MM:SS a timestamps UTC usando la timezone del negocio
      const [openH, openM] = window.open_time.split(':').map(Number)
      const [closeH, closeM] = window.close_time.split(':').map(Number)

      // Construir timestamps UTC para open y close en la timezone del negocio
      const { TZDate } = await import('@date-fns/tz')
      const openUTC = new Date(
        new TZDate(
          `${date}T${String(openH).padStart(2, '0')}:${String(openM).padStart(2, '0')}:00`,
          timezoneId
        ).getTime()
      )
      const closeUTC = new Date(
        new TZDate(
          `${date}T${String(closeH).padStart(2, '0')}:${String(closeM).padStart(2, '0')}:00`,
          timezoneId
        ).getTime()
      )

      let cursor = openUTC.getTime()

      while (cursor + durationMs <= closeUTC.getTime()) {
        const slotStart = new Date(cursor)
        const slotEnd   = new Date(cursor + durationMs)

        const blocked = occupied.some(occ =>
          hasOverlap({ start: slotStart, end: slotEnd }, occ)
        )

        if (!blocked) {
          slots.push({ startAt: slotStart, endAt: slotEnd, durationMinutes })
        }

        cursor += durationMs
      }
    }

    return slots
  }

  // claimSlot, confirmBooking, releaseSlot se implementan en Task 6
  async claimSlot(_resourceId: string, _startAt: Date, _endAt: Date, _sessionId: string): Promise<LockResult> {
    throw new Error('Not implemented yet')
  }

  async confirmBooking(_bookingId: string, _customerId: string, _metadata: BookingMetadata): Promise<string> {
    throw new Error('Not implemented yet')
  }

  async releaseSlot(_sessionId: string): Promise<void> {
    throw new Error('Not implemented yet')
  }
}
```

- [ ] **Step 5.4: Ejecutar los 6 tests de getSlots para verificar que pasan**

```bash
cd C:\Users\Rubén\Desktop\Tableo && pnpm test src/modules/availability/__tests__/beauty-adapter.test.ts 2>&1
```

Expected: `6 tests passed` (los otros tests del archivo aún no existen)

- [ ] **Step 5.5: Commit**

```bash
git add src/modules/availability/beauty-adapter.ts src/modules/availability/__tests__/beauty-adapter.test.ts
git commit -m "feat: implement BeautyAdapter.getSlots() with TDD (6 tests passing)"
```

---

## Task 6: BeautyAdapter — claimSlot(), confirmBooking(), releaseSlot()

**Files:**
- Modify: `src/modules/availability/beauty-adapter.ts`
- Modify: `src/modules/availability/__tests__/beauty-adapter.test.ts` (añadir 6 tests más)

- [ ] **Step 6.1: Añadir los 6 tests de claim/confirm/release al archivo de tests**

Añadir este bloque al final de `src/modules/availability/__tests__/beauty-adapter.test.ts`, después del bloque `describe('BeautyAdapter.getSlots', ...)`:

```typescript
describe('BeautyAdapter.claimSlot', () => {
  it('retorna success:true con bookingId y reservedUntil cuando el slot está libre', async () => {
    const reservedUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    const adapter = new BeautyAdapter(makeSupabase({}, {
      success: true,
      booking_id: 'booking-123',
      reserved_until: reservedUntil,
    }))

    const result = await adapter.claimSlot(
      'res-1',
      new Date('2024-06-17T09:00:00Z'),
      new Date('2024-06-17T10:00:00Z'),
      'session-abc'
    )

    expect(result.success).toBe(true)
    expect(result.bookingId).toBe('booking-123')
    expect(result.reservedUntil).toBeInstanceOf(Date)
  })

  it('retorna success:false con reason:not_available cuando el slot está ocupado', async () => {
    const adapter = new BeautyAdapter(makeSupabase({}, {
      success: false,
      reason: 'not_available',
    }))

    const result = await adapter.claimSlot(
      'res-1',
      new Date('2024-06-17T09:00:00Z'),
      new Date('2024-06-17T10:00:00Z'),
      'session-abc'
    )

    expect(result.success).toBe(false)
    expect(result.reason).toBe('not_available')
  })

  it('retorna success:false con reason:concurrent_lock en conflicto de concurrencia', async () => {
    const adapter = new BeautyAdapter(makeSupabase({}, {
      success: false,
      reason: 'concurrent_lock',
    }))

    const result = await adapter.claimSlot(
      'res-1',
      new Date('2024-06-17T09:00:00Z'),
      new Date('2024-06-17T10:00:00Z'),
      'session-xyz'
    )

    expect(result.success).toBe(false)
    expect(result.reason).toBe('concurrent_lock')
  })
})

describe('BeautyAdapter.confirmBooking', () => {
  it('actualiza el booking y retorna el bookingId', async () => {
    const bookingData = {
      id: 'booking-123',
      start_at: '2024-06-17T09:00:00Z',
      end_at: '2024-06-17T10:00:00Z',
    }
    const adapter = new BeautyAdapter(makeSupabase({
      bookings: bookingData, // .single() devolverá este objeto
    }))

    const result = await adapter.confirmBooking(
      'booking-123',
      'customer-456',
      { service: 'Corte', price_eur: 25 }
    )

    expect(result).toBe('booking-123')
  })

  it('lanza error si el booking no existe o no está en estado reserved', async () => {
    const adapter = new BeautyAdapter(makeSupabase({
      bookings: null, // .single() devolverá null → error
    }))

    await expect(
      adapter.confirmBooking('booking-inexistente', 'customer-456', {})
    ).rejects.toThrow('confirmBooking')
  })
})

describe('BeautyAdapter.releaseSlot', () => {
  it('llama release_slot() PG sin lanzar error', async () => {
    const mockSupabase = makeSupabase({}, { success: true, released: 1 })
    const adapter = new BeautyAdapter(mockSupabase)

    await expect(adapter.releaseSlot('session-abc')).resolves.toBeUndefined()
    expect(mockSupabase.rpc).toHaveBeenCalledWith('release_slot', {
      p_session_id: 'session-abc',
    })
  })
})
```

- [ ] **Step 6.2: Ejecutar para verificar que los 6 nuevos tests fallan**

```bash
cd C:\Users\Rubén\Desktop\Tableo && pnpm test src/modules/availability/__tests__/beauty-adapter.test.ts 2>&1
```

Expected: 6 tests pass (getSlots), 6 tests fail (claim/confirm/release — `throw new Error('Not implemented yet')`)

- [ ] **Step 6.3: Implementar claimSlot(), confirmBooking(), releaseSlot() en beauty-adapter.ts**

Reemplazar los tres métodos stub en `src/modules/availability/beauty-adapter.ts`:

```typescript
  async claimSlot(
    resourceId: string,
    startAt: Date,
    endAt: Date,
    sessionId: string
  ): Promise<LockResult> {
    const { data } = await this.supabase.rpc('claim_slot', {
      p_resource_id: resourceId,
      p_start_at:    startAt.toISOString(),
      p_end_at:      endAt.toISOString(),
      p_session_id:  sessionId,
    })

    if (!data?.success) {
      return {
        success: false,
        reason: (data?.reason as LockResult['reason']) ?? 'not_available',
      }
    }

    return {
      success:       true,
      bookingId:     data.booking_id as string,
      reservedUntil: new Date(data.reserved_until as string),
    }
  }

  async confirmBooking(
    bookingId: string,
    customerId: string,
    metadata: BookingMetadata
  ): Promise<string> {
    const { data, error } = await this.supabase
      .from('bookings')
      .update({
        status:        'confirmed',
        customer_id:   customerId,
        metadata,
        reserved_until: null,
        session_id:     null,
      })
      .eq('id', bookingId)
      .eq('status', 'reserved')
      .select('id, start_at, end_at')
      .single()

    if (error || !data) {
      throw new Error(
        `confirmBooking: booking ${bookingId} not found or not in 'reserved' state`
      )
    }

    const confirmed = data as { id: string; start_at: string; end_at: string }

    // Google Calendar sync — stub en Phase 2, implementación real en Phase 5
    await createEvent({
      calendarId: 'primary',
      summary:    'Reserva confirmada',
      startAt:    new Date(confirmed.start_at),
      endAt:      new Date(confirmed.end_at),
      timezoneId: 'Europe/Madrid', // Phase 5: usar business.timezone_id
    })

    return confirmed.id
  }

  async releaseSlot(sessionId: string): Promise<void> {
    await this.supabase.rpc('release_slot', { p_session_id: sessionId })
  }
```

- [ ] **Step 6.4: Ejecutar todos los tests del archivo**

```bash
cd C:\Users\Rubén\Desktop\Tableo && pnpm test src/modules/availability/__tests__/beauty-adapter.test.ts 2>&1
```

Expected: `12 tests passed`

- [ ] **Step 6.5: Ejecutar todos los tests del proyecto para verificar que no hay regresiones**

```bash
cd C:\Users\Rubén\Desktop\Tableo && pnpm test 2>&1
```

Expected: todos los tests existentes siguen pasando + 12 nuevos = total ≥ 61 tests

- [ ] **Step 6.6: Commit**

```bash
git add src/modules/availability/beauty-adapter.ts src/modules/availability/__tests__/beauty-adapter.test.ts
git commit -m "feat: implement BeautyAdapter claimSlot, confirmBooking, releaseSlot (12/12 tests)"
```

---

## Task 7: Factory — getAdapter()

**Files:**
- Create: `src/modules/availability/factory.ts`
- Create: `src/modules/availability/__tests__/factory.test.ts`

- [ ] **Step 7.1: Escribir los 3 tests del factory que deben fallar**

```typescript
// src/modules/availability/__tests__/factory.test.ts
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdapter } from '../factory'
import { BeautyAdapter } from '../beauty-adapter'

const mockSupabase = {} as SupabaseClient

describe('getAdapter', () => {
  it('devuelve un BeautyAdapter para sector beauty', () => {
    const adapter = getAdapter('beauty', mockSupabase)
    expect(adapter).toBeInstanceOf(BeautyAdapter)
    expect(adapter.sectorType).toBe('beauty')
  })

  it('lanza NotImplementedError para sector restaurant', () => {
    expect(() => getAdapter('restaurant', mockSupabase)).toThrow(
      'AvailabilityAdapter for sector "restaurant" is not implemented yet'
    )
  })

  it('lanza NotImplementedError para sector real_estate', () => {
    expect(() => getAdapter('real_estate', mockSupabase)).toThrow(
      'AvailabilityAdapter for sector "real_estate" is not implemented yet'
    )
  })
})
```

- [ ] **Step 7.2: Ejecutar para verificar que fallan**

```bash
cd C:\Users\Rubén\Desktop\Tableo && pnpm test src/modules/availability/__tests__/factory.test.ts 2>&1
```

Expected: FAIL — `Cannot find module '../factory'`

- [ ] **Step 7.3: Crear `src/modules/availability/factory.ts`**

```typescript
// src/modules/availability/factory.ts
// Factory que devuelve el adapter correcto según el sector del negocio.
// El motor NUNCA importa BeautyAdapter directamente — siempre pasa por aquí.
// Añadir nuevos sectores aquí es la única modificación necesaria para V2.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AvailabilityAdapter } from './types'
import type { SectorType } from '@/lib/db/types'
import { BeautyAdapter } from './beauty-adapter'

export function getAdapter(
  sectorType: SectorType,
  supabase: SupabaseClient
): AvailabilityAdapter {
  switch (sectorType) {
    case 'beauty':
      return new BeautyAdapter(supabase)
    case 'restaurant':
    case 'real_estate':
      throw new Error(
        `AvailabilityAdapter for sector "${sectorType}" is not implemented yet`
      )
    default: {
      const _exhaustive: never = sectorType
      throw new Error(`Unknown sector type: ${String(_exhaustive)}`)
    }
  }
}
```

- [ ] **Step 7.4: Ejecutar los 3 tests del factory**

```bash
cd C:\Users\Rubén\Desktop\Tableo && pnpm test src/modules/availability/__tests__/factory.test.ts 2>&1
```

Expected: `3 tests passed`

- [ ] **Step 7.5: Ejecutar todos los tests del proyecto**

```bash
cd C:\Users\Rubén\Desktop\Tableo && pnpm test 2>&1
```

Expected: todos los tests pasan. Total ≥ 64 tests (49 anteriores + 3 dates + 12 beauty + 3 factory).

- [ ] **Step 7.6: Verificar TypeScript limpio**

```bash
cd C:\Users\Rubén\Desktop\Tableo && pnpm tsc --noEmit 2>&1
```

Expected: sin errores.

- [ ] **Step 7.7: Commit**

```bash
git add src/modules/availability/factory.ts src/modules/availability/__tests__/factory.test.ts
git commit -m "feat: add AvailabilityAdapter factory — getAdapter(sectorType) returns BeautyAdapter"
```

---

## Self-Review

### Spec coverage

| Requisito del spec | Task que lo cubre |
|-------------------|-------------------|
| `AvailabilityAdapter` interface + `Slot` + `LockResult` | Task 3 |
| `getSlots()` — 6 comportamientos testados | Task 5 |
| `claimSlot()` — llama `claim_slot()` PG | Task 6 |
| `confirmBooking()` — actualiza DB + calendarSync stub | Task 6 |
| `releaseSlot()` — llama `release_slot()` PG | Task 6 |
| `factory.ts` — 3 tests | Task 7 |
| `dates.ts` — `toBusinessLocal`, `formatSlotTime`, `dayBoundsUTC` | Task 1 |
| `calendar-sync.ts` stub | Task 2 |
| Migration `006_claim_slot.sql` | Task 4 |
| `customer_id` nullable + CHECK constraint | Task 4 |
| `@date-fns/tz` instalado | Task 1 |

### Type consistency

- `LockResult.reason: 'not_available' | 'concurrent_lock'` — coincide con valores que devuelve `claim_slot()` PG ✅
- `BeautyAdapter` implementa todos los métodos de `AvailabilityAdapter` ✅
- `dayBoundsUTC` retorna `{ startOfDay, endOfDay }` — coincide con el uso en `getSlots()` ✅
- `confirmBooking` retorna `string` (bookingId) — test verifica `expect(result).toBe('booking-123')` ✅
- `day_of_week` conversión: JS `getDay()` 0=Sun → DB 0=Mon: fórmula `jsDay === 0 ? 6 : jsDay - 1` ✅

### Placeholder scan

Ningún paso dice "TBD" o "implement later". Los únicos comentarios `// Phase 5:` son intencionales y documentados en el spec. ✅
