# AI Agent API Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear `/api/ai/book` — endpoint que permite a LLMs (Gemini, Claude, GPT, Siri) hacer reservas en Tableo usando lenguaje natural, con errores conversacionales y validación por el negocio.

**Architecture:** Wrapper sobre el AvailabilityAdapter existente. Token único `TABLEO_AI_TOKEN`. Nuevo status `pending_ai_confirmation`. `chrono-node` para parseo de fechas. Errores JSON estructurados con `suggested_user_prompt`.

**Tech Stack:** Next.js 15 App Router (Route Handler), TypeScript strict, Supabase JS v2, chrono-node, Vitest 2.

---

## File Structure

```
src/
├── app/api/ai/book/
│   └── route.ts                        ← CREAR: POST handler principal
├── lib/ai/
│   ├── types.ts                        ← CREAR: AiBookingRequest, AiErrorCode, AiErrorResponse, AiSuccessResponse
│   ├── date-normalizer.ts              ← CREAR: normalizeDateTime()
│   ├── token-auth.ts                   ← CREAR: validateAiToken()
│   ├── error-factory.ts                ← CREAR: buildError()
│   └── __tests__/
│       └── date-normalizer.test.ts     ← CREAR: 8 tests
docs/api/
├── openapi.yaml                        ← CREAR: OpenAPI 3.1
└── gemini-tool-definition.json         ← CREAR: Function Calling definition
supabase/migrations/
└── 007_ai_booking.sql                  ← CREAR: pending_ai_confirmation + ai_source
```

---

## Task 1: Migración 007 — pending_ai_confirmation + ai_source

**Files:**
- Create: `supabase/migrations/007_ai_booking.sql`
- Modify: `src/lib/db/types.ts` (añadir 'pending_ai_confirmation' a BookingStatus)

- [ ] **Step 1.1: Crear `supabase/migrations/007_ai_booking.sql`**

```sql
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
```

- [ ] **Step 1.2: Actualizar `src/lib/db/types.ts` — añadir 'pending_ai_confirmation' a BookingStatus**

Abrir `src/lib/db/types.ts`. La línea actual es:
```typescript
export type BookingStatus =
  | 'pending'
  | 'reserved'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no_show'
  | 'disputed'
```

Cambiarla a:
```typescript
export type BookingStatus =
  | 'pending'
  | 'reserved'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no_show'
  | 'disputed'
  | 'pending_ai_confirmation'
```

- [ ] **Step 1.3: Verificar TypeScript**

```bash
cd C:\Users\Rubén\Desktop\Tableo && pnpm tsc --noEmit 2>&1
```

Expected: sin errores.

- [ ] **Step 1.4: Commit**

```bash
git add supabase/migrations/007_ai_booking.sql src/lib/db/types.ts
git commit -m "feat: add pending_ai_confirmation status and ai_source column for AI bookings"
```

---

## Task 2: Instalar chrono-node + crear types.ts + date-normalizer.ts (TDD)

**Files:**
- Modify: `package.json` (via pnpm)
- Create: `src/lib/ai/types.ts`
- Create: `src/lib/ai/date-normalizer.ts`
- Create: `src/lib/ai/__tests__/date-normalizer.test.ts`

- [ ] **Step 2.1: Instalar chrono-node**

```bash
cd C:\Users\Rubén\Desktop\Tableo && pnpm add chrono-node 2>&1
```

Expected: `chrono-node` aparece en `dependencies`.

- [ ] **Step 2.2: Crear `src/lib/ai/types.ts`**

```typescript
// src/lib/ai/types.ts

export interface AiBookingRequest {
  business_slug: string
  resource_id: string
  datetime: string | { date: string; time: string }
  duration_minutes?: number
  customer: {
    name: string
    phone?: string
    email?: string
  }
  service?: string
  notes?: string
}

export type AiErrorCode =
  | 'ERROR_CAPACITY_FULL'
  | 'ERROR_MISSING_DATA'
  | 'ERROR_INVALID_DATETIME'
  | 'ERROR_DUPLICATE_BOOKING'
  | 'ERROR_BUSINESS_NOT_FOUND'
  | 'ERROR_INVALID_TOKEN'

export interface AlternativeSlot {
  start_at: string   // ISO UTC
  end_at: string     // ISO UTC
  formatted: string  // 'HH:mm' en timezone del negocio
}

export interface AiErrorResponse {
  code: AiErrorCode
  message_for_ai: string
  suggested_user_prompt: string
  alternative_slots?: AlternativeSlot[]  // solo cuando code = ERROR_CAPACITY_FULL
}

export interface AiSuccessResponse {
  booking_id: string
  status: 'pending_ai_confirmation'
  start_at: string
  end_at: string
  message_for_ai: string
  suggested_user_prompt: string
}

// Error interno lanzado por normalizeDateTime
export class ParseError extends Error {
  constructor(
    message: string,
    public readonly input: unknown
  ) {
    super(message)
    this.name = 'ParseError'
  }
}
```

