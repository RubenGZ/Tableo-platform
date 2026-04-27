# Tableo MVP — Phase 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Next.js project, configure Supabase (schema + RLS + funciones PG), autenticación Google OAuth, tipos TypeScript del schema, y Vitest — todo listo para que Phase 2 (Motor de Disponibilidad) construya encima sin deuda técnica.

**Architecture:** Monolito Modular (ADR-001). Next.js 15 App Router con Server Actions para mutations internas. API Routes únicamente para webhooks externos. Supabase Pro como base de datos + auth + realtime.

**Tech Stack:** pnpm 9, Next.js 15, TypeScript 5, Supabase JS v2, Vitest 2, Tailwind CSS v3, shadcn/ui

---

## Fases del proyecto (scope completo)

Este plan cubre Phase 1. Los planes siguientes son:
- **Phase 2** — Motor de Disponibilidad (AvailabilityAdapter + BeautyAdapter + funciones PG de booking)
- **Phase 3** — UI Pública de Reserva (SlotPicker, BookingCountdown, página `/book/[slug]`)
- **Phase 4** — Dashboard UI (CalendarDesktop, CalendarMobile, dnd-kit)
- **Phase 5** — Branding Dinámico + Google Calendar sync

---

## File Structure

```
tableo-platform/                     ← raíz del proyecto (creado por pnpm create next-app)
├── supabase/
│   ├── migrations/
│   │   ├── 001_initial_schema.sql   ← CREATE TABLE businesses, resources, bookings...
│   │   ├── 002_rls_policies.sql     ← ALTER TABLE ENABLE RLS + CREATE POLICY
│   │   ├── 003_functions.sql        ← reserve_slot(), confirm_booking(), release_slot()
│   │   └── 004_pg_cron.sql          ← limpieza automática de reservas expiradas
│   └── seed.sql                     ← un negocio de belleza con 3 profesionales
├── src/
│   ├── app/
│   │   ├── (dashboard)/
│   │   │   └── layout.tsx           ← layout autenticado; redirige a /login si no hay sesión
│   │   ├── (booking)/
│   │   │   └── [slug]/
│   │   │       └── layout.tsx       ← layout público; carga branding del negocio
│   │   └── api/
│   │       └── webhooks/
│   │           └── google-calendar/
│   │               └── route.ts     ← stub vacío (implementado en Phase 5)
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts            ← createBrowserClient (componentes cliente)
│   │   │   ├── server.ts            ← createServerClient (Server Components, Actions)
│   │   │   └── __tests__/
│   │   │       └── clients.test.ts  ← verifica que los clientes se crean sin error
│   │   ├── auth/
│   │   │   └── google-scopes.ts     ← GOOGLE_SCOPES constante (openid + calendar)
│   │   └── db/
│   │       └── types.ts             ← tipos TypeScript del schema Supabase
│   └── middleware.ts                ← Next.js middleware para sesión Supabase
├── vitest.config.ts
├── vitest.setup.ts
└── .env.local.example
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `tableo-platform/` (todo el proyecto)

- [ ] **Step 1.1: Verificar que pnpm está instalado**

```bash
pnpm --version
```

Expected: `9.x.x`. Si falla: `npm install -g pnpm`

- [ ] **Step 1.2: Scaffold con Next.js 15**

Ejecutar dentro de `C:\Users\Rubén\Desktop\`:

```bash
pnpm create next-app@latest tableo-platform \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --no-turbopack
```

Cuando pregunte "Would you like to use Turbopack?": **No** (estabilidad sobre velocidad en dev).

Expected output final:
```
✔ Success! Created tableo-platform at ./tableo-platform
```

- [ ] **Step 1.3: Verificar estructura generada**

```bash
cd tableo-platform
ls src/app
```

Expected: `favicon.ico  globals.css  layout.tsx  page.tsx`

- [ ] **Step 1.4: Commit inicial**

```bash
git init
git add .
git commit -m "chore: scaffold Next.js 15 project with TypeScript + Tailwind + ESLint"
```

---

## Task 2: Instalar dependencias

**Files:**
- Modify: `package.json` (actualizado por pnpm)

- [ ] **Step 2.1: Instalar dependencias de producción**

```bash
pnpm add @supabase/supabase-js @supabase/ssr
pnpm add react-hook-form zod @hookform/resolvers
pnpm add date-fns @date-fns/tz
pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

- [ ] **Step 2.2: Instalar dependencias de desarrollo**

```bash
pnpm add -D vitest @vitejs/plugin-react jsdom
pnpm add -D @testing-library/react @testing-library/user-event @testing-library/jest-dom
pnpm add -D jest-axe @types/jest-axe
pnpm add -D eslint-plugin-jsx-a11y
```

