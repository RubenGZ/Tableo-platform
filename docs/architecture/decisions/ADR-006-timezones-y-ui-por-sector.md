# ADR-006: Zonas Horarias + UI Components por Sector

**Status:** Accepted  
**Date:** 2026-04-27  
**Deciders:** Equipo Tableo  
**Origen:** Auditoría externa del plan de arquitectura original

## Context

La revisión externa del plan identificó dos omisiones críticas:

1. **Zonas horarias:** El análisis original no contempló el manejo de timezones. Un negocio en Canarias (UTC+0 en invierno) procesado con la hora de Madrid (UTC+1) genera reservas desplazadas una hora — fallo catastrófico para un sistema de reservas.

2. **UI genérica:** El schema de base de datos es correctamente unificado, pero si la interfaz de reserva es la misma para todos los sectores, el resultado es una experiencia confusa. Un cliente que reserva visita a un piso necesita ver campos completamente distintos al que reserva un corte de pelo.

## Decisions

### A — Zonas Horarias: UTC en DB + `timezone_id` por negocio

**Regla absoluta:** Todas las fechas se almacenan en UTC en la base de datos. Nunca en hora local.

```sql
-- businesses incluye timezone_id
ALTER TABLE businesses ADD COLUMN
  timezone_id text NOT NULL DEFAULT 'Europe/Madrid';
  -- 'Atlantic/Canary' | 'Europe/Lisbon' | 'America/Mexico_City' | etc.
```

**Flujo correcto:**

```
Negocio configura horario → se guarda en UTC
Cliente ve disponibilidad → se convierte de UTC a timezone_id del negocio
Cliente reserva slot       → se almacena en UTC
Negocio ve su agenda       → se convierte de UTC a su timezone_id
Notificación SMS/Email     → se muestra en timezone_id del negocio
```

**En código:**

```typescript
// src/lib/dates.ts — conversión SOLO en capa de presentación
import { TZDate } from '@date-fns/tz'

export function toBusinessLocal(utcDate: Date, timezoneId: string): string {
  return new TZDate(utcDate, timezoneId).toLocaleString('es-ES', {
    dateStyle: 'full',
    timeStyle: 'short'
  })
}

// El Motor de Disponibilidad opera siempre en UTC internamente
// Nunca hace conversiones de zona horaria — eso es responsabilidad de la UI
```

**Por qué `date-fns/tz` sobre `Intl.DateTimeFormat` directamente:**
- API más limpia para operaciones de suma/resta de tiempo
- Manejo correcto de horario de verano (DST)
- Tree-shakeable — no aumenta el bundle innecesariamente

### B — UI Components específicos por sector

**Principio:** El backend es sector-agnostic. La UI es sector-específica. Siempre.

```
src/modules/booking/ui/
├── beauty/
│   ├── BeautyBookingForm.tsx    → Elige servicio + profesional + hora
│   ├── BeautySlotPicker.tsx     → Calendario con slots por duración
│   └── BeautyConfirmation.tsx   → Resumen con precio del servicio
├── restaurant/
│   ├── RestaurantBookingForm.tsx → Número de comensales + ocasión
│   ├── RestaurantSlotPicker.tsx  → Turnos de comida/cena
│   └── RestaurantConfirmation.tsx
└── real_estate/
    ├── RealEstateBookingForm.tsx → Tipo de visita + datos del interesado
    └── ...
```

**Selector en la página pública de reservas:**

```typescript
// src/app/(booking)/[slug]/page.tsx
const BOOKING_UI = {
  beauty:      BeautyBookingForm,
  restaurant:  RestaurantBookingForm,
  real_estate: RealEstateBookingForm,
} as const

export default function BookingPage({ business }: Props) {
  const Form = BOOKING_UI[business.sector_type]
  // Cada Form llama al mismo Motor de Disponibilidad por debajo
  // pero presenta una experiencia completamente adaptada al sector
  return <Form business={business} />
}
```

**Lo que cada formulario maneja de forma distinta:**

| Aspecto | Belleza | Restaurante | Inmobiliaria |
|---------|---------|-------------|--------------|
| Selector principal | Servicio + Profesional | Nº comensales | Tipo de visita |
| Picker de slots | Por duración del servicio | Por turno (comida/cena) | Por ventana de 30min |
| Campo extra | Notas al estilo | Ocasión especial | Agente asignado |
| Precio visible | Sí | No (se paga en local) | No |
| Confirmación | Email + SMS al cliente | Email + SMS | Email al agente |

### C — Google Calendar como Skill del Motor (reclasificado de Fase 2 a MVP)

La sincronización bidireccional con Google Calendar pasa a ser parte del flujo de confirmación del Motor, no un módulo opcional.

**Motivo:** Los negocios pequeños gestionan su vida desde el móvil. Si Tableo no sincroniza con su Google Calendar, seguirán usando el calendario manual en paralelo → overbooking garantizado.

**Integración:**

```typescript
// Parte de AvailabilityAdapter.confirmBooking() — no es opcional
async confirmBooking(bookingId: string): Promise<void> {
  await db.bookings.update({ status: 'confirmed' }, bookingId)

  // Google Calendar sync es parte del contrato de confirmación
  if (business.googleCalendarId) {
    await calendarSync.createEvent({
      calendarId: business.googleCalendarId,
      summary:    `${service.name} — ${customer.name}`,
      start:      { dateTime: booking.start_at.toISOString() },
      end:        { dateTime: booking.end_at.toISOString() },
      timeZone:   business.timezone_id   // punto A aplicado
    })
  }
}

// Webhook de Google → Tableo: bloquea slots cuando hay eventos externos
// src/app/api/webhooks/google-calendar/route.ts
```

**Scope en MVP V1:**
- Conectar cuenta Google en el onboarding (paso obligatorio del wizard)
- Push de eventos a Google Calendar al confirmar reserva
- Pull de eventos de Google Calendar para bloquear slots ocupados
- Outlook Calendar → V2

## Consequences

- ✅ Cero riesgo de fechas desplazadas por timezone — el UTC es la única fuente de verdad
- ✅ Experiencia de reserva adaptada por sector — sin formularios genéricos confusos
- ✅ Los negocios ven sus reservas en su Google Calendar nada más confirmar
- ⚠️ Google OAuth añade complejidad al onboarding — el wizard debe guiarlo bien
- ⚠️ La librería `@date-fns/tz` debe instalarse como dependencia del proyecto
- ⚠️ Los webhooks de Google Calendar requieren una URL pública — Vercel lo resuelve automáticamente

## Action Items

1. [ ] Instalar `@date-fns/tz` y crear `src/lib/dates.ts` con las funciones de conversión
2. [ ] Añadir `timezone_id` al schema de `businesses` en la migración inicial
3. [ ] Crear estructura `src/modules/booking/ui/{beauty,restaurant,real_estate}/`
4. [ ] Implementar `BeautyBookingForm` como primer componente de referencia
5. [ ] Añadir paso de conexión Google Calendar al wizard de onboarding
6. [ ] Implementar `calendarSync.createEvent()` y `calendarSync.deleteEvent()`
7. [ ] Crear webhook `/api/webhooks/google-calendar` para pull de eventos externos
8. [ ] Test: reserva en Tableo → aparece en Google Calendar en <5 segundos