- [ ] **Step 2.3: Escribir los 8 tests que deben fallar**

```typescript
// src/lib/ai/__tests__/date-normalizer.test.ts
import { describe, it, expect, vi } from 'vitest'
import { normalizeDateTime } from '../date-normalizer'
import { ParseError } from '../types'

const MADRID_TZ = 'Europe/Madrid'
const UTC_TZ    = 'Atlantic/Reykjavik'

describe('normalizeDateTime', () => {
  it('pasa ISO UTC sin modificar', () => {
    const input = '2024-06-17T10:00:00Z'
    const result = normalizeDateTime(input, UTC_TZ)
    expect(result.toISOString()).toBe('2024-06-17T10:00:00.000Z')
  })

  it('interpreta ISO sin timezone como hora local del negocio (Madrid UTC+2 en verano)', () => {
    const result = normalizeDateTime('2024-06-17T10:00:00', MADRID_TZ)
    // 10:00 Madrid (UTC+2) = 08:00 UTC
    expect(result.getUTCHours()).toBe(8)
    expect(result.getUTCDate()).toBe(17)
  })

  it('parsea objeto Siri/Google { date, time }', () => {
    const result = normalizeDateTime({ date: '2024-06-17', time: '10:00' }, MADRID_TZ)
    expect(result.getUTCHours()).toBe(8)
    expect(result.getUTCDate()).toBe(17)
  })

  it('parsea objeto con hora sin minutos { date, time: "15" }', () => {
    const result = normalizeDateTime({ date: '2024-06-17', time: '15' }, UTC_TZ)
    expect(result.getUTCHours()).toBe(15)
  })

  it('parsea texto relativo en inglés "tomorrow at 3pm"', () => {
    const reference = new Date('2024-06-17T12:00:00Z') // lunes mediodía
    const result = normalizeDateTime('tomorrow at 3pm', UTC_TZ, reference)
    expect(result.getUTCHours()).toBe(15)
    expect(result.getUTCDate()).toBe(18) // martes
  })

  it('parsea texto relativo en español "mañana a las 10"', () => {
    const reference = new Date('2024-06-17T12:00:00Z')
    const result = normalizeDateTime('mañana a las 10', UTC_TZ, reference)
    expect(result.getUTCHours()).toBe(10)
    expect(result.getUTCDate()).toBe(18)
  })

  it('lanza ParseError si el input no puede parsearse', () => {
    expect(() => normalizeDateTime('xyzzy foo bar', UTC_TZ)).toThrow(ParseError)
  })

  it('lanza ParseError si la fecha resultante es en el pasado', () => {
    // fecha claramente en el pasado
    expect(() =>
      normalizeDateTime('2020-01-01T10:00:00Z', UTC_TZ)
    ).toThrow(ParseError)
  })
})
```

- [ ] **Step 2.4: Ejecutar para verificar que fallan**

```bash
cd C:\Users\Rubén\Desktop\Tableo && pnpm test src/lib/ai/__tests__/date-normalizer.test.ts 2>&1
```

Expected: FAIL — `Cannot find module '../date-normalizer'`

- [ ] **Step 2.5: Crear `src/lib/ai/date-normalizer.ts`**