- [ ] **Step 2.3: Inicializar shadcn/ui**

```bash
pnpm dlx shadcn@latest init
```

Respuestas:
- Style: **Default**
- Base color: **Slate**
- CSS variables: **Yes**

Expected: crea `components.json` y `src/components/ui/`

- [ ] **Step 2.4: Verificar que el proyecto compila**

```bash
pnpm build
```

Expected: exit code 0, sin errores TypeScript.

- [ ] **Step 2.5: Commit dependencias**

```bash
git add .
git commit -m "chore: install Supabase, dnd-kit, Vitest, shadcn/ui and dev dependencies"
```

---

## Task 3: Configurar Vitest

**Files:**
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Modify: `package.json` (añadir scripts de test)

- [ ] **Step 3.1: Crear `vitest.config.ts`**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    css: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

- [ ] **Step 3.2: Crear `vitest.setup.ts`**

```typescript
// vitest.setup.ts
import '@testing-library/jest-dom'
```

- [ ] **Step 3.3: Añadir scripts de test en `package.json`**

Abrir `package.json` y añadir dentro de `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:ui": "vitest --ui"
```

- [ ] **Step 3.4: Verificar que Vitest funciona**

```bash
pnpm test
```

Expected: `No test files found` (no hay tests aún). Exit code 0.

- [ ] **Step 3.5: Commit**

```bash
git add vitest.config.ts vitest.setup.ts package.json
git commit -m "chore: configure Vitest with jsdom and Testing Library"
```

---

## Task 4: Variables de entorno

**Files:**
- Create: `.env.local.example`
- Create: `.env.local` (no se commitea)

- [ ] **Step 4.1: Crear `.env.local.example`**

```bash
# .env.local.example
# Copiar este archivo a .env.local y rellenar los valores reales

# Supabase — obtenidos en https://supabase.com/dashboard/project/<tu-proyecto>/settings/api
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Solo para Server Actions y funciones de servidor
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

- [ ] **Step 4.2: Crear `.env.local` con valores reales**

Copiar `.env.local.example` a `.env.local` y rellenar con las keys del proyecto Supabase.

- [ ] **Step 4.3: Verificar que `.env.local` está en `.gitignore`**

Abrir `.gitignore`. Si no está, añadir:

```
.env.local
.env*.local
```

- [ ] **Step 4.4: Commit**

```bash
git add .env.local.example .gitignore
git commit -m "chore: add env vars template and ensure .env.local is gitignored"
```

---

## Task 5: Supabase Client Setup

**Files:**
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/__tests__/clients.test.ts`

- [ ] **Step 5.1: Escribir el test que debe fallar**

```typescript
// src/lib/supabase/__tests__/clients.test.ts
import { describe, it, expect, vi } from 'vitest'

// Mock de next/headers para entorno de test (no existe en jsdom)
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({
    getAll: () => [],
    set: vi.fn(),
  })),
}))

describe('createBrowserClient', () => {
  it('se crea sin lanzar error', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'

    const { createBrowserClient } = await import('../client')
    expect(() => createBrowserClient()).not.toThrow()
  })
})

describe('createServerClient', () => {
  it('se crea sin lanzar error', async () => {
    const { createServerClient } = await import('../server')
    expect(() => createServerClient()).not.toThrow()
  })
})
```

- [ ] **Step 5.2: Ejecutar el test para verificar que falla**

```bash
pnpm test src/lib/supabase/__tests__/clients.test.ts
```

Expected: FAIL — `Cannot find module '../client'`

- [ ] **Step 5.3: Crear `src/lib/supabase/client.ts`**

```typescript
// src/lib/supabase/client.ts
import { createBrowserClient as _createBrowserClient } from '@supabase/ssr'

export function createBrowserClient() {
  return _createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 5.4: Crear `src/lib/supabase/server.ts`**

```typescript
// src/lib/supabase/server.ts
import { createServerClient as _createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export function createServerClient() {
  const cookieStore = cookies()
  return _createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        },
      },
    }
  )
}
```

- [ ] **Step 5.5: Ejecutar los tests para verificar que pasan**

```bash
pnpm test src/lib/supabase/__tests__/clients.test.ts
```

Expected: `2 tests passed`

- [ ] **Step 5.6: Commit**

```bash
git add src/lib/supabase/
git commit -m "feat: add Supabase browser and server clients with tests"
```

---

## Task 6: Next.js Middleware para sesión Supabase

**Files:**
- Create: `src/middleware.ts`

- [ ] **Step 6.1: Crear `src/middleware.ts`**

```typescript
// src/middleware.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresca la sesión (no eliminar este await — es necesario para SSR)
  const { data: { user } } = await supabase.auth.getUser()

  // Rutas del dashboard requieren autenticación
  if (
    !user &&
    request.nextUrl.pathname.startsWith('/dashboard')
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

- [ ] **Step 6.2: Verificar que el build no da error de tipos**

```bash
pnpm build
```

Expected: exit code 0.

- [ ] **Step 6.3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat: add Next.js middleware for Supabase session refresh and auth guard"
```

---

## Task 7: Google OAuth Scopes

**Files:**
- Create: `src/lib/auth/google-scopes.ts`

- [ ] **Step 7.1: Crear `src/lib/auth/google-scopes.ts`**

```typescript
// src/lib/auth/google-scopes.ts
// Scopes requeridos en el OAuth de Google (ADR-008-B):
// - openid, email, profile: login básico
// - calendar: acceso al Google Calendar del dueño (necesario para confirmBooking en ADR-006)
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar',
] as const

