# ADR-007: UX Mobile-First, Branding Dinámico, Feedback y Accesibilidad

**Status:** Accepted  
**Date:** 2026-04-27  
**Deciders:** Equipo Tableo  
**Origen:** Auditoría UX externa del plan de arquitectura

## Context

La auditoría UX identificó cuatro requisitos que deben definirse antes de escribir código de interfaz:

1. El 80% de clientes reservan desde móvil. El 90% de dueños gestionan desde el teléfono.
2. Las páginas de reserva genéricas destruyen la identidad de marca del negocio.
3. El sistema de locks de 5 minutos requiere feedback visual explícito o el usuario se frustra.
4. Los calendarios son las implementaciones más inaccesibles del ecosistema web.

## Decisions

### A — Mobile-First: Calendario con Gestos Táctiles

El dashboard tiene dos variantes del componente de calendario. La lógica de datos es idéntica; solo cambia la capa de interacción.

**Estructura de componentes:**

```
src/modules/dashboard/ui/Calendar/
├── index.tsx           ← detecta touch/mouse, renderiza la variante
├── CalendarDesktop.tsx ← drag & drop con ratón (@dnd-kit PointerSensor)
├── CalendarMobile.tsx  ← swipe + long-press (@dnd-kit TouchSensor)
└── hooks/
    └── use-pointer-type.ts
```

**Gestos táctiles requeridos en CalendarMobile:**
- Deslizar izquierda/derecha → semana anterior/siguiente
- Pulsar y mantener (500ms) → iniciar arrastre de cita
- Arrastrar con el dedo → mover cita a nuevo horario
- Pellizcar → cambiar entre vista día / semana

**Librería:** `@dnd-kit/core` con `TouchSensor`. No usar HTML5 drag-and-drop nativo — no funciona en iOS Safari.

**Breakpoints:**
- `< 768px` → vista día por defecto, navegación por swipe
- `≥ 768px` → vista semana, drag & drop con ratón

### B — Branding Dinámico en `businesses.config`

El campo `config jsonb` de `businesses` tiene la siguiente estructura oficial:

```json
{
  "branding": {
    "logo_url":     "https://cdn.tableo.app/logos/{business-id}.png",
    "accent_color": "#e91e8c",
    "accent_dark":  "#c2185b",
    "cover_url":    "https://cdn.tableo.app/covers/{business-id}.jpg"
  },
  "booking": {
    "min_advance_hours":  2,
    "max_advance_days":   30,
    "cancellation_hours": 24,
    "buffer_minutes":     0
  }
}
```

**Inyección de colores sin JS extra:**

```tsx
// src/app/(booking)/[slug]/layout.tsx
export default function BookingLayout({ business, children }) {
  const branding = business.config?.branding ?? {}
  return (
    <div style={{
      '--color-accent':      branding.accent_color ?? '#7c6dff',
      '--color-accent-dark': branding.accent_dark  ?? '#5a4fe0',
    } as React.CSSProperties}>
      {children}
    </div>
  )
}
```

Los botones, slots seleccionados y elementos interactivos usan `var(--color-accent)` en CSS. Cero JS extra, cero reconstrucción del bundle por negocio.

**Almacenamiento de assets:** Supabase Storage bucket `business-assets` con acceso público. El negocio sube logo y portada desde el wizard de onboarding.

### C — Feedback de Bloqueo: Countdown + Skeleton Screens

**BookingCountdown** — componente obligatorio durante el two-phase booking:

```
src/modules/booking/ui/
├── BookingCountdown.tsx   ← timer regresivo visible
├── SlotExpiredBanner.tsx  ← mensaje cuando expira (libera slot automáticamente)
└── CalendarSkeleton.tsx   ← estado de carga del calendario
```

**Comportamiento del Countdown:**
- Aparece inmediatamente al reservar el slot (fase 1 del two-phase booking)
- Muestra minutos:segundos restantes de los 5 minutos
- A 60 segundos: cambia a rojo + animación de pulso
- A 0 segundos: llama `releaseSlot()` silenciosamente, muestra `SlotExpiredBanner`, refresca disponibilidad sin recargar página

**Skeleton Screens** — requeridos en:
- Calendario de slots (mientras `getSlots()` responde)
- Lista de reservas del dashboard (mientras carga el día)
- Perfil del profesional en el picker de belleza

Implementación con Tailwind: `animate-pulse bg-gray-800 rounded` sobre divs con la forma exacta del contenido real.

### D — Accesibilidad: ARIA Grid + jest-axe en CI

**Patrón WAI-ARIA 1.1 Grid** para el selector de slots:

```tsx
<div
  role="grid"
  aria-label="Selecciona un horario disponible"
  aria-describedby="picker-help"
>
  <p id="picker-help" className="sr-only">
    Usa las flechas para navegar. Enter para seleccionar.
  </p>
  {slots.map(slot => (
    <button
      role="gridcell"
      aria-label={`${formatTime(slot.startAt)}, ${slot.status === 'available' ? 'disponible' : 'ocupado'}`}
      aria-selected={selectedSlot?.id === slot.id}
      aria-disabled={slot.status !== 'available'}
      disabled={slot.status !== 'available'}
    >
      {formatTime(slot.startAt)}
    </button>
  ))}
</div>
```

**Countdown accesible:**
```tsx
<div aria-live="polite" aria-atomic="true">
  Tienes {formatTime(secondsLeft)} para completar tu reserva
</div>
```

**Verificación automática en CI:**
```typescript
// src/modules/booking/ui/__tests__/SlotPicker.a11y.test.tsx
import { axe, toHaveNoViolations } from 'jest-axe'
expect.extend(toHaveNoViolations)

test('SlotPicker no tiene violaciones de accesibilidad', async () => {
  const { container } = render(<SlotPicker slots={mockSlots} />)
  expect(await axe(container)).toHaveNoViolations()
})
```

Si hay una violación ARIA → el test falla → el PR no se mergea. Accesibilidad como gate de CI, no como auditoría manual trimestral.

## Consequences

- ✅ Dashboard operable con el pulgar en móvil — paridad con apps nativas
- ✅ Cada negocio tiene su identidad de marca en la página de reserva pública
- ✅ Cero frustración por slots expirados — el usuario siempre sabe qué está pasando
- ✅ WCAG 2.1 AA desde el día 1 — no hay deuda de accesibilidad que pagar después
- ⚠️ `@dnd-kit/core` añade ~12kb al bundle del dashboard — aceptable
- ⚠️ El wizard de onboarding debe incluir subida de logo y selección de color antes del primer go-live
- ⚠️ `jest-axe` requiere configuración en el pipeline de CI desde el inicio

## Action Items

1. [ ] Instalar `@dnd-kit/core` y `@dnd-kit/sortable`
2. [ ] Crear `use-pointer-type.ts` hook para detección touch/mouse
3. [ ] Implementar `CalendarMobile` con `TouchSensor` como primer componente del dashboard
4. [ ] Definir estructura TypeScript de `BusinessConfig` con `branding` y `booking`
5. [ ] Crear Supabase Storage bucket `business-assets` con política pública de lectura
6. [ ] Implementar `BookingCountdown` y `SlotExpiredBanner`
7. [ ] Implementar `CalendarSkeleton` con Tailwind `animate-pulse`
8. [ ] Instalar `jest-axe` y añadir test de accesibilidad al `SlotPicker`
9. [ ] Configurar target WCAG 2.1 AA en el linter de accesibilidad (`eslint-plugin-jsx-a11y`)