```typescript
// src/lib/ai/date-normalizer.ts
// Normaliza cualquier representación de fecha/hora a un Date UTC.
// Acepta: ISO 8601, strings relativos (español/inglés), objetos { date, time }.

import * as chrono from 'chrono-node'
import { TZDate } from '@date-fns/tz'
import { ParseError } from './types'

type DatetimeInput = string | { date: string; time: string }

/**
 * Convierte cualquier formato de fecha/hora a un Date UTC.
 * @param input        Input del LLM — puede ser ISO, relativo o objeto
 * @param timezoneId   IANA timezone del negocio (para interpretar fechas locales)
 * @param referenceDate Fecha de referencia para "mañana", "el viernes", etc. (default: now)
 */
export function normalizeDateTime(
  input: DatetimeInput,
  timezoneId: string,
  referenceDate: Date = new Date()
): Date {
  let result: Date

  // 1. Objeto { date, time } — formato Siri, Google Assistant
  if (typeof input === 'object' && input !== null) {
    const timeStr = input.time.includes(':') ? input.time : `${input.time}:00`
    const isoLocal = `${input.date}T${timeStr.padStart(5, '0')}:00`
    const tzDate = new TZDate(
      ...parseLocalParts(isoLocal),
      timezoneId
    )
    result = new Date(tzDate.getTime())
  }
  // 2. ISO con timezone explícita (termina en Z o +HH:MM)
  else if (/Z$|[+-]\d{2}:\d{2}$/.test(input)) {
    result = new Date(input)
  }
  // 3. ISO sin timezone — interpretar como hora local del negocio
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(input)) {
    const tzDate = new TZDate(...parseLocalParts(input), timezoneId)
    result = new Date(tzDate.getTime())
  }
  // 4. String relativo — chrono-node con soporte español e inglés
  else {
    // Intentar español primero, luego inglés
    const parsed =
      chrono.es.parseDate(input, referenceDate) ??
      chrono.parseDate(input, referenceDate)

    if (!parsed) {
      throw new ParseError(
        `Cannot parse datetime input: "${input}"`,
        input
      )
    }
    result = parsed
  }

  // Validar que result es una fecha válida
  if (isNaN(result.getTime())) {
    throw new ParseError(`Invalid date produced from input: "${String(input)}"`, input)
  }

  // Rechazar fechas en el pasado (más de 5 minutos de margen)
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
  if (result < fiveMinutesAgo) {
    throw new ParseError(
      `Datetime is in the past: ${result.toISOString()}`,
      input
    )
  }

  return result
}

// Helper: extrae partes numéricas de un string ISO local 'YYYY-MM-DDTHH:MM:SS'
// para el constructor por partes de TZDate
function parseLocalParts(iso: string): [number, number, number, number, number, number] {
  const [datePart, timePart = '00:00:00'] = iso.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour = 0, min = 0, sec = 0] = timePart.split(':').map(Number)
  return [year, month - 1, day, hour, min, sec]
}
```

- [ ] **Step 2.6: Ejecutar los 8 tests**

```bash
cd C:\Users\Rubén\Desktop\Tableo && pnpm test src/lib/ai/__tests__/date-normalizer.test.ts 2>&1
```

Expected: `8 tests passed`

Si alguno falla con los tests relativos (mañana/tomorrow), verificar que `chrono.es.parseDate` acepta `referenceDate` como segundo argumento. Si no, pasar `{ forwardDate: true, timezone: timezoneId }` como tercer argumento.

- [ ] **Step 2.7: Verificar todos los tests**

```bash
cd C:\Users\Rubén\Desktop\Tableo && pnpm test 2>&1
```

Expected: todos los 67 tests anteriores + 8 nuevos = **75 tests**

- [ ] **Step 2.8: Commit**

```bash
git add src/lib/ai/ package.json pnpm-lock.yaml
git commit -m "feat: add AI types, date normalizer with chrono-node (8 tests)"
```

---

## Task 3: token-auth.ts + error-factory.ts

**Files:**
- Create: `src/lib/ai/token-auth.ts`
- Create: `src/lib/ai/error-factory.ts`

- [ ] **Step 3.1: Crear `src/lib/ai/token-auth.ts`**

```typescript
// src/lib/ai/token-auth.ts
// Valida el token TABLEO_AI_TOKEN del header x-tableo-ai-token.
// Token único compartido para todos los LLMs (V1).
// Phase 4: cada negocio tendrá su propio token desde el dashboard.

export function validateAiToken(request: Request): boolean {
  const token = request.headers.get('x-tableo-ai-token')
  const expected = process.env.TABLEO_AI_TOKEN

  if (!expected) {
    console.error('[AI API] TABLEO_AI_TOKEN env var not set')
    return false
  }

  return token === expected
}
```

- [ ] **Step 3.2: Crear `src/lib/ai/error-factory.ts`**