export type GoogleScope = (typeof GOOGLE_SCOPES)[number]
```

- [ ] **Step 7.2: Verificar que TypeScript compila**

```bash
pnpm tsc --noEmit
```

Expected: sin errores.

- [ ] **Step 7.3: Commit**

```bash
git add src/lib/auth/
git commit -m "feat: add Google OAuth scopes constant (auth + calendar access)"
```

---

## Task 8: Tipos TypeScript del Schema

**Files:**
- Create: `src/lib/db/types.ts`

- [ ] **Step 8.1: Crear `src/lib/db/types.ts`**

```typescript
// src/lib/db/types.ts
// Tipos que reflejan el schema de Supabase (ADR-003)
// Nota: estos tipos se actualizarán cuando se use `supabase gen types` en Phase 2

export type SectorType = 'beauty' | 'restaurant' | 'real_estate'
export type ResourceType = 'staff' | 'table' | 'asset'
export type BookingStatus =
  | 'pending'
  | 'reserved'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no_show'

// ─── Branding config (ADR-007) ───────────────────────────────────────────────
export interface BusinessBranding {
  logo_url?: string
  accent_color?: string    // hex, ej. "#e91e8c"
  accent_dark?: string     // hex, ej. "#c2185b"
  cover_url?: string
}

export interface BusinessBookingConfig {
  min_advance_hours?: number   // default: 2
  max_advance_days?: number    // default: 30
  cancellation_hours?: number  // default: 24
  buffer_minutes?: number      // default: 0
}

export interface BusinessConfig {
  branding?: BusinessBranding
  booking?: BusinessBookingConfig
}

// ─── Tabla: businesses ───────────────────────────────────────────────────────
export interface Business {
  id: string
  name: string
  slug: string
  sector_type: SectorType
  timezone_id: string        // ej. "Europe/Madrid", "Atlantic/Canary"
  config: BusinessConfig
  owner_id: string
  created_at: string
}

// ─── Tabla: resources ────────────────────────────────────────────────────────
export interface BeautyResourceMetadata {
  specialties?: string[]
  duration_default?: number   // minutos
}

export interface RestaurantResourceMetadata {
  capacity?: number
  zone?: string
}

export type ResourceMetadata =
  | BeautyResourceMetadata
  | RestaurantResourceMetadata
  | Record<string, unknown>

export interface Resource {
  id: string
  business_id: string
  resource_type: ResourceType
  name: string
  active: boolean
  metadata: ResourceMetadata
  created_at: string
}

// ─── Tabla: bookings ─────────────────────────────────────────────────────────
export interface BeautyBookingMetadata {
  service?: string
  price_eur?: number
  notes?: string
}

export interface RestaurantBookingMetadata {
  party_size?: number
  occasion?: string
  menu?: string
}

export type BookingMetadata =
  | BeautyBookingMetadata
  | RestaurantBookingMetadata
  | Record<string, unknown>

export interface Booking {
  id: string
  resource_id: string
  customer_id: string
  start_at: string             // ISO 8601 UTC
  end_at: string               // ISO 8601 UTC
  status: BookingStatus
  metadata: BookingMetadata
  reserved_until: string | null
  session_id: string | null
  created_at: string
}

// ─── Tabla: customers ────────────────────────────────────────────────────────
export interface Customer {
  id: string
  business_id: string
  name: string
  phone: string | null
  email: string | null
  notes: string | null
  metadata: Record<string, unknown>
  created_at: string
}

// ─── Tabla: availability_windows ─────────────────────────────────────────────
export interface AvailabilityWindow {
  id: string
  resource_id: string
  day_of_week: 0 | 1 | 2 | 3 | 4 | 5 | 6   // 0=Lunes
  open_time: string    // HH:MM:SS
  close_time: string   // HH:MM:SS
}

