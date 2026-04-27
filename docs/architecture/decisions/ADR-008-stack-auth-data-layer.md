# ADR-008: Stack Técnico, Autenticación y Capa de Datos

**Status:** Accepted  
**Date:** 2026-04-27  
**Deciders:** Equipo Tableo  
**Origen:** Auditoría pre-desarrollo — 3 bloqueadores críticos identificados antes del scaffold

## Context

La auditoría pre-desarrollo (2026-04-27) identificó tres decisiones técnicas sin resolver que bloqueaban el inicio del scaffold:

1. **Capa de datos**: cómo habla Next.js con Supabase (Server Actions vs API Routes vs tRPC)
2. **Autenticación**: mecanismo de login para dueños de negocio (Google OAuth vs magic link vs email+password)
3. **Stack exacto**: package manager, testing framework, CSS, estado global, formularios

Estas decisiones tienen dependencias cruzadas: Google OAuth para auth resuelve también el token de Google Calendar (ADR-006), y Server Actions con Zod elimina la necesidad de una capa de validación separada.

## Decisions

### A — Capa de Datos: Server Actions

Next.js Server Actions como capa principal de comunicación entre cliente y Supabase.

**Estructura:**

```
src/modules/<module>/actions/
├── create-booking.ts    ← 'use server'; llama al engine
├── get-slots.ts         ← 'use server'; llama al adapter
└── release-slot.ts      ← 'use server'; llama al adapter
```

**Reglas:**
- Todas las mutations van por Server Actions (`'use server'`)
- Las Server Actions llaman al Availability Engine, nunca al cliente Supabase directamente
- Las queries de solo lectura pueden usar `supabase` client-side con RLS (ADR-005)
- Validación de inputs en Server Actions con **Zod** antes de llegar al engine

**Por qué no API Routes:** más boilerplate, sin type-safety automático, innecesario para un monolito. Las API Routes se reservan exclusivamente para webhooks externos (Google Calendar, pagos futuros).

**Por qué no tRPC:** complejidad de setup superior al beneficio para un equipo de 2 personas. Server Actions ya da type-safety de extremo a extremo en un monolito Next.js.

**API Routes permitidas únicamente para:**
- `POST /api/webhooks/google-calendar` (ADR-006)
- `POST /api/webhooks/stripe` (fase futura de pagos)

### B — Autenticación: Google OAuth vía Supabase Auth

Supabase Auth con proveedor Google OAuth como único mecanismo de login para dueños de negocio.

**Flujo:**

```
Dueño hace clic "Entrar con Google"
  → Supabase Auth inicia OAuth con scopes:
      - openid, email, profile (auth básica)
      - https://www.googleapis.com/auth/calendar (Google Calendar)
  → Google devuelve access_token + refresh_token
  → Supabase almacena tokens en auth.users metadata
  → confirmBooking() del adapter usa el token almacenado
```

**Scopes requeridos en el OAuth:**
```typescript
// src/lib/auth/google-scopes.ts
export const GOOGLE_SCOPES = [
  'openid',
  'email', 
  'profile',
  'https://www.googleapis.com/auth/calendar',
] as const
```

**Por qué no magic link:** añade fricción (abrir email para cada sesión) sin reducir complejidad técnica.

**Por qué no email+password:** requiere gestión de recuperación de contraseña, hashing, y no resuelve el token de Google Calendar — habría que hacer OAuth igualmente en un segundo paso.

**Clientes de booking (usuarios finales):** no necesitan cuenta. El flujo de reserva pública es anónimo, autenticado solo con `app.session_id` (ADR-005).

### C — Stack Técnico Exacto

