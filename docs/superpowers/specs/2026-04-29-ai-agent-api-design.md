# AI Agent API Layer — Spec

**Fecha:** 2026-04-29  
**Depende de:** Phase 2 (AvailabilityAdapter, BeautyAdapter, getSlots, claimSlot)  
**Objetivo:** Interfaz entre LLMs (Gemini, Claude, GPT, Siri) y la lógica de negocio de Tableo para reservas por lenguaje natural.

---

## Decisiones de diseño

| Decisión | Elección | Razón |
|----------|----------|-------|
| Auth token | Single shared `TABLEO_AI_TOKEN` (env var) | V1 simple; por negocio en Phase 4 dashboard |
| Status IA | Nuevo `pending_ai_confirmation` | Dueño siempre aprueba antes de confirmar |
| Flujo | Check slots → INSERT directo (sin TTL) | No hay countdown en reservas por IA |
| Date parsing | `chrono-node` con locale `es` | Soporta ISO, relativo, objetos Siri/Google |
| Errores | JSON estructurado, nunca HTTP bare codes | LLMs necesitan `suggested_user_prompt` |

---

## File Structure

```
src/
├── app/api/ai/book/
│   └── route.ts                         ← POST /api/ai/book
├── lib/ai/
│   ├── types.ts                         ← tipos: AiBookingRequest, AiErrorCode, AiErrorResponse, AiSuccessResponse
│   ├── date-normalizer.ts               ← normalizeDateTime(input, timezoneId, referenceDate?) → Date
│   ├── token-auth.ts                    ← validateAiToken(request: Request) → boolean
│   ├── error-factory.ts                 ← buildError(code, context) → AiErrorResponse
│   └── __tests__/
│       └── date-normalizer.test.ts      ← 8 tests
docs/api/
├── openapi.yaml                         ← OpenAPI 3.1 spec completo
└── gemini-tool-definition.json          ← Function Calling para Gemini/GPT/Claude API
supabase/migrations/
└── 007_ai_booking.sql                   ← pending_ai_confirmation + ai_source column
```

---

## Migration 007

```sql
-- Añadir pending_ai_confirmation al CHECK de status
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending','reserved','confirmed','cancelled',
                    'completed','no_show','disputed','pending_ai_confirmation'));

-- Columna para identificar reservas de origen IA
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS
  ai_source boolean NOT NULL DEFAULT false;

-- Índice: el dashboard filtrará reservas pendientes de IA
CREATE INDEX IF NOT EXISTS idx_bookings_ai_pending
  ON bookings (ai_source, status)
  WHERE ai_source = true AND status = 'pending_ai_confirmation';
```

---

## Tipos TypeScript (`src/lib/ai/types.ts`)

```typescript
export interface AiBookingRequest {
  business_slug: string
  resource_id: string
  datetime: string | { date: string; time: string }  // cualquier formato
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
  alternative_slots?: AlternativeSlot[]  // solo en ERROR_CAPACITY_FULL
}

export interface AiSuccessResponse {
  booking_id: string
  status: 'pending_ai_confirmation'
  start_at: string   // ISO UTC
  end_at: string     // ISO UTC
  message_for_ai: string
  suggested_user_prompt: string
}
```

---

## date-normalizer.ts

Acepta cualquiera de estos formatos y devuelve `Date` en UTC:
- ISO 8601: `'2024-06-17T10:00:00Z'` → pass-through
- ISO sin timezone: `'2024-06-17T10:00:00'` → interpreta como hora local del negocio
- Relativo español: `'mañana a las 3'`, `'el viernes a las 10 de la mañana'`
- Relativo inglés: `'tomorrow at 3pm'`, `'next friday at 10am'`
- Objeto Siri/Google: `{ date: '2024-06-17', time: '10:00' }` → combina en ISO

Usa `chrono-node` con `chrono.es` para español. Si no puede parsear → lanza `ParseError` con code `ERROR_INVALID_DATETIME`.

---

## Flujo del endpoint POST /api/ai/book