// ─── Tabla: blocking_rules ────────────────────────────────────────────────────
export interface BlockingRule {
  id: string
  resource_id: string
  start_at: string     // ISO 8601 UTC
  end_at: string       // ISO 8601 UTC
  reason: string | null
}
```

- [ ] **Step 8.2: Verificar que TypeScript compila sin errores**

```bash
pnpm tsc --noEmit
```

Expected: sin errores.

- [ ] **Step 8.3: Commit**

```bash
git add src/lib/db/
git commit -m "feat: add TypeScript DB types for all tables (ADR-003, ADR-007)"
```

---

## Task 9: Migraciones Supabase — Schema

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`

- [ ] **Step 9.1: Crear directorio de migraciones**

```bash
mkdir -p supabase/migrations
```

- [ ] **Step 9.2: Crear `supabase/migrations/001_initial_schema.sql`**

```sql
-- supabase/migrations/001_initial_schema.sql
-- ADR-003: Schema unificado sector-agnostic

-- BUSINESSES
CREATE TABLE businesses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,
  sector_type text NOT NULL
    CHECK (sector_type IN ('beauty', 'restaurant', 'real_estate')),
  timezone_id text NOT NULL DEFAULT 'Europe/Madrid',
  config      jsonb NOT NULL DEFAULT '{}',
  owner_id    uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now()
);

-- RESOURCES
CREATE TABLE resources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES businesses ON DELETE CASCADE,
  resource_type text NOT NULL
    CHECK (resource_type IN ('staff', 'table', 'asset')),
  name          text NOT NULL,
  active        boolean DEFAULT true,
  metadata      jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz DEFAULT now()
);

-- AVAILABILITY WINDOWS
CREATE TABLE availability_windows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL REFERENCES resources ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time   time NOT NULL,
  close_time  time NOT NULL,
  CONSTRAINT valid_window CHECK (open_time < close_time)
);

-- BLOCKING RULES
CREATE TABLE blocking_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL REFERENCES resources ON DELETE CASCADE,
  start_at    timestamptz NOT NULL,
  end_at      timestamptz NOT NULL,
  reason      text,
  CONSTRAINT valid_block CHECK (start_at < end_at)
);

-- CUSTOMERS
CREATE TABLE customers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses ON DELETE CASCADE,
  name        text NOT NULL,
  phone       text,
  email       text,
  notes       text,
  metadata    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz DEFAULT now(),
  UNIQUE (business_id, phone)
);

-- BOOKINGS (depende de customers — va al final)
CREATE TABLE bookings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id    uuid NOT NULL REFERENCES resources,
  customer_id    uuid NOT NULL REFERENCES customers,
  start_at       timestamptz NOT NULL,
  end_at         timestamptz NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reserved', 'confirmed', 'cancelled', 'completed', 'no_show')),
  metadata       jsonb NOT NULL DEFAULT '{}',
  reserved_until timestamptz,
  session_id     text,
  created_at     timestamptz DEFAULT now()
);

-- ÍNDICES CRÍTICOS (ADR-003)
CREATE INDEX idx_bookings_resource_time
  ON bookings (resource_id, start_at, end_at)
  WHERE status NOT IN ('cancelled');

CREATE INDEX idx_bookings_status_reserved
  ON bookings (reserved_until)
  WHERE status = 'reserved';

CREATE INDEX idx_availability_resource
  ON availability_windows (resource_id, day_of_week);

CREATE INDEX idx_blocking_resource_time
  ON blocking_rules (resource_id, start_at, end_at);

CREATE INDEX idx_businesses_owner
  ON businesses (owner_id);

CREATE INDEX idx_resources_business
  ON resources (business_id)
  WHERE active = true;
```

- [ ] **Step 9.3: Aplicar la migración en Supabase**

En el Supabase Dashboard → SQL Editor, ejecutar el contenido de `001_initial_schema.sql`.

Verificar: las 6 tablas aparecen en Table Editor.

- [ ] **Step 9.4: Commit**

```bash
git add supabase/
git commit -m "feat: add initial DB schema migration (6 tables, critical indexes)"
```

---

## Task 10: Migraciones Supabase — RLS

**Files:**
- Create: `supabase/migrations/002_rls_policies.sql`

- [ ] **Step 10.1: Crear `supabase/migrations/002_rls_policies.sql`**