```typescript
// src/lib/ai/error-factory.ts
// Construye respuestas de error conversacionales para LLMs.
// El LLM usa message_for_ai para entender el contexto técnico.
// El LLM usa suggested_user_prompt para comunicarlo al usuario final.

import type { AiErrorCode, AiErrorResponse, AlternativeSlot } from './types'

interface ErrorContext {
  missing?: string[]           // para ERROR_MISSING_DATA
  input?: string               // para ERROR_INVALID_DATETIME
  slot?: string                // para ERROR_CAPACITY_FULL (hora solicitada, ej. "10:00")
  business?: string            // nombre del negocio
  name?: string                // nombre del cliente
  slug?: string                // para ERROR_BUSINESS_NOT_FOUND
  alternatives?: AlternativeSlot[]  // para ERROR_CAPACITY_FULL
}

export function buildError(
  code: AiErrorCode,
  context: ErrorContext = {}
): AiErrorResponse {
  switch (code) {
    case 'ERROR_CAPACITY_FULL': {
      const alts = context.alternatives ?? []
      const altTimes = alts.slice(0, 3).map(a => a.formatted).join(', ')
      return {
        code,
        message_for_ai: `The requested slot ${context.slot ?? ''} is not available for the requested resource. ${alts.length} alternative slots found.`,
        suggested_user_prompt: altTimes
          ? `Lo siento, ${context.slot ? `a las ${context.slot}` : 'en ese horario'} ya no hay disponibilidad en ${context.business ?? 'el negocio'}. ¿Te vendría bien a las ${altTimes}?`
          : `Lo siento, no hay disponibilidad en ese horario en ${context.business ?? 'el negocio'}. ¿Quieres que busque otro día?`,
        alternative_slots: alts.slice(0, 3),
      }
    }

    case 'ERROR_MISSING_DATA': {
      const missing = context.missing?.join(', ') ?? 'campos requeridos'
      return {
        code,
        message_for_ai: `Required fields missing from request: ${missing}`,
        suggested_user_prompt: `Para hacer la reserva necesito que me indiques: ${missing}.`,
      }
    }

    case 'ERROR_INVALID_DATETIME':
      return {
        code,
        message_for_ai: `Cannot parse datetime input: "${context.input ?? 'unknown'}". Expected ISO 8601, relative date, or {date, time} object.`,
        suggested_user_prompt: `No he entendido bien la fecha "${context.input ?? ''}". ¿Puedes decirme el día y la hora con más detalle? Por ejemplo: "el lunes a las 10 de la mañana".`,
      }

    case 'ERROR_DUPLICATE_BOOKING':
      return {
        code,
        message_for_ai: `Customer ${context.name ?? ''} already has a booking at the requested time slot.`,
        suggested_user_prompt: `Parece que ${context.name ?? 'este cliente'} ya tiene una cita en ${context.business ?? 'el negocio'} a esa hora. ¿Quieres cambiarla o es para otra persona?`,
      }

    case 'ERROR_BUSINESS_NOT_FOUND':
      return {
        code,
        message_for_ai: `Business with slug "${context.slug ?? ''}" not found in the database.`,
        suggested_user_prompt: `No he encontrado el negocio "${context.slug ?? ''}". ¿Puedes confirmar el nombre exacto del negocio?`,
      }

    case 'ERROR_INVALID_TOKEN':
      return {
        code,
        message_for_ai: 'Invalid or missing x-tableo-ai-token header.',
        suggested_user_prompt: 'No tengo autorización para hacer reservas en este momento. Por favor, contacta directamente con el negocio.',
      }
  }
}
```

- [ ] **Step 3.3: Verificar TypeScript**

```bash
cd C:\Users\Rubén\Desktop\Tableo && pnpm tsc --noEmit 2>&1
```

Expected: sin errores.

- [ ] **Step 3.4: Commit**

```bash
git add src/lib/ai/token-auth.ts src/lib/ai/error-factory.ts
git commit -m "feat: add AI token auth and conversational error factory"
```

---

## Task 4: POST /api/ai/book route handler

**Files:**
- Create: `src/app/api/ai/book/route.ts`

- [ ] **Step 4.1: Crear `src/app/api/ai/book/route.ts`**

