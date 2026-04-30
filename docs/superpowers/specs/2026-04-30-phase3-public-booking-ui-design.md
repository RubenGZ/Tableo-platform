# Phase 3: UI Pública de Reserva — Spec

**Fecha:** 2026-04-30
**Depende de:** Phase 2 (AvailabilityAdapter, BeautyAdapter, claimSlot, confirmBooking, releaseSlot)
**Siguiente fase:** Phase 4 — Dashboard UI (gestión de reservas por el dueño)

---

## Goal

Implementar la página pública `/book/[slug]` donde un cliente autenticado con Google puede reservar una cita en un negocio de Tableo. El flujo completo: elegir profesional (opcional) → día → hora → confirmar datos → confirmación.

---

## Decisiones de diseño

| Decisión | Elección | Razón |
|----------|----------|-------|
| Gestión de estado | `useReducer` en `BookingPage.tsx` | Flow lineal, sin necesidad de Zustand; estado efímero correcto para el lock |
| Operaciones DB | Server Actions | Sin API routes extra, tipadas, reutilizan BeautyAdapter directamente |
| Auth | Google OAuth obligatorio | Nombre/email del perfil de Google, sin formularios de registro |
| Selector de servicio | Sin selector (Phase 3) | No hay tabla `services`; duración desde `duration_default` del recurso |
| Layout | Híbrido móvil/escritorio | Móvil: wizard pantalla completa. Escritorio: dos columnas |
| DatePicker | `react-day-picker` | Accesible ARIA, localización ES, < 5 kb gzip |
| Confirmación post-booking | Página de confirmación (sin email) | Email en Phase 4 cuando el onboarding configure sender/plantillas |

---

## File Structure

```
src/
├── app/
│   ├── (booking)/[slug]/
│   │   └── page.tsx                        ← CREAR: Server Component, carga business+resources, comprueba auth
│   ├── login/
│   │   └── page.tsx                        ← CREAR: página de login con Google
│   └── auth/
│       └── callback/
│           └── route.ts                    ← CREAR: OAuth callback handler, intercambia code por sesión
├── modules/booking/
│   ├── ui/
│   │   ├── BookingPage.tsx                 ← CREAR: Client Component orquestador, useReducer
│   │   ├── ResourcePicker.tsx              ← CREAR: Paso 0 (opcional), elige profesional
│   │   ├── DatePicker.tsx                  ← CREAR: Paso 1, calendario de mes
│   │   ├── SlotPicker.tsx                  ← CREAR: Paso 2, grid ARIA de horas
│   │   ├── BookingCountdown.tsx            ← CREAR: timer 5 min con aria-live
│   │   ├── SlotExpiredBanner.tsx           ← CREAR: banner cuando expira el slot
│   │   ├── CustomerForm.tsx                ← CREAR: Paso 3, teléfono + notas
│   │   ├── BookingConfirmation.tsx         ← CREAR: Paso 4, resumen + "Añadir al calendario"
│   │   └── CalendarSkeleton.tsx            ← CREAR: skeleton animate-pulse para slots
│   ├── actions/
│   │   ├── get-slots.action.ts             ← CREAR: Server Action → BeautyAdapter.getSlots()
│   │   ├── claim-slot.action.ts            ← CREAR: Server Action → BeautyAdapter.claimSlot()
│   │   └── confirm-booking.action.ts       ← CREAR: Server Action → upsert customer + BeautyAdapter.confirmBooking()
│   ├── hooks/
│   │   └── use-booking-countdown.ts        ← CREAR: countdown regresivo, callback onExpired
│   └── __tests__/
│       ├── BookingPage.test.tsx            ← CREAR: 6 tests flujo completo
│       └── SlotPicker.a11y.test.tsx        ← CREAR: jest-axe WCAG 2.1 AA
└── middleware.ts                           ← MODIFICAR: añadir /book/[slug] al guard de auth
```

---

## Tipos TypeScript (`src/modules/booking/ui/BookingPage.tsx`)