```sql
-- supabase/migrations/002_rls_policies.sql
-- ADR-005: Row Level Security — aislamiento multi-tenant

-- ACTIVAR RLS EN TODAS LAS TABLAS
ALTER TABLE businesses         ENABLE ROW LEVEL SECURITY;
ALTER TABLE resources          ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocking_rules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers          ENABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════
-- POLÍTICAS: DASHBOARD (autenticado con auth.uid())
-- ══════════════════════════════════════════════════

CREATE POLICY "owners_manage_own_business"
ON businesses
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

CREATE POLICY "owners_manage_own_resources"
ON resources
USING (
  business_id IN (
    SELECT id FROM businesses WHERE owner_id = auth.uid()
  )
);

CREATE POLICY "owners_see_own_bookings"
ON bookings
USING (
  resource_id IN (
    SELECT r.id FROM resources r
    JOIN businesses b ON r.business_id = b.id
    WHERE b.owner_id = auth.uid()
  )
);

CREATE POLICY "owners_see_own_customers"
ON customers
USING (
  business_id IN (
    SELECT id FROM businesses WHERE owner_id = auth.uid()
  )
);

CREATE POLICY "owners_manage_own_windows"
ON availability_windows
USING (
  resource_id IN (
    SELECT r.id FROM resources r
    JOIN businesses b ON r.business_id = b.id
    WHERE b.owner_id = auth.uid()
  )
);

CREATE POLICY "owners_manage_own_blocks"
ON blocking_rules
USING (
  resource_id IN (
    SELECT r.id FROM resources r
    JOIN businesses b ON r.business_id = b.id
    WHERE b.owner_id = auth.uid()
  )
);

-- ══════════════════════════════════════════════════
-- POLÍTICAS: PÁGINA PÚBLICA (anónimo)
-- ══════════════════════════════════════════════════

CREATE POLICY "public_read_active_businesses"
ON businesses FOR SELECT
USING (true);

CREATE POLICY "public_read_active_resources"
ON resources FOR SELECT
USING (active = true);

CREATE POLICY "public_read_available_slots"
ON bookings FOR SELECT
USING (status IN ('available', 'reserved'));

CREATE POLICY "public_create_booking"
ON bookings FOR INSERT
WITH CHECK (status = 'pending');

CREATE POLICY "public_update_own_reservation"
ON bookings FOR UPDATE
USING (session_id = current_setting('app.session_id', true));
```

- [ ] **Step 10.2: Aplicar en Supabase SQL Editor**

Ejecutar `002_rls_policies.sql` en Supabase Dashboard → SQL Editor.

- [ ] **Step 10.3: Verificar aislamiento (test manual)**

En Supabase → Table Editor → `businesses`:
- Conectado como usuario A: solo ve sus negocios
- Sin autenticación (anon): ve todos los negocios (política pública intencional)

- [ ] **Step 10.4: Commit**

```bash
git add supabase/migrations/002_rls_policies.sql
git commit -m "feat: add RLS policies for dashboard (owner) and public booking page"
```

---

## Task 11: Migraciones Supabase — Funciones PostgreSQL

**Files:**
- Create: `supabase/migrations/003_functions.sql`

- [ ] **Step 11.1: Crear `supabase/migrations/003_functions.sql`**

```sql
-- supabase/migrations/003_functions.sql
-- ADR-004: Two-Phase Booking — funciones que encapsulan la lógica de locks

-- ─── reserve_slot ─────────────────────────────────────────────────────────────
-- Fase 1 del two-phase booking.
-- Adquiere SELECT FOR UPDATE NOWAIT en el slot y lo marca como 'reserved' con TTL.
-- Retorna success: true + reserved_until si logra el lock.
-- Retorna success: false si hay lock concurrente (código PG 55P03) o slot no disponible.
CREATE OR REPLACE FUNCTION reserve_slot(
  p_slot_id    uuid,
  p_session_id text,
  p_ttl_minutes int DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_booking bookings;
BEGIN
  SELECT * INTO v_booking
  FROM bookings
  WHERE id = p_slot_id
    AND status = 'available'
  FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_available');
  END IF;

  UPDATE bookings SET
    status         = 'reserved',
    reserved_until = NOW() + (p_ttl_minutes || ' minutes')::interval,
    session_id     = p_session_id
  WHERE id = p_slot_id;

  RETURN jsonb_build_object(
    'success',        true,
    'id',             p_slot_id,
    'reserved_until', NOW() + (p_ttl_minutes || ' minutes')::interval
  );

EXCEPTION
  WHEN lock_not_available THEN
    RETURN jsonb_build_object('success', false, 'reason', 'concurrent_lock');
END;
$$;

-- ─── confirm_booking ──────────────────────────────────────────────────────────
-- Fase 2 del two-phase booking.
-- Confirma la reserva si el session_id coincide y el TTL no ha expirado.
CREATE OR REPLACE FUNCTION confirm_booking(
  p_session_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_booking_id uuid;
BEGIN
  UPDATE bookings
  SET
    status         = 'confirmed',
    session_id     = NULL,
    reserved_until = NULL
  WHERE session_id     = p_session_id
    AND status         = 'reserved'
    AND reserved_until > NOW()
  RETURNING id INTO v_booking_id;

  IF v_booking_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'expired_or_not_found');
  END IF;

  RETURN jsonb_build_object('success', true, 'booking_id', v_booking_id);
END;
$$;

-- ─── release_slot ─────────────────────────────────────────────────────────────
-- Libera un slot reservado antes de que expire el TTL.
-- Llamado cuando el usuario cancela o el countdown llega a 0 (ADR-007).
CREATE OR REPLACE FUNCTION release_slot(
  p_session_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rows_affected int;
BEGIN
  UPDATE bookings
  SET
    status         = 'available',
    session_id     = NULL,
    reserved_until = NULL
  WHERE session_id = p_session_id
    AND status     = 'reserved';

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'released', v_rows_affected);
END;
$$;
```