```typescript
// src/app/api/ai/book/route.ts
// Endpoint para reservas mediante LLMs (Gemini, Claude, GPT, Siri).
// Autenticado con TABLEO_AI_TOKEN en header x-tableo-ai-token.
// Las reservas se crean con status 'pending_ai_confirmation' — el negocio aprueba desde el dashboard.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAdapter } from '@/modules/availability/factory'
import { formatSlotTime } from '@/lib/dates'
import { validateAiToken } from '@/lib/ai/token-auth'
import { buildError } from '@/lib/ai/error-factory'
import { normalizeDateTime } from '@/lib/ai/date-normalizer'
import { ParseError } from '@/lib/ai/types'
import type { AiBookingRequest, AiSuccessResponse, AlternativeSlot } from '@/lib/ai/types'
import type { Business } from '@/lib/db/types'

export async function POST(request: Request) {
  // 1. Validar token
  if (!validateAiToken(request)) {
    return NextResponse.json(buildError('ERROR_INVALID_TOKEN'), { status: 401 })
  }

  // 2. Parsear body
  let body: AiBookingRequest
  try {
    body = await request.json() as AiBookingRequest
  } catch {
    return NextResponse.json(
      buildError('ERROR_MISSING_DATA', { missing: ['request body (invalid JSON)'] }),
      { status: 422 }
    )
  }

  // 3. Validar campos obligatorios
  const missing: string[] = []
  if (!body.business_slug) missing.push('business_slug')
  if (!body.resource_id)   missing.push('resource_id')
  if (!body.datetime)      missing.push('datetime')
  if (!body.customer?.name) missing.push('customer.name')

  if (missing.length > 0) {
    return NextResponse.json(
      buildError('ERROR_MISSING_DATA', { missing }),
      { status: 422 }
    )
  }

  const supabase = await createServerClient()

  // 4. Buscar el negocio por slug
  const { data: business } = await supabase
    .from('businesses')
    .select('id, name, sector_type, timezone_id, config')
    .eq('slug', body.business_slug)
    .single<Business>()

  if (!business) {
    return NextResponse.json(
      buildError('ERROR_BUSINESS_NOT_FOUND', { slug: body.business_slug }),
      { status: 404 }
    )
  }

  // 5. Normalizar fecha/hora
  let startAt: Date
  try {
    startAt = normalizeDateTime(body.datetime, business.timezone_id)
  } catch (err) {
    if (err instanceof ParseError) {
      return NextResponse.json(
        buildError('ERROR_INVALID_DATETIME', {
          input: typeof body.datetime === 'string' ? body.datetime : JSON.stringify(body.datetime),
        }),
        { status: 422 }
      )
    }
    throw err
  }

  // 6. Calcular endAt usando duration_minutes o el default del recurso
  const adapter = getAdapter(business.sector_type, supabase)
  const dateStr = startAt.toISOString().split('T')[0]
  const slots = await adapter.getSlots(body.resource_id, dateStr, business.timezone_id)

  // Buscar el slot que corresponde a startAt
  const requestedSlot = slots.find(
    s => Math.abs(s.startAt.getTime() - startAt.getTime()) < 60_000 // tolerancia 1 minuto
  )

  if (!requestedSlot) {
    // Slot no disponible — buscar las 3 alternativas más cercanas
    const alternatives: AlternativeSlot[] = slots
      .filter(s => s.startAt > new Date()) // solo futuros
      .slice(0, 3)
      .map(s => ({
        start_at: s.startAt.toISOString(),
        end_at:   s.endAt.toISOString(),
        formatted: formatSlotTime(s.startAt, business.timezone_id),
      }))

    return NextResponse.json(
      buildError('ERROR_CAPACITY_FULL', {
        slot:         formatSlotTime(startAt, business.timezone_id),
        business:     business.name,
        alternatives,
      }),
      { status: 409 }
    )
  }

  const endAt = requestedSlot.endAt

  // 7. Upsert cliente (by phone OR email, scoped to business_id)
  const { data: existingCustomer } = await supabase
    .from('customers')
    .select('id')
    .eq('business_id', business.id)
    .or(
      [
        body.customer.phone ? `phone.eq.${body.customer.phone}` : null,
        body.customer.email ? `email.eq.${body.customer.email}` : null,
      ]
        .filter(Boolean)
        .join(',')
    )
    .maybeSingle()

  let customerId: string

  if (existingCustomer?.id) {
    customerId = existingCustomer.id
  } else {
    const { data: newCustomer, error: customerError } = await supabase
      .from('customers')
      .insert({
        business_id: business.id,
        name:  body.customer.name,
        phone: body.customer.phone ?? null,
        email: body.customer.email ?? null,
      })
      .select('id')
      .single()

    if (customerError || !newCustomer) {
      return NextResponse.json(
        buildError('ERROR_MISSING_DATA', { missing: ['customer phone or email (required to identify customer)'] }),
        { status: 422 }
      )
    }
    customerId = newCustomer.id
  }

  // 8. Verificar duplicate booking
  const { data: duplicate } = await supabase
    .from('bookings')
    .select('id')
    .eq('customer_id', customerId)
    .eq('resource_id', body.resource_id)
    .in('status', ['reserved', 'confirmed', 'pending_ai_confirmation'])
    .lt('start_at', endAt.toISOString())
    .gt('end_at', startAt.toISOString())
    .maybeSingle()

  if (duplicate) {
    return NextResponse.json(
      buildError('ERROR_DUPLICATE_BOOKING', {
        name:     body.customer.name,
        business: business.name,
      }),
      { status: 409 }
    )
  }

  // 9. Insertar reserva con status pending_ai_confirmation
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .insert({
      resource_id:   body.resource_id,
      customer_id:   customerId,
      start_at:      startAt.toISOString(),
      end_at:        endAt.toISOString(),
      status:        'pending_ai_confirmation',
      ai_source:     true,
      metadata: {
        service:          body.service ?? null,
        notes:            body.notes ?? null,
        ai_requested_by:  body.customer.name,
      },
    })
    .select('id')
    .single()

  if (bookingError || !booking) {
    console.error('[AI API] Error inserting booking:', bookingError)
    return NextResponse.json(
      buildError('ERROR_MISSING_DATA', { missing: ['booking insert failed — check server logs'] }),
      { status: 500 }
    )
  }

  // 10. Respuesta de éxito
  const slotFormatted = formatSlotTime(startAt, business.timezone_id)
  const successResponse: AiSuccessResponse = {
    booking_id:  booking.id,
    status:      'pending_ai_confirmation',
    start_at:    startAt.toISOString(),
    end_at:      endAt.toISOString(),
    message_for_ai: `Booking created successfully with status pending_ai_confirmation. Business owner must confirm before it becomes active.`,
    suggested_user_prompt: `¡Perfecto! He solicitado tu cita en ${business.name} para las ${slotFormatted}. El negocio la confirmará en breve y te avisaremos cuando esté lista. ¿Necesitas algo más?`,
  }

  return NextResponse.json(successResponse, { status: 201 })
}
```