```
1. validateAiToken(request)
   → si falla: return 401 + buildError('ERROR_INVALID_TOKEN')

2. Validar campos obligatorios: business_slug, resource_id, datetime, customer.name
   → si falta: return 422 + buildError('ERROR_MISSING_DATA', { missing: [...] })

3. Fetch business por slug (createServerClient)
   → si no existe: return 404 + buildError('ERROR_BUSINESS_NOT_FOUND')

4. normalizeDateTime(body.datetime, business.timezone_id)
   → si falla: return 422 + buildError('ERROR_INVALID_DATETIME')

5. getAdapter(business.sector_type, supabase).getSlots(resource_id, date, timezone_id)
   → Calcular startAt/endAt del slot solicitado

6. Verificar que el slot está en la lista de slots disponibles
   → si no: buscar 3 slots alternativos más cercanos
   → return 409 + buildError('ERROR_CAPACITY_FULL', { alternatives })

7. Upsert customer (by phone OR email, scoped to business_id)
   → INSERT OR GET customer_id

8. Verificar que no hay duplicate booking (mismo customer_id + overlap)
   → si existe: return 409 + buildError('ERROR_DUPLICATE_BOOKING')

9. INSERT booking con:
   - status: 'pending_ai_confirmation'
   - ai_source: true
   - customer_id, resource_id, start_at, end_at
   - metadata: { service, notes, ai_requested_by: customer.name }

10. return 201 + AiSuccessResponse
```

---

## Error Factory — suggested_user_prompt templates

| Code | Template ES |
|------|-------------|
| ERROR_CAPACITY_FULL | `"Lo siento, {{slot}} ya no está disponible en {{business}}. ¿Te vendría bien {{alt1}}, {{alt2}} o {{alt3}}?"` |
| ERROR_MISSING_DATA | `"Para hacer la reserva necesito que me indiques: {{missing_fields}}."` |
| ERROR_INVALID_DATETIME | `"No he entendido bien la fecha '{{input}}'. ¿Puedes decirme el día y la hora con más detalle?"` |
| ERROR_DUPLICATE_BOOKING | `"Parece que {{name}} ya tiene una cita en {{business}} a esa hora. ¿Quieres cambiarla o es para otra persona?"` |
| ERROR_BUSINESS_NOT_FOUND | `"No he encontrado el negocio '{{slug}}'. ¿Puedes confirmar el nombre exacto?"` |
| ERROR_INVALID_TOKEN | `"No tengo autorización para hacer reservas en este momento. Por favor, contacta directamente con el negocio."` |

---

## Tests (8 en date-normalizer.test.ts)

| Test | Input | Expected |
|------|-------|---------|
| ISO UTC pass-through | `'2024-06-17T10:00:00Z'` | Date igual |
| ISO local → UTC | `'2024-06-17T10:00:00'` + Madrid | 08:00 UTC |
| Relativo 'mañana' | `'mañana a las 10'` | siguiente día 10:00 local |
| Relativo 'el viernes' | `'el viernes a las 3 de la tarde'` | próximo viernes 15:00 |
| Objeto Siri | `{ date: '2024-06-17', time: '10:00' }` | Date correcta |
| Objeto Google | `{ date: '2024-06-17', time: '15:00' }` | Date correcta |
| Input inválido | `'xyz abc'` | lanza ParseError |
| Pasado rechazado | fecha de hace 2 días | lanza ParseError (no se puede reservar en el pasado) |

---

## OpenAPI 3.1 (docs/api/openapi.yaml)

Documenta:
- `POST /api/ai/book` con request body schema y los 6 response schemas
- Security scheme: `ApiKeyAuth` header `x-tableo-ai-token`
- Todos los `AiErrorResponse` schemas con ejemplos reales

## Gemini Tool Definition (docs/api/gemini-tool-definition.json)

Function Calling definition con:
- `name: "book_appointment"`
- `description`: explica cuándo usar la función y qué hace
- `parameters`: business_slug, resource_id, datetime (descripción muy clara para extracción), customer.name, customer.phone, service, notes
- Descripciones en español e inglés para máxima compatibilidad

---

## Variables de entorno nuevas

```
TABLEO_AI_TOKEN=tableo_ai_xxx...   # Token secreto compartido para todos los LLMs
```