- [ ] **Step 11.2: Aplicar en Supabase SQL Editor**

Ejecutar `003_functions.sql`.

Expected: `Success. No rows returned.`

- [ ] **Step 11.3: Verificar que las funciones existen**

```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_type = 'FUNCTION';
```

Expected: `reserve_slot`, `confirm_booking`, `release_slot` en los resultados.

- [ ] **Step 11.4: Commit**

```bash
git add supabase/migrations/003_functions.sql
git commit -m "feat: add reserve_slot, confirm_booking, release_slot PostgreSQL functions"
```

---

## Task 12: Migración pg_cron — Limpieza automática

**Files:**
- Create: `supabase/migrations/004_pg_cron.sql`

- [ ] **Step 12.1: Crear `supabase/migrations/004_pg_cron.sql`**

```sql
-- supabase/migrations/004_pg_cron.sql
-- ADR-004: limpieza automática de reservas temporales expiradas
-- pg_cron está preinstalado en Supabase Pro

-- Ejecuta cada minuto: libera slots 'reserved' cuyo TTL ha expirado
SELECT cron.schedule(
  'cleanup-expired-reservations',
  '* * * * *',
  $$
    UPDATE bookings
    SET
      status         = 'available',
      session_id     = NULL,
      reserved_until = NULL
    WHERE status         = 'reserved'
      AND reserved_until < NOW()
  $$
);
```

- [ ] **Step 12.2: Verificar que pg_cron está disponible en Supabase**

En SQL Editor:
```sql
SELECT * FROM cron.job;
```

Si da error "relation cron.job does not exist": activar la extensión `pg_cron` en Supabase → Extensions.

- [ ] **Step 12.3: Aplicar la migración**

Ejecutar `004_pg_cron.sql` en SQL Editor.

Expected: confirmar con:
```sql
SELECT jobname, schedule, command FROM cron.job;
```

Debe aparecer `cleanup-expired-reservations` con schedule `* * * * *`.

- [ ] **Step 12.4: Commit**

```bash
git add supabase/migrations/004_pg_cron.sql
git commit -m "feat: schedule pg_cron job for expired reservation cleanup (every minute)"
```

---

## Task 13: Seed Data de Desarrollo

**Files:**
- Create: `supabase/seed.sql`

- [ ] **Step 13.1: Crear `supabase/seed.sql`**