```typescript
type BookingStep = 'resource' | 'date' | 'slots' | 'form' | 'confirmed'

interface BookingState {
  step: BookingStep
  resourceId: string | null      // null = cualquier profesional disponible
  date: string | null            // 'YYYY-MM-DD'
  slots: Slot[]                  // cargados al seleccionar fecha
  slotsLoading: boolean
  claimedSlot: Slot | null       // slot reclamado con claimSlot()
  bookingId: string | null       // devuelto por claimSlot()
  sessionId: string              // uuid generado al montar, estable durante toda la sesión
  reservedUntil: Date | null     // para el countdown
  confirmedBookingId: string | null
  error: string | null
}

type BookingAction =
  | { type: 'SELECT_RESOURCE'; resourceId: string | null }
  | { type: 'SELECT_DATE'; date: string }
  | { type: 'SLOTS_LOADING' }
  | { type: 'SLOTS_LOADED'; slots: Slot[] }
  | { type: 'CLAIM_SLOT'; slot: Slot; bookingId: string; reservedUntil: Date }
  | { type: 'SLOT_EXPIRED' }
  | { type: 'CONFIRM_BOOKING'; confirmedBookingId: string }
  | { type: 'GO_BACK' }
  | { type: 'SET_ERROR'; error: string }
```

---

## Componentes

### `BookingPage.tsx` — Orquestador

Client Component. Recibe `business`, `resources` y `user` como props del Server Component padre.

**Responsabilidades:**
- Inicializa el `useReducer` con `sessionId = crypto.randomUUID()`
- Si `resources.length === 1` → salta directamente al paso `date` con ese recurso preseleccionado
- Renderiza el componente correspondiente al `step` actual
- En móvil: each step ocupa la pantalla completa con header fijo (logo + nombre del negocio) y barra de progreso
- En escritorio (≥ 768px): columna izquierda con resumen sticky (profesional elegido, fecha, hora, countdown), columna derecha con el paso activo

**Barra de progreso:**
```
Paso 1/4 → Paso 2/4 → Paso 3/4 → Paso 4/4
(resource)   (date)    (slots+form)  (confirmed)
```
El paso `resource` solo cuenta si hay más de 1 recurso.

### `ResourcePicker.tsx`

- Lista de tarjetas: foto del profesional (avatar con inicial si no hay foto), nombre, especialidades del `resource.metadata.specialties[]`
- Tarjeta adicional "Cualquier profesional disponible" siempre primera
- Al seleccionar: dispatch `SELECT_RESOURCE`

### `DatePicker.tsx`

- Usa `react-day-picker` con locale `es`
- Deshabilita días pasados y días más allá de `business.config.booking.max_advance_days` (default 30)
- Deshabilita el día actual si la hora actual + `min_advance_hours` (default 2) supera el cierre del negocio
- Al seleccionar fecha: dispatch `SLOTS_LOADING` → fetch slots via Server Action o `useEffect` con `getSlots()` → dispatch `SLOTS_LOADED`

### `SlotPicker.tsx`

Grid ARIA de slots disponibles. Props: `slots: Slot[]`, `onSelect: (slot: Slot) => void`, `timezoneId: string`.

```tsx
<div
  role="grid"
  aria-label="Selecciona un horario disponible"
  aria-describedby="slot-help"
>
  <p id="slot-help" className="sr-only">
    Usa las flechas para navegar. Enter para seleccionar.
  </p>
  {slots.map(slot => (
    <button
      key={slot.startAt.toISOString()}
      role="gridcell"
      aria-label={`${formatSlotTime(slot.startAt, timezoneId)}, disponible`}
      aria-selected={selectedSlot?.startAt === slot.startAt}
      onClick={() => onSelect(slot)}
    >
      {formatSlotTime(slot.startAt, timezoneId)}
    </button>
  ))}
</div>
```

Si `slots.length === 0` muestra mensaje: "No hay huecos disponibles este día. Prueba con otra fecha."

### `BookingCountdown.tsx`

```tsx
<div aria-live="polite" aria-atomic="true" className={isUrgent ? 'text-red-500 animate-pulse' : ''}>
  Tienes {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')} para completar tu reserva
</div>
```

Siempre visible mientras `step === 'form'`. En escritorio aparece en la columna de resumen.

### `SlotExpiredBanner.tsx`

Banner que aparece cuando `secondsLeft === 0`. Mensaje: "El tiempo para completar la reserva ha expirado. Por favor, elige de nuevo tu horario." Botón "Volver a elegir hora" que hace dispatch `SLOT_EXPIRED` (vuelve al paso `slots`).