| Pieza | Decisión | Versión mínima | Razón |
|-------|----------|----------------|-------|
| Package manager | **pnpm** | 9.x | Hasta 3× más rápido que npm, lockfile determinista |
| Runtime | **Node.js** | 20 LTS | Requerido por Next.js 15 |
| Framework | **Next.js** | 15.x | App Router, Server Actions, RSC |
| Testing unitario | **Vitest** | 2.x | 10-20× más rápido que Jest, misma API |
| Testing de componentes | **Testing Library** | 16.x | Estándar del ecosistema React |
| Testing de a11y | **jest-axe** | 9.x | Gate de CI para WCAG 2.1 AA (ADR-007) |
| CSS | **Tailwind CSS** | 3.x (no v4) | v4 aún inestable; shadcn/ui requiere v3 |
| Componentes UI | **shadcn/ui** | latest | Sin bundle propio, copia en repo, personalizable |
| Drag & drop | **@dnd-kit/core** | 6.x | TouchSensor para iOS Safari (ADR-007) |
| Formularios | **React Hook Form** + **Zod** | 7.x / 3.x | Validación isomórfica: client + server actions |
| Estado global | **Zustand** | 5.x | Solo si Context API no alcanza; no instalar hasta necesitarlo |
| Fechas | **date-fns** + **@date-fns/tz** | 3.x | UTC handling (ADR-006) |
| Linter a11y | **eslint-plugin-jsx-a11y** | 6.x | Gate de linting para ARIA (ADR-007) |

**Instalación base:**
```bash
pnpm create next-app@latest tableo-platform \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*"

pnpm add @supabase/supabase-js @supabase/ssr
pnpm add react-hook-form zod @hookform/resolvers
pnpm add date-fns @date-fns/tz
pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities

pnpm add -D vitest @vitejs/plugin-react jsdom
pnpm add -D @testing-library/react @testing-library/user-event
pnpm add -D jest-axe @types/jest-axe
pnpm add -D eslint-plugin-jsx-a11y
```

**Estructura de directorios:**
```
src/
├── app/
│   ├── (dashboard)/          ← layout autenticado
│   ├── (booking)/[slug]/     ← layout público por negocio
│   └── api/
│       └── webhooks/
│           └── google-calendar/route.ts
├── modules/
│   ├── availability/         ← engine + adapters (ADR-002)
│   ├── booking/
│   │   ├── actions/          ← Server Actions
│   │   └── ui/               ← BookingCountdown, SlotPicker...
│   ├── dashboard/
│   │   └── ui/Calendar/      ← CalendarDesktop, CalendarMobile
│   └── businesses/
├── lib/
│   ├── auth/                 ← google-scopes.ts, session helpers
│   ├── supabase/             ← client.ts, server.ts, middleware.ts
│   └── db/                   ← tipos TypeScript del schema
└── components/
    └── ui/                   ← shadcn/ui components
```

## Consequences

- ✅ Un solo token OAuth resuelve auth + Google Calendar — sin flujos adicionales
- ✅ Server Actions elimina el boilerplate de API Routes para operaciones internas
- ✅ Zod como fuente única de verdad para validación en cliente y servidor
- ✅ Vitest con el mismo API de Jest — sin curva de aprendizaje, test suite 10× más rápida
- ✅ shadcn/ui en Tailwind v3 — ecosistema estable, sin riesgos de v4
- ⚠️ Zustand no se instala hasta que Context API resulte insuficiente — YAGNI
- ⚠️ Los webhooks externos son las únicas API Routes — cualquier otra ruta es una violación de arquitectura
- ⚠️ pnpm requiere que todo el equipo tenga pnpm instalado globalmente (`npm i -g pnpm`)

## Action Items

1. [ ] Instalar pnpm globalmente si no está: `npm i -g pnpm`
2. [ ] Scaffold con `pnpm create next-app@latest` con las flags de ADR-008-C
3. [ ] Configurar proveedor Google en Supabase Auth con los scopes de ADR-008-B
4. [ ] Crear `src/lib/supabase/client.ts`, `server.ts`, `middleware.ts`
5. [ ] Configurar Vitest con `vitest.config.ts` y entorno jsdom
6. [ ] Instalar y configurar shadcn/ui (`pnpm dlx shadcn@latest init`)
7. [ ] Crear `BusinessConfig` TypeScript type desde `businesses.config` jsonb (ADR-007)
8. [ ] Activar `eslint-plugin-jsx-a11y` en `.eslintrc`