```sql
-- supabase/seed.sql
-- Datos de ejemplo para desarrollo local: un salón de belleza con 3 profesionales

-- Nota: insertar primero en auth.users es necesario para satisfacer FK businesses.owner_id
-- En Supabase local, crear el usuario de prueba desde el Dashboard o via API primero,
-- luego substituir el UUID real aquí.
-- Para entorno local con supabase cli: este seed se ejecuta con `supabase db seed`

DO $$
DECLARE
  v_owner_id   uuid := gen_random_uuid();   -- substituir por UUID real del usuario de prueba
  v_business_id uuid;
  v_laura_id   uuid;
  v_maria_id   uuid;
  v_carlos_id  uuid;
BEGIN

-- Negocio de prueba
INSERT INTO businesses (id, name, slug, sector_type, timezone_id, config, owner_id)
VALUES (
  gen_random_uuid(),
  'Salon Luna',
  'salon-luna',
  'beauty',
  'Europe/Madrid',
  '{
    "branding": {
      "accent_color": "#e91e8c",
      "accent_dark": "#c2185b"
    },
    "booking": {
      "min_advance_hours": 2,
      "max_advance_days": 30,
      "cancellation_hours": 24,
      "buffer_minutes": 0
    }
  }'::jsonb,
  v_owner_id
)
RETURNING id INTO v_business_id;

-- Profesional 1: Laura
INSERT INTO resources (id, business_id, resource_type, name, active, metadata)
VALUES (
  gen_random_uuid(),
  v_business_id,
  'staff',
  'Laura García',
  true,
  '{"specialties": ["corte", "color", "mechas"], "duration_default": 60}'::jsonb
)
RETURNING id INTO v_laura_id;

-- Profesional 2: María
INSERT INTO resources (id, business_id, resource_type, name, active, metadata)
VALUES (
  gen_random_uuid(),
  v_business_id,
  'staff',
  'María López',
  true,
  '{"specialties": ["manicura", "pedicura", "uñas"], "duration_default": 45}'::jsonb
)
RETURNING id INTO v_maria_id;

-- Profesional 3: Carlos
INSERT INTO resources (id, business_id, resource_type, name, active, metadata)
VALUES (
  gen_random_uuid(),
  v_business_id,
  'staff',
  'Carlos Ruiz',
  true,
  '{"specialties": ["barbería", "corte caballero"], "duration_default": 30}'::jsonb
)
RETURNING id INTO v_carlos_id;

-- Horarios de Laura (Lun–Vie 9:00–19:00, Sáb 9:00–14:00)
INSERT INTO availability_windows (resource_id, day_of_week, open_time, close_time)
VALUES
  (v_laura_id, 0, '09:00', '19:00'),
  (v_laura_id, 1, '09:00', '19:00'),
  (v_laura_id, 2, '09:00', '19:00'),
  (v_laura_id, 3, '09:00', '19:00'),
  (v_laura_id, 4, '09:00', '19:00'),
  (v_laura_id, 5, '09:00', '14:00');

-- Horarios de María (Mar–Sáb 10:00–20:00)
INSERT INTO availability_windows (resource_id, day_of_week, open_time, close_time)
VALUES
  (v_maria_id, 1, '10:00', '20:00'),
  (v_maria_id, 2, '10:00', '20:00'),
  (v_maria_id, 3, '10:00', '20:00'),
  (v_maria_id, 4, '10:00', '20:00'),
  (v_maria_id, 5, '10:00', '20:00');

-- Horarios de Carlos (Lun–Sáb 08:00–18:00)
INSERT INTO availability_windows (resource_id, day_of_week, open_time, close_time)
VALUES
  (v_carlos_id, 0, '08:00', '18:00'),
  (v_carlos_id, 1, '08:00', '18:00'),
  (v_carlos_id, 2, '08:00', '18:00'),
  (v_carlos_id, 3, '08:00', '18:00'),
  (v_carlos_id, 4, '08:00', '18:00'),
  (v_carlos_id, 5, '08:00', '18:00');

END $$;
```

- [ ] **Step 13.2: Aplicar el seed en Supabase**

En Supabase SQL Editor ejecutar `seed.sql`.

Expected: las tablas `businesses`, `resources`, `availability_windows` tienen datos.

- [ ] **Step 13.3: Commit**

```bash
git add supabase/seed.sql
git commit -m "feat: add seed data — Salon Luna with 3 staff and availability windows"
```

---

## Task 14: Route Group Layouts

**Files:**
- Create: `src/app/(dashboard)/layout.tsx`
- Create: `src/app/(booking)/[slug]/layout.tsx`
- Create: `src/app/api/webhooks/google-calendar/route.ts`

- [ ] **Step 14.1: Crear el layout del dashboard**

```typescript
// src/app/(dashboard)/layout.tsx
import { createServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return <>{children}</>
}
```

- [ ] **Step 14.2: Crear el layout de la página pública de reserva**

```typescript
// src/app/(booking)/[slug]/layout.tsx
import { createServerClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type { Business } from '@/lib/db/types'

export default async function BookingLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { slug: string }
}) {
  const supabase = createServerClient()

  const { data: business } = await supabase
    .from('businesses')
    .select('id, name, config')
    .eq('slug', params.slug)
    .single<Pick<Business, 'id' | 'name' | 'config'>>()

  if (!business) notFound()

  const branding = business.config?.branding ?? {}

  return (
    <div
      style={{
        '--color-accent': branding.accent_color ?? '#7c6dff',
        '--color-accent-dark': branding.accent_dark ?? '#5a4fe0',
      } as React.CSSProperties}
    >
      {children}
    </div>
  )
}
```

- [ ] **Step 14.3: Crear stub del webhook de Google Calendar**

```typescript
// src/app/api/webhooks/google-calendar/route.ts
import { NextResponse } from 'next/server'

// Stub — implementado en Phase 5 (Google Calendar sync)
export async function POST() {
  return NextResponse.json({ received: true })
}
```

- [ ] **Step 14.4: Verificar que el build pasa**

```bash
pnpm build
```

Expected: exit code 0. Sin errores de tipos ni de módulos.

- [ ] **Step 14.5: Commit final de Phase 1**