- [ ] **Step 4.2: Verificar que el build pasa**

```bash
cd C:\Users\Rubén\Desktop\Tableo && pnpm build 2>&1
```

Expected: exit code 0. Si hay errores de TypeScript en el route, corregirlos antes de continuar.

- [ ] **Step 4.3: Verificar TypeScript**

```bash
cd C:\Users\Rubén\Desktop\Tableo && pnpm tsc --noEmit 2>&1
```

Expected: sin errores.

- [ ] **Step 4.4: Commit**

```bash
git add src/app/api/ai/book/route.ts
git commit -m "feat: add POST /api/ai/book endpoint for LLM-powered bookings"
```

---

## Task 5: OpenAPI 3.1 + Gemini Tool Definition

**Files:**
- Create: `docs/api/openapi.yaml`
- Create: `docs/api/gemini-tool-definition.json`

- [ ] **Step 5.1: Crear `docs/api/openapi.yaml`**

```yaml
openapi: 3.1.0
info:
  title: Tableo AI Booking API
  version: 1.0.0
  description: |
    API para integración con LLMs (Gemini, Claude, GPT, Siri, Google Voice).
    Permite realizar reservas mediante lenguaje natural con manejo conversacional de errores.
    Todas las reservas de IA se crean con status `pending_ai_confirmation` — 
    el dueño del negocio las aprueba desde el dashboard.

servers:
  - url: https://tableo.app
    description: Producción
  - url: http://localhost:3000
    description: Desarrollo local

security:
  - AiTokenAuth: []

paths:
  /api/ai/book:
    post:
      operationId: createAiBooking
      summary: Crear reserva desde LLM
      description: |
        Crea una reserva con status `pending_ai_confirmation`. 
        Si el slot no está disponible, devuelve hasta 3 alternativas.
        Todos los errores incluyen `suggested_user_prompt` listo para que la IA lo diga al usuario.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/AiBookingRequest'
            example:
              business_slug: salon-luna
              resource_id: 550e8400-e29b-41d4-a716-446655440000
              datetime: "mañana a las 10 de la mañana"
              customer:
                name: María García
                phone: "+34666555444"
              service: Corte de pelo
      responses:
        '201':
          description: Reserva creada (pendiente de confirmación del negocio)
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AiSuccessResponse'
        '401':
          description: Token inválido o ausente
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AiErrorResponse'
              example:
                code: ERROR_INVALID_TOKEN
                message_for_ai: "Invalid or missing x-tableo-ai-token header."
                suggested_user_prompt: "No tengo autorización para hacer reservas. Contacta directamente con el negocio."
        '404':
          description: Negocio no encontrado
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AiErrorResponse'
        '409':
          description: Slot ocupado o reserva duplicada
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AiErrorResponse'
              examples:
                capacity_full:
                  value:
                    code: ERROR_CAPACITY_FULL
                    message_for_ai: "Slot 10:00 not available. 3 alternatives found."
                    suggested_user_prompt: "Lo siento, a las 10:00 ya no hay disponibilidad. ¿Te vendría bien a las 10:30, 11:00 o las 11:30?"
                    alternative_slots:
                      - start_at: "2024-06-17T08:30:00Z"
                        end_at: "2024-06-17T09:30:00Z"
                        formatted: "10:30"
                      - start_at: "2024-06-17T09:00:00Z"
                        end_at: "2024-06-17T10:00:00Z"
                        formatted: "11:00"
                      - start_at: "2024-06-17T09:30:00Z"
                        end_at: "2024-06-17T10:30:00Z"
                        formatted: "11:30"
        '422':
          description: Datos inválidos o fecha no parseada
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AiErrorResponse'

components:
  securitySchemes:
    AiTokenAuth:
      type: apiKey
      in: header
      name: x-tableo-ai-token
      description: Token secreto compartido. Variable de entorno TABLEO_AI_TOKEN.

  schemas:
    AiBookingRequest:
      type: object
      required: [business_slug, resource_id, datetime, customer]
      properties:
        business_slug:
          type: string
          description: Identificador URL del negocio (ej. "salon-luna")
          example: salon-luna
        resource_id:
          type: string
          format: uuid
          description: UUID del recurso (profesional, mesa, etc.) a reservar
        datetime:
          oneOf:
            - type: string
              description: Fecha/hora en cualquier formato — ISO 8601, relativo español/inglés ('mañana a las 10', 'tomorrow at 3pm')
            - type: object
              description: Objeto estructurado de Siri o Google Assistant
              required: [date, time]
              properties:
                date:
                  type: string
                  pattern: '^\d{4}-\d{2}-\d{2}$'
                  example: "2024-06-17"
                time:
                  type: string
                  example: "10:00"
        duration_minutes:
          type: integer
          description: Duración en minutos (opcional — si no se envía, se usa el default del recurso)
          example: 60
        customer:
          type: object
          required: [name]
          properties:
            name:
              type: string
              description: Nombre completo del cliente
              example: María García
            phone:
              type: string
              description: Teléfono en formato E.164. Necesario para identificar al cliente.
              example: "+34666555444"
            email:
              type: string
              format: email
              example: maria@example.com
        service:
          type: string
          description: Nombre del servicio solicitado
          example: Corte de pelo
        notes:
          type: string
          description: Notas adicionales del cliente
          example: Pelo corto, sin flequillo

    AiSuccessResponse:
      type: object
      properties:
        booking_id:
          type: string
          format: uuid
        status:
          type: string
          enum: [pending_ai_confirmation]
        start_at:
          type: string
          format: date-time
        end_at:
          type: string
          format: date-time
        message_for_ai:
          type: string
          description: Explicación técnica del resultado para el LLM
        suggested_user_prompt:
          type: string
          description: Frase amigable lista para que el LLM diga al usuario final

    AlternativeSlot:
      type: object
      properties:
        start_at:
          type: string
          format: date-time
        end_at:
          type: string
          format: date-time
        formatted:
          type: string
          description: Hora formateada en la timezone del negocio (ej. "10:30")
          example: "10:30"

    AiErrorResponse:
      type: object
      required: [code, message_for_ai, suggested_user_prompt]
      properties:
        code:
          type: string
          enum:
            - ERROR_CAPACITY_FULL
            - ERROR_MISSING_DATA
            - ERROR_INVALID_DATETIME
            - ERROR_DUPLICATE_BOOKING
            - ERROR_BUSINESS_NOT_FOUND
            - ERROR_INVALID_TOKEN
          description: Código de error estructurado para que el LLM determine la acción
        message_for_ai:
          type: string
          description: Descripción técnica del error para el LLM
        suggested_user_prompt:
          type: string
          description: Frase en español lista para comunicar el error al usuario final
        alternative_slots:
          type: array
          description: Solo presente cuando code = ERROR_CAPACITY_FULL. Máximo 3 slots.
          items:
            $ref: '#/components/schemas/AlternativeSlot'
```