### `CustomerForm.tsx`

- Nombre pre-rellenado y **no editable** — viene de `session.user.user_metadata.full_name`
- Email pre-rellenado y no editable — viene de `session.user.email`
- Campo teléfono: opcional, placeholder "+34 666 555 444"
- Campo notas: opcional, textarea, placeholder "Ej: pelo corto, sin flequillo"
- Botón "Confirmar reserva" → llama `confirmBookingAction()`

### `BookingConfirmation.tsx`

Muestra:
- ✅ icono de confirmación
- Nombre del negocio + profesional
- Fecha y hora formateada en timezone del negocio
- Estado: "Pendiente de confirmación por el negocio"
- Botón "Añadir al calendario" → abre Google Calendar con los datos pre-rellenados vía URL:
  `https://calendar.google.com/calendar/render?action=TEMPLATE&text=...&dates=...`
- Botón "Volver al inicio"

### `CalendarSkeleton.tsx`

```tsx
// Skeleton para SlotPicker mientras carga
<div className="grid grid-cols-3 gap-2">
  {Array.from({ length: 9 }).map((_, i) => (
    <div key={i} className="h-10 animate-pulse bg-gray-800 rounded-lg" />
  ))}
</div>
```

---

## Server Actions

### `get-slots.action.ts`

```typescript
'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getAdapter } from '@/modules/availability/factory'
import type { Slot } from '@/modules/availability/types'
import type { SectorType } from '@/lib/db/types'

export async function getSlotsAction(
  resourceId: string,
  date: string,          // 'YYYY-MM-DD'
  timezoneId: string,
  sectorType: SectorType
): Promise<Slot[]>
```

Llama `getAdapter(sectorType, supabase).getSlots(resourceId, date, timezoneId)`. Se invoca desde `BookingPage` al seleccionar fecha — despacha `SLOTS_LOADING` antes y `SLOTS_LOADED` al resolver.

---

### `claim-slot.action.ts`

```typescript
'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getAdapter } from '@/modules/availability/factory'
import type { LockResult } from '@/modules/availability/types'
import type { SectorType } from '@/lib/db/types'

export async function claimSlotAction(
  resourceId: string,
  startAt: Date,
  endAt: Date,
  sessionId: string,
  sectorType: SectorType
): Promise<LockResult>
```

Llama `getAdapter(sectorType, supabase).claimSlot(resourceId, startAt, endAt, sessionId)`.

Si `result.success === false`:
- `reason === 'not_available'` → devuelve error "Este horario ya no está disponible. Elige otro."
- `reason === 'concurrent_lock'` → devuelve error "Alguien acaba de reservar este horario. Elige otro."

### `confirm-booking.action.ts`

```typescript
'use server'
export async function confirmBookingAction(
  bookingId: string,
  businessId: string,
  sectorType: SectorType,
  customerName: string,
  customerEmail: string,
  customerPhone: string | null,
  notes: string | null
): Promise<{ confirmedBookingId: string }>
```

Pasos internos:
1. Upsert customer por email + business_id → obtiene `customerId`
2. `getAdapter(sectorType, supabase).confirmBooking(bookingId, customerId, { notes })`
3. Devuelve `confirmedBookingId`

---

## Hook: `use-booking-countdown.ts`

```typescript
export function useBookingCountdown(
  reservedUntil: Date | null,
  onExpired: () => void
): { secondsLeft: number; isUrgent: boolean }
```

- `setInterval` cada 1 segundo, calcula `Math.max(0, Math.floor((reservedUntil - Date.now()) / 1000))`
- `isUrgent = secondsLeft <= 60`
- Cuando `secondsLeft === 0`: llama `onExpired()` y limpia el interval
- Limpieza con `useEffect` return para evitar memory leaks

---

## Auth: Login con Google

### `src/app/login/page.tsx`

Server Component. Lee `searchParams.next` (la URL a la que redirigir tras login).