```bash
git add src/app/
git commit -m "feat: add dashboard layout (auth guard), booking layout (branding CSS vars), Google Calendar webhook stub"
```

---

## Task 15: Configurar Google OAuth en Supabase + eslint-plugin-jsx-a11y

**Files:**
- Modify: `.eslintrc.json`

- [ ] **Step 15.1: Configurar proveedor Google en Supabase Auth**

En Supabase Dashboard → Authentication → Providers → Google:
1. Activar "Enable Google provider"
2. Pegar Client ID y Client Secret de Google Cloud Console
3. En "Authorized redirect URI" usar: `https://<tu-proyecto>.supabase.co/auth/v1/callback`
4. En Google Cloud Console → APIs → Credentials → OAuth scopes añadir: `https://www.googleapis.com/auth/calendar`
5. Guardar

Verificación: en Supabase Auth → URL Configuration, la URL de callback está configurada.

- [ ] **Step 15.2: Activar eslint-plugin-jsx-a11y**

Abrir `.eslintrc.json` y actualizarlo para incluir el plugin de accesibilidad:

```json
{
  "extends": [
    "next/core-web-vitals",
    "next/typescript",
    "plugin:jsx-a11y/recommended"
  ],
  "plugins": ["jsx-a11y"],
  "rules": {
    "jsx-a11y/no-autofocus": "warn"
  }
}
```

- [ ] **Step 15.3: Verificar que el linter no da errores en el proyecto actual**

```bash
pnpm lint
```

Expected: `✔ No ESLint warnings or errors`. Si hay warnings de a11y en `src/app/page.tsx` (página de ejemplo de Next.js), reemplazarla con:

```typescript
// src/app/page.tsx
export default function Home() {
  return (
    <main>
      <h1>Tableo</h1>
    </main>
  )
}
```

- [ ] **Step 15.4: Commit**

```bash
git add .eslintrc.json src/app/page.tsx
git commit -m "chore: configure eslint-plugin-jsx-a11y and clean up default page"
```

---

## Self-Review

### Spec coverage — ADRs verificados

| ADR | Requisito clave | Cubierto en |
|-----|----------------|-------------|
| ADR-001 | Next.js App Router, src-dir, import alias | Task 1 |
| ADR-003 | 6 tablas + timezone_id + metadata jsonb + índices | Task 9 |
| ADR-003 | pg_cron limpieza expirados | Task 12 |
| ADR-004 | reserve_slot(), confirm_booking(), release_slot() | Task 11 |
| ADR-005 | RLS activado en todas las tablas + políticas | Task 10 |
| ADR-005 | current_setting('app.session_id') en política pública | Task 10 |
| ADR-006 | timezone_id en businesses (con DEFAULT 'Europe/Madrid') | Task 9 |
| ADR-007 | BusinessConfig TypeScript con branding + booking | Task 8 |
| ADR-007 | --color-accent + --color-accent-dark inyectados en BookingLayout | Task 14 |
| ADR-008 | pnpm + Next.js 15 + TypeScript + Tailwind + shadcn | Tasks 1-2 |
| ADR-008 | Vitest + Testing Library + jest-axe | Tasks 2-3 |
| ADR-008 | Server Actions arquitectura (layout no llama API routes) | Tasks 5, 14 |
| ADR-008 | Google OAuth scopes constante | Task 7 |
| ADR-008 | Google OAuth configurado en Supabase Auth + Google Cloud | Task 15 |
| ADR-007 | eslint-plugin-jsx-a11y activado como gate de linting | Task 15 |
| ADR-008 | API Routes solo para webhooks | Task 14 |
| ADR-008 | Supabase client.ts + server.ts + middleware.ts | Tasks 5-6 |

### Gaps identificados (cubiertos en fases siguientes)

- `AvailabilityAdapter` interface + `BeautyAdapter` → **Phase 2**
- `SlotPicker`, `BookingCountdown`, `SlotExpiredBanner` → **Phase 3**
- `CalendarDesktop`, `CalendarMobile`, dnd-kit → **Phase 4**
- Google OAuth flow (`/login` page, Supabase Auth UI) → **Phase 2**
- Google Calendar sync en `confirmBooking()` → **Phase 5**
- `jest-axe` tests en componentes → **Phase 3**

### Placeholder scan

Ningún paso dice "TBD" o "implement later". El webhook de Google Calendar es un stub intencionado documentado como tal.

### Type consistency

- `Business.config` es `BusinessConfig` en types.ts y el BookingLayout lo consume como `business.config?.branding` ✓
- `reserve_slot` retorna `reserved_until` como timestamp, `LockResult.reservedUntil` será `Date` en Phase 2 tras parsear ✓