- [ ] **Step 5.2: Crear `docs/api/gemini-tool-definition.json`**

```json
{
  "_comment": "Gemini Function Calling / OpenAI Tool Definition para Tableo booking API. Compatible con Google AI Studio, OpenAI function_calling, Anthropic tool_use y Apple Siri Shortcuts.",
  "name": "book_appointment",
  "description": "Crea una reserva en un negocio de Tableo (peluquería, restaurante, etc.) a través de la API. Usa esta función cuando el usuario quiera hacer, solicitar o pedir una cita o reserva. La reserva queda pendiente de confirmación por parte del negocio. Si el horario solicitado no está disponible, la respuesta incluirá hasta 3 alternativas.",
  "parameters": {
    "type": "object",
    "required": ["business_slug", "resource_id", "datetime", "customer_name"],
    "properties": {
      "business_slug": {
        "type": "string",
        "description": "Identificador único del negocio en formato URL (slug). Ejemplo: 'salon-luna', 'restaurante-casa-pepe'. Extraer del contexto o preguntar al usuario si no se conoce."
      },
      "resource_id": {
        "type": "string",
        "description": "UUID del profesional, mesa u otro recurso a reservar. Si el usuario no especifica con quién quiere la cita, usar el UUID del recurso disponible más próximo al horario solicitado."
      },
      "datetime": {
        "type": "string",
        "description": "Fecha y hora de la reserva. Puede ser: (1) ISO 8601 con timezone: '2024-06-17T10:00:00Z'. (2) ISO 8601 sin timezone: '2024-06-17T10:00:00' (se interpreta como hora local del negocio). (3) Texto relativo en español: 'mañana a las 10', 'el viernes a las 3 de la tarde', 'pasado mañana por la mañana'. (4) Texto relativo en inglés: 'tomorrow at 10am', 'next friday at 3pm'. IMPORTANTE: enviar el texto tal como lo dijo el usuario si no hay ambigüedad de zona horaria."
      },
      "customer_name": {
        "type": "string",
        "description": "Nombre completo del cliente. Extraer del contexto de la conversación o preguntar si no se sabe."
      },
      "customer_phone": {
        "type": "string",
        "description": "Número de teléfono del cliente en formato E.164 (ej. '+34666555444'). Muy recomendable incluirlo para identificar clientes recurrentes. Preguntar si no se dispone de él."
      },
      "customer_email": {
        "type": "string",
        "description": "Email del cliente. Alternativa al teléfono para identificación. Incluir si está disponible."
      },
      "service": {
        "type": "string",
        "description": "Nombre del servicio solicitado (ej. 'Corte de pelo', 'Manicura', 'Mesa para 4'). Extraer de lo que dijo el usuario."
      },
      "notes": {
        "type": "string",
        "description": "Notas adicionales que el cliente quiere que sepa el negocio (ej. 'pelo corto sin flequillo', 'alergia a ciertos productos', 'cumpleaños')."
      },
      "duration_minutes": {
        "type": "integer",
        "description": "Duración del servicio en minutos. Solo incluir si el usuario especificó una duración concreta. Si no, omitir y el sistema usará el tiempo estándar del servicio."
      }
    }
  },
  "example_calls": [
    {
      "description": "Usuario: 'Pídeme cita en el salón luna con Laura para mañana a las 10'",
      "call": {
        "business_slug": "salon-luna",
        "resource_id": "<uuid-laura>",
        "datetime": "mañana a las 10",
        "customer_name": "María García",
        "customer_phone": "+34666555444"
      }
    },
    {
      "description": "Usuario: 'Reserva una mesa para 4 el viernes a las 9 de la noche'",
      "call": {
        "business_slug": "restaurante-casa-pepe",
        "resource_id": "<uuid-mesa-4>",
        "datetime": "el viernes a las 9 de la noche",
        "customer_name": "Carlos Ruiz",
        "customer_phone": "+34677888999",
        "service": "Mesa para 4 personas"
      }
    }
  ],
  "error_handling": {
    "ERROR_CAPACITY_FULL": "El slot solicitado no está disponible. Usar alternative_slots[] para ofrecer alternativas. Decir el suggested_user_prompt al usuario.",
    "ERROR_MISSING_DATA": "Faltan datos. Preguntar al usuario los campos indicados en missing[].",
    "ERROR_INVALID_DATETIME": "No se pudo interpretar la fecha. Pedir al usuario que la reformule.",
    "ERROR_DUPLICATE_BOOKING": "El cliente ya tiene cita. Preguntar si quiere cambiarla.",
    "ERROR_BUSINESS_NOT_FOUND": "Negocio no encontrado. Verificar el slug con el usuario.",
    "ERROR_INVALID_TOKEN": "Error de configuración. No informar al usuario del token."
  },
  "api_config": {
    "endpoint": "https://tableo.app/api/ai/book",
    "method": "POST",
    "headers": {
      "Content-Type": "application/json",
      "x-tableo-ai-token": "<TABLEO_AI_TOKEN>"
    }
  }
}
```