```typescript
// Client Component hijo: LoginButton.tsx
'use client'
export function LoginButton({ next }: { next: string }) {
  const supabase = createBrowserClient()
  const handleLogin = () => supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=${next}`
    }
  })
  return <button onClick={handleLogin}>Continuar con Google</button>
}
```

### `src/app/auth/callback/route.ts`

Route handler que gestiona el callback OAuth de Supabase:
```typescript
// Intercambia el code por una sesión y redirige a `next`
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/book'
  if (code) {
    const supabase = await createServerClient()
    await supabase.auth.exchangeCodeForSession(code)
  }
  redirect(next)
}
```

### `src/middleware.ts` — Ampliar el guard

Añadir `/book/:path*` al matcher de rutas protegidas. Si no hay sesión → `redirect('/login?next=' + pathname)`.

---

## Flujo completo paso a paso

```
1. Cliente accede a /book/salon-luna
2. middleware.ts → sin sesión → redirect /login?next=/book/salon-luna
3. Login page → botón "Continuar con Google"
4. Supabase OAuth → Google consent → callback /auth/callback?next=/book/salon-luna
5. Sesión creada → redirect /book/salon-luna
6. page.tsx carga business + resources + session → renderiza <BookingPage>
7. BookingPage: si resources.length > 1 → muestra ResourcePicker
8. Cliente elige profesional o "Cualquiera" → paso DatePicker
9. Cliente elige día → getSlotsAction() carga slots → paso SlotPicker
10. Cliente elige hora → claimSlotAction() → bookingId + reservedUntil → countdown inicia
11. Paso CustomerForm: nombre/email de Google pre-rellenados, teléfono + notas
12. Cliente pulsa "Confirmar reserva" → confirmBookingAction()
    └── upsert customer
    └── confirmBooking() → status 'confirmed'
13. Paso BookingConfirmation: resumen + "Añadir al calendario"
```

---

## Responsive: Layout en dos columnas (escritorio)

```
┌─────────────────────────────────────────────────────┐
│  [Logo] Salón Luna                                  │ ← header
├───────────────────┬─────────────────────────────────┤
│  RESUMEN          │  PASO ACTUAL                    │
│  ─────────────    │  ─────────────────────────────  │
│  👤 Laura García  │  Elige un horario               │
│  📅 Lunes 17 jun  │                                 │
│  ⏱ 10:00 – 11:00 │  [09:00] [10:00] [11:00]        │
│                   │  [12:00] [13:00] [15:00]        │
│  ┌─────────────┐  │  [16:00] [17:00] [18:00]        │
│  │ 04:32 min   │  │                                 │
│  └─────────────┘  │                                 │
└───────────────────┴─────────────────────────────────┘
```

En móvil (< 768px): solo se muestra la columna derecha (paso actual), con el countdown fijo en el footer cuando está activo.

---

## Variables de entorno nuevas

```
NEXT_PUBLIC_SITE_URL=http://localhost:3000   # para el redirectTo del OAuth
```

---

## Testing

### `BookingPage.test.tsx` — 6 tests

| Test | Descripción |
|------|-------------|
| Salta ResourcePicker si solo hay 1 recurso | Lógica de skip |
| Muestra ResourcePicker si hay >1 recurso | Paso inicial correcto |
| Seleccionar fecha llama getSlots y muestra SlotPicker | Flujo fecha→slots |
| Seleccionar slot llama claimSlot y muestra countdown | Two-phase booking |
| Countdown a 0 llama releaseSlot y vuelve a SlotPicker | Expiración |
| Confirmar form llama confirmBooking y muestra BookingConfirmation | Flujo completo |

### `SlotPicker.a11y.test.tsx`

```typescript
import { axe, toHaveNoViolations } from 'jest-axe'
expect.extend(toHaveNoViolations)

test('SlotPicker no tiene violaciones WCAG 2.1 AA', async () => {
  const { container } = render(
    <SlotPicker slots={mockSlots} onSelect={() => {}} timezoneId="Europe/Madrid" />
  )
  expect(await axe(container)).toHaveNoViolations()
})
```

---

## Dependencias nuevas

```bash
pnpm add react-day-picker
pnpm add -D @testing-library/react @testing-library/user-event jest-axe
```

---

## Lo que NO entra en Phase 3

- Selector de servicios con tabla `services` → Phase 4/5
- Email de confirmación → Phase 4 (requiere configuración del dueño)
- Cancelación de reservas por el cliente → Phase 4
- Dashboard de gestión del dueño → Phase 4
- Google Calendar sync real → Phase 5