- [ ] **Step 5.3: Actualizar .env.local.example con la nueva variable**

Abrir `.env.local.example` y añadir al final:

```
# AI Agent API — token compartido para LLMs (Gemini, Claude, GPT, Siri)
TABLEO_AI_TOKEN=tableo_ai_change_me_in_production
```

- [ ] **Step 5.4: Commit**

```bash
git add docs/api/ .env.local.example
git commit -m "docs: add OpenAPI 3.1 spec and Gemini Function Calling definition for AI booking API"
```

---

## Self-Review

### Spec coverage

| Requisito | Task |
|-----------|------|
| TABLEO_AI_TOKEN en header | Task 3 (token-auth.ts) |
| Reutiliza getSlots() existente | Task 4 (route.ts usa getAdapter) |
| status pending_ai_confirmation | Task 1 (migration 007 + db/types.ts) |
| Date normalizer (ISO, relativo, Siri) | Task 2 (date-normalizer.ts, 8 tests) |
| ERROR_CAPACITY_FULL con alternative_slots[3] | Task 3 (error-factory) + Task 4 (route) |
| Todos los error codes | Task 3 (error-factory.ts) |
| suggested_user_prompt en todos los errores | Task 3 (buildError templates) |
| message_for_ai en todos los errores | Task 3 (buildError) |
| JSON Schema / Function Calling (Gemini) | Task 5 (gemini-tool-definition.json) |
| OpenAPI 3.1 | Task 5 (openapi.yaml) |
| ai_source column | Task 1 (migration 007) |

### Type consistency
- `AiErrorCode` values en types.ts == switch cases en error-factory.ts ✅
- `BookingStatus` en db/types.ts incluye 'pending_ai_confirmation' == migration 007 CHECK ✅
- `AlternativeSlot.formatted` generado con `formatSlotTime()` de dates.ts ✅

### Placeholder scan
Ningún TBD. El comentario `// Phase 4: per-business token` es intencional y documentado. ✅
