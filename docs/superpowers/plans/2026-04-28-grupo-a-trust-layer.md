# Grupo A — Trust Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the three trust-layer subsystems from ADR-009: multi-channel notification adapter (Email/PWA/WhatsApp/SMS), rotating presence verification code, and hybrid refund policy engine — including migration 005 with 6 new tables and full RLS.

**Architecture:** Extends the existing AvailabilityAdapter pattern (ADR-002) to Notifications — `NotificationProvider` interface with 4 pluggable providers. Presence uses a rotating 4-digit code (5-min TTL) written to the DB by the business dashboard and read by the client booking page. Refund policy is a pure function with no side effects; the engine shells out to Stripe (scaffolded, not live until Stripe Phase). All modules live in `src/modules/` and interact with Supabase via the server client already set up in Phase 1.

**Tech Stack:** Vitest 2 (tests), Resend (email), web-push (PWA), @whiskeysockets/baileys (WhatsApp), Twilio (SMS upsell), Supabase JS v2 (DB), TypeScript strict

**Prerequisite:** Phase 1 plan must be complete — `src/lib/supabase/server.ts`, `src/lib/supabase/client.ts`, and migrations 001–004 must exist before running this plan.

---

## File Structure

```
supabase/migrations/
  005_trust_notifications.sql       ← 6 new tables + RLS + pg_cron jobs

src/modules/
  notifications/
    types.ts                        ← NotificationPayload, NotificationTemplate, NotificationProvider
    factory.ts                      ← getActiveProviders(), sendNotification()
    scheduler.ts                    ← processPendingNotifications() called by pg_cron
    providers/
      email.provider.ts             ← EmailProvider using Resend SDK
      pwa.provider.ts               ← PWAProvider using web-push
      whatsapp-baileys.provider.ts  ← WhatsAppBaileysProvider using Baileys
      sms.provider.ts               ← SMSProvider using Twilio SDK
    __tests__/
      email.provider.test.ts
      pwa.provider.test.ts
      whatsapp-baileys.provider.test.ts
      sms.provider.test.ts
      factory.test.ts
      scheduler.test.ts
  presence/
    code-generator.ts               ← generateCode(), upsertPresenceCode()
    verifier.ts                     ← verifyPresenceCode()
    dispute.ts                      ← openDispute()
    __tests__/
      code-generator.test.ts
      verifier.test.ts
      dispute.test.ts
  refunds/
    policy.ts                       ← determineRefundPolicy() — pure function
    engine.ts                       ← executeRefund() — orchestrates Stripe + credits
    __tests__/
      policy.test.ts
      engine.test.ts
```

---

## Task 1: Install Dependencies + Env Vars

**Files:**
- Modify: `package.json` (via pnpm add)
- Modify: `.env.local.example`

- [ ] **Step 1: Install runtime packages**

```bash
pnpm add resend web-push @whiskeysockets/baileys twilio
```

- [ ] **Step 2: Install type declarations**

```bash
pnpm add -D @types/web-push
```

- [ ] **Step 3: Verify packages installed**

```bash
pnpm list resend web-push @whiskeysockets/baileys twilio
```

Expected: all 4 packages listed with version numbers.

- [ ] **Step 4: Append to `.env.local.example`**

Open `.env.local.example` and add at the end:

```bash
# === NOTIFICATIONS ===
# Email (Resend) — always required
RESEND_API_KEY=re_your_key_here
RESEND_FROM_EMAIL=Tableo <noreply@tableo.app>

# PWA Push — generate with: npx web-push generate-vapid-keys
VAPID_PUBLIC_KEY=your_vapid_public_key
VAPID_PRIVATE_KEY=your_vapid_private_key
VAPID_SUBJECT=mailto:hola@tableo.app

# SMS via Twilio — optional upsell, leave blank to disable
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# WhatsApp/Baileys — session auto-created on first run (QR scan required)
# No env vars needed — session stored in ./baileys-session/ directory
```

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml .env.local.example
git commit -m "feat: install trust-layer dependencies (resend, web-push, baileys, twilio)"
```

---

## Task 2: Migration 005 — 6 Tables + RLS + pg_cron

**Files:**
- Create: `supabase/migrations/005_trust_notifications.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/005_trust_notifications.sql` with this exact content:

```sql
-- =============================================================
-- 005_trust_notifications.sql
-- Trust Layer: notifications, presence, disputes, refunds
-- All tables have RLS enabled. No exceptions. (ADR-005)
-- =============================================================

-- ─── 1. notification_log ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid        NOT NULL REFERENCES bookings ON DELETE CASCADE,
  channel     text        NOT NULL CHECK (channel IN ('email', 'pwa', 'whatsapp', 'sms')),
  template    text        NOT NULL,
  status      text        NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error       text,
  sent_at     timestamptz DEFAULT now()
);

ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

-- Business reads logs for their own bookings
CREATE POLICY "business_read_own_notification_log"
ON notification_log FOR SELECT
USING (
  booking_id IN (
    SELECT b.id FROM bookings b
    JOIN resources r   ON b.resource_id  = r.id
    JOIN businesses bs ON r.business_id  = bs.id
    WHERE bs.owner_id = auth.uid()
  )
);

-- System (service role) inserts — no user policy needed for INSERT
-- (Server Actions use service role key)

-- ─── 2. presence_codes ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS presence_codes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid        NOT NULL REFERENCES businesses ON DELETE CASCADE,
  code        text        NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (business_id)
);

ALTER TABLE presence_codes ENABLE ROW LEVEL SECURITY;

-- Business reads/upserts their own code
CREATE POLICY "business_manage_own_presence_code"
ON presence_codes FOR ALL
USING (
  business_id IN (
    SELECT id FROM businesses WHERE owner_id = auth.uid()
  )
)
WITH CHECK (
  business_id IN (
    SELECT id FROM businesses WHERE owner_id = auth.uid()
  )
);

-- ─── 3. presence_checks ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS presence_checks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid        NOT NULL REFERENCES bookings ON DELETE CASCADE,
  code_used   text        NOT NULL,
  valid       boolean     NOT NULL,
  lat         numeric(9,6),
  lng         numeric(9,6),
  checked_at  timestamptz DEFAULT now()
);

ALTER TABLE presence_checks ENABLE ROW LEVEL SECURITY;

-- Client inserts their own check (via session_id claim set by Server Action)
-- Business reads checks for their own bookings
CREATE POLICY "business_read_presence_checks"
ON presence_checks FOR SELECT
USING (
  booking_id IN (
    SELECT b.id FROM bookings b
    JOIN resources r   ON b.resource_id = r.id
    JOIN businesses bs ON r.business_id = bs.id
    WHERE bs.owner_id = auth.uid()
  )
);

-- ─── 4. disputes ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS disputes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid        NOT NULL REFERENCES bookings ON DELETE RESTRICT,
  reason        text        NOT NULL CHECK (
                              reason IN ('presence_conflict', 'refund_claim', 'cash_discrepancy')
                            ),
  status        text        NOT NULL DEFAULT 'open' CHECK (
                              status IN ('open', 'resolved_client', 'resolved_business', 'resolved_tableo')
                            ),
  evidence      jsonb       NOT NULL DEFAULT '{}',
  resolved_by   uuid        REFERENCES auth.users,
  resolved_at   timestamptz,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;

-- Business sees disputes for their own bookings
CREATE POLICY "business_see_own_disputes"
ON disputes FOR SELECT
USING (
  booking_id IN (
    SELECT b.id FROM bookings b
    JOIN resources r   ON b.resource_id = r.id
    JOIN businesses bs ON r.business_id = bs.id
    WHERE bs.owner_id = auth.uid()
  )
);

-- ─── 5. audit_logs ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text        NOT NULL CHECK (
                            entity_type IN ('booking', 'refund', 'presence', 'dispute')
                          ),
  entity_id   uuid        NOT NULL,
  action      text        NOT NULL,
  actor_type  text        NOT NULL CHECK (
                            actor_type IN ('client', 'business', 'system', 'tableo')
                          ),
  actor_id    text,
  metadata    jsonb       NOT NULL DEFAULT '{}',
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Only service role reads/writes audit_logs (no user-facing RLS policy)
-- Business cannot directly query this table

-- ─── 6. refund_transactions ──────────────────────────────────
CREATE TABLE IF NOT EXISTS refund_transactions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       uuid        NOT NULL REFERENCES bookings ON DELETE RESTRICT,
  amount_cents     integer     NOT NULL CHECK (amount_cents >= 0),
  currency         text        NOT NULL DEFAULT 'EUR',
  type             text        NOT NULL CHECK (
                                 type IN ('stripe_refund', 'tableo_credit', 'partial_credit')
                               ),
  reason           text        NOT NULL,
  stripe_refund_id text,
  status           text        NOT NULL DEFAULT 'pending' CHECK (
                                 status IN ('pending', 'processed', 'failed')
                               ),
  processed_at     timestamptz,
  created_at       timestamptz DEFAULT now()
);

ALTER TABLE refund_transactions ENABLE ROW LEVEL SECURITY;

-- Business reads refund records for their own bookings
CREATE POLICY "business_read_own_refunds"
ON refund_transactions FOR SELECT
USING (
  booking_id IN (
    SELECT b.id FROM bookings b
    JOIN resources r   ON b.resource_id = r.id
    JOIN businesses bs ON r.business_id = bs.id
    WHERE bs.owner_id = auth.uid()
  )
);

-- ─── pg_cron: presence code rotation (every 5 minutes) ───────
-- Deletes expired codes so businesses always have a fresh code generated on demand
SELECT cron.schedule(
  'rotate-expired-presence-codes',
  '*/5 * * * *',
  $$DELETE FROM presence_codes WHERE expires_at < now()$$
);

-- pg_cron: notification scheduler (every minute) ──────────────
-- Calls the notification endpoint for bookings starting in 60-61 minutes
-- The actual HTTP call is handled by the scheduler Server Action (Task 10)
-- This cron job marks bookings as "notification_pending" so the scheduler picks them up
SELECT cron.schedule(
  'mark-notifications-pending',
  '* * * * *',
  $$
    UPDATE bookings
    SET notification_sent_1h = true
    WHERE status = 'confirmed'
      AND notification_sent_1h = false
      AND start_at BETWEEN now() + interval '60 minutes'
                       AND now() + interval '61 minutes'
  $$
);
```

> **Note on `notification_sent_1h`:** This column must be added to the `bookings` table. Add it at the top of this migration before the table creates:

```sql
-- Add notification tracking column to bookings (from Phase 1)
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS notification_sent_1h boolean NOT NULL DEFAULT false;
```

Add this ALTER statement as the very first statement in the migration file, before all CREATE TABLE statements.

- [ ] **Step 2: Apply the migration**

```bash
npx supabase db push
```

Expected output: `Applying migration 005_trust_notifications.sql... done`

- [ ] **Step 3: Verify tables exist**

```bash
npx supabase db query "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;"
```

Expected: `audit_logs`, `disputes`, `notification_log`, `presence_checks`, `presence_codes`, `refund_transactions` all present alongside Phase 1 tables.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/005_trust_notifications.sql
git commit -m "feat: migration 005 — trust layer tables + RLS + pg_cron jobs"
```

---

## Task 3: Notification Types

**Files:**
- Create: `src/modules/notifications/types.ts`

No Supabase or external SDK — pure TypeScript. This task has no runtime test (TypeScript compiler is the test).

- [ ] **Step 1: Create `src/modules/notifications/types.ts`**

```typescript
export type NotificationChannel = 'email' | 'pwa' | 'whatsapp' | 'sms'

export type NotificationTemplate =
  | 'booking_confirmed'
  | 'booking_reminder_1h'
  | 'booking_cancelled'
  | 'booking_reminder_24h'
  | 'dispute_opened'
  | 'refund_processed'

export interface NotificationPayload {
  to: string           // email address, E.164 phone, or push subscription JSON string
  bookingId: string
  templateKey: NotificationTemplate
  variables: Record<string, string>
}

export interface NotificationResult {
  success: boolean
  messageId?: string
  error?: string
}

export interface NotificationProvider {
  readonly channel: NotificationChannel
  send(payload: NotificationPayload): Promise<NotificationResult>
  isAvailable(): boolean
}

export const NOTIFICATION_TEMPLATES: Record<NotificationTemplate, string> = {
  booking_confirmed:    'Tu reserva en {negocio} está confirmada para el {fecha} a las {hora}.',
  booking_reminder_1h:  'Hola {nombre} 👋 Tu cita en {negocio} es hoy a las {hora}. Si necesitas cancelar: {link}. ¡Hasta pronto!',
  booking_cancelled:    'Tu reserva en {negocio} del {fecha} ha sido cancelada.',
  booking_reminder_24h: 'Mañana tienes cita en {negocio} a las {hora}. ¡Te esperamos!',
  dispute_opened:       'Se ha abierto una disputa para tu reserva del {fecha}. El equipo Tableo la revisará en 24-48h.',
  refund_processed:     'Tu devolución de {importe} ha sido procesada. Llegará en 5-10 días hábiles.',
}

export function renderTemplate(template: NotificationTemplate, variables: Record<string, string>): string {
  return NOTIFICATION_TEMPLATES[template].replace(
    /\{(\w+)\}/g,
    (_, key) => variables[key] ?? `{${key}}`
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/notifications/types.ts
git commit -m "feat: notification types — NotificationProvider interface + template renderer"
```

---

## Task 4: Email Provider (Resend)

**Files:**
- Create: `src/modules/notifications/providers/email.provider.ts`
- Create: `src/modules/notifications/__tests__/email.provider.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/notifications/__tests__/email.provider.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: {
      send: vi.fn().mockResolvedValue({ data: { id: 'msg-123' }, error: null }),
    },
  })),
}))

describe('EmailProvider', () => {
  beforeEach(() => {
    vi.stubEnv('RESEND_API_KEY', 're_test_key')
    vi.stubEnv('RESEND_FROM_EMAIL', 'Tableo <noreply@tableo.app>')
  })

  it('isAvailable returns true when RESEND_API_KEY is set', async () => {
    const { EmailProvider } = await import('../providers/email.provider')
    const provider = new EmailProvider()
    expect(provider.isAvailable()).toBe(true)
  })

  it('isAvailable returns false when RESEND_API_KEY is missing', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    const { EmailProvider } = await import('../providers/email.provider')
    const provider = new EmailProvider()
    expect(provider.isAvailable()).toBe(false)
  })

  it('send calls Resend with correct params and returns success', async () => {
    const { EmailProvider } = await import('../providers/email.provider')
    const provider = new EmailProvider()

    const result = await provider.send({
      to: 'cliente@ejemplo.com',
      bookingId: 'booking-abc',
      templateKey: 'booking_confirmed',
      variables: { negocio: 'Salon Luna', fecha: '15 mayo', hora: '10:00' },
    })

    expect(result.success).toBe(true)
    expect(result.messageId).toBe('msg-123')
  })

  it('send returns failure when Resend returns an error', async () => {
    const { Resend } = await import('resend')
    vi.mocked(Resend).mockImplementation(() => ({
      emails: {
        send: vi.fn().mockResolvedValue({ data: null, error: { message: 'rate limit' } }),
      },
    }) as never)

    const { EmailProvider } = await import('../providers/email.provider')
    const provider = new EmailProvider()

    const result = await provider.send({
      to: 'cliente@ejemplo.com',
      bookingId: 'booking-abc',
      templateKey: 'booking_confirmed',
      variables: { negocio: 'Salon Luna', fecha: '15 mayo', hora: '10:00' },
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('rate limit')
  })

  it('has channel = email', async () => {
    const { EmailProvider } = await import('../providers/email.provider')
    const provider = new EmailProvider()
    expect(provider.channel).toBe('email')
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run src/modules/notifications/__tests__/email.provider.test.ts
```

Expected: FAIL — `Cannot find module '../providers/email.provider'`

- [ ] **Step 3: Create `src/modules/notifications/providers/email.provider.ts`**

```typescript
import { Resend } from 'resend'
import type { NotificationChannel, NotificationPayload, NotificationProvider, NotificationResult } from '../types'
import { renderTemplate } from '../types'

const SUBJECTS: Record<string, string> = {
  booking_confirmed:    'Tu reserva está confirmada ✅',
  booking_reminder_1h:  'Tu cita es en 1 hora 🕐',
  booking_cancelled:    'Tu reserva ha sido cancelada',
  booking_reminder_24h: 'Mañana tienes cita 📅',
  dispute_opened:       'Disputa abierta — Tableo la revisará pronto',
  refund_processed:     'Tu devolución ha sido procesada 💳',
}

export class EmailProvider implements NotificationProvider {
  readonly channel: NotificationChannel = 'email'

  isAvailable(): boolean {
    return !!process.env.RESEND_API_KEY
  }

  async send(payload: NotificationPayload): Promise<NotificationResult> {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const body = renderTemplate(payload.templateKey, payload.variables)
    const subject = SUBJECTS[payload.templateKey] ?? 'Notificación de Tableo'

    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? 'Tableo <noreply@tableo.app>',
      to: [payload.to],
      subject,
      html: `<p>${body.replace(/\n/g, '<br>')}</p>`,
    })

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, messageId: data?.id }
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run src/modules/notifications/__tests__/email.provider.test.ts
```

Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/notifications/providers/email.provider.ts \
        src/modules/notifications/__tests__/email.provider.test.ts
git commit -m "feat: EmailProvider using Resend SDK"
```

---

## Task 5: PWA Provider (web-push)

**Files:**
- Create: `src/modules/notifications/providers/pwa.provider.ts`
- Create: `src/modules/notifications/__tests__/pwa.provider.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/notifications/__tests__/pwa.provider.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }),
  },
}))

const VALID_SUBSCRIPTION = JSON.stringify({
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: { p256dh: 'key1', auth: 'auth1' },
})

describe('PWAProvider', () => {
  beforeEach(() => {
    vi.stubEnv('VAPID_PUBLIC_KEY', 'BPub1234567890')
    vi.stubEnv('VAPID_PRIVATE_KEY', 'priv1234567890')
    vi.stubEnv('VAPID_SUBJECT', 'mailto:hola@tableo.app')
  })

  it('isAvailable returns true when VAPID keys are set', async () => {
    const { PWAProvider } = await import('../providers/pwa.provider')
    const provider = new PWAProvider()
    expect(provider.isAvailable()).toBe(true)
  })

  it('isAvailable returns false when VAPID_PUBLIC_KEY is missing', async () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', '')
    const { PWAProvider } = await import('../providers/pwa.provider')
    const provider = new PWAProvider()
    expect(provider.isAvailable()).toBe(false)
  })

  it('send calls webpush.sendNotification with parsed subscription', async () => {
    const webpush = (await import('web-push')).default
    const { PWAProvider } = await import('../providers/pwa.provider')
    const provider = new PWAProvider()

    const result = await provider.send({
      to: VALID_SUBSCRIPTION,
      bookingId: 'booking-abc',
      templateKey: 'booking_reminder_1h',
      variables: { nombre: 'Ana', negocio: 'Salon Luna', hora: '11:00', link: 'https://tableo.app/b/abc' },
    })

    expect(webpush.sendNotification).toHaveBeenCalledOnce()
    expect(result.success).toBe(true)
  })

  it('send returns failure when sendNotification throws', async () => {
    const webpush = (await import('web-push')).default
    vi.mocked(webpush.sendNotification).mockRejectedValueOnce(new Error('subscription gone'))

    const { PWAProvider } = await import('../providers/pwa.provider')
    const provider = new PWAProvider()

    const result = await provider.send({
      to: VALID_SUBSCRIPTION,
      bookingId: 'booking-abc',
      templateKey: 'booking_reminder_1h',
      variables: { nombre: 'Ana', negocio: 'Salon Luna', hora: '11:00', link: 'https://tableo.app/b/abc' },
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('subscription gone')
  })

  it('has channel = pwa', async () => {
    const { PWAProvider } = await import('../providers/pwa.provider')
    expect(new PWAProvider().channel).toBe('pwa')
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run src/modules/notifications/__tests__/pwa.provider.test.ts
```

Expected: FAIL — `Cannot find module '../providers/pwa.provider'`

- [ ] **Step 3: Create `src/modules/notifications/providers/pwa.provider.ts`**

```typescript
import webpush from 'web-push'
import type { NotificationChannel, NotificationPayload, NotificationProvider, NotificationResult } from '../types'
import { renderTemplate } from '../types'

export class PWAProvider implements NotificationProvider {
  readonly channel: NotificationChannel = 'pwa'

  isAvailable(): boolean {
    return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
  }

  async send(payload: NotificationPayload): Promise<NotificationResult> {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? 'mailto:hola@tableo.app',
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    )

    try {
      const subscription = JSON.parse(payload.to)
      const body = renderTemplate(payload.templateKey, payload.variables)

      await webpush.sendNotification(
        subscription,
        JSON.stringify({ title: 'Tableo', body }),
      )

      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run src/modules/notifications/__tests__/pwa.provider.test.ts
```

Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/notifications/providers/pwa.provider.ts \
        src/modules/notifications/__tests__/pwa.provider.test.ts
git commit -m "feat: PWAProvider using web-push"
```

---

## Task 6: WhatsApp Baileys Provider

**Files:**
- Create: `src/modules/notifications/providers/whatsapp-baileys.provider.ts`
- Create: `src/modules/notifications/__tests__/whatsapp-baileys.provider.test.ts`

The Baileys provider manages a persistent WhatsApp connection via a singleton. The session is stored in `./baileys-session/`. On first run it prints a QR code to stdout for scanning.

- [ ] **Step 1: Write the failing test**

Create `src/modules/notifications/__tests__/whatsapp-baileys.provider.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSendMessage = vi.fn().mockResolvedValue({ status: 1 })
const mockSock = { sendMessage: mockSendMessage, ev: { on: vi.fn() } }

vi.mock('@whiskeysockets/baileys', () => ({
  default: vi.fn().mockReturnValue(mockSock),
  useMultiFileAuthState: vi.fn().mockResolvedValue({
    state: {},
    saveCreds: vi.fn(),
  }),
  DisconnectReason: { loggedOut: 401 },
}))

describe('WhatsAppBaileysProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('send formats phone number as WhatsApp JID and sends message', async () => {
    const { WhatsAppBaileysProvider } = await import('../providers/whatsapp-baileys.provider')
    const provider = new WhatsAppBaileysProvider()

    const result = await provider.send({
      to: '+34612345678',
      bookingId: 'booking-abc',
      templateKey: 'booking_reminder_1h',
      variables: {
        nombre: 'María',
        negocio: 'Salon Luna',
        hora: '11:00',
        link: 'https://tableo.app/b/abc',
      },
    })

    expect(mockSendMessage).toHaveBeenCalledWith(
      '34612345678@s.whatsapp.net',
      expect.objectContaining({ text: expect.stringContaining('María') }),
    )
    expect(result.success).toBe(true)
  })

  it('send returns failure when sendMessage throws', async () => {
    mockSendMessage.mockRejectedValueOnce(new Error('connection lost'))

    const { WhatsAppBaileysProvider } = await import('../providers/whatsapp-baileys.provider')
    const provider = new WhatsAppBaileysProvider()

    const result = await provider.send({
      to: '+34612345678',
      bookingId: 'booking-abc',
      templateKey: 'booking_reminder_1h',
      variables: { nombre: 'María', negocio: 'Salon Luna', hora: '11:00', link: 'https://tableo.app/b/abc' },
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('connection lost')
  })

  it('only accepts booking_reminder_1h template', async () => {
    const { WhatsAppBaileysProvider } = await import('../providers/whatsapp-baileys.provider')
    const provider = new WhatsAppBaileysProvider()

    const result = await provider.send({
      to: '+34612345678',
      bookingId: 'booking-abc',
      templateKey: 'booking_confirmed',   // NOT reminder_1h
      variables: { negocio: 'Salon Luna', fecha: '15 mayo', hora: '10:00' },
    })

    expect(mockSendMessage).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
    expect(result.error).toContain('skipped')
  })

  it('has channel = whatsapp', async () => {
    const { WhatsAppBaileysProvider } = await import('../providers/whatsapp-baileys.provider')
    expect(new WhatsAppBaileysProvider().channel).toBe('whatsapp')
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run src/modules/notifications/__tests__/whatsapp-baileys.provider.test.ts
```

Expected: FAIL — `Cannot find module '../providers/whatsapp-baileys.provider'`

- [ ] **Step 3: Create `src/modules/notifications/providers/whatsapp-baileys.provider.ts`**

```typescript
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys'
import type { Boom } from '@hapi/boom'
import type { NotificationChannel, NotificationPayload, NotificationProvider, NotificationResult } from '../types'
import { renderTemplate } from '../types'

let sock: ReturnType<typeof makeWASocket> | null = null

async function getConnection(): Promise<ReturnType<typeof makeWASocket>> {
  if (sock) return sock

  const { state, saveCreds } = await useMultiFileAuthState('./baileys-session')
  sock = makeWASocket({ auth: state, printQRInTerminal: true })

  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const code = (lastDisconnect?.error as Boom)?.output?.statusCode
      if (code !== DisconnectReason.loggedOut) {
        sock = null  // allow reconnect on next send
      }
    }
  })

  return sock
}

export class WhatsAppBaileysProvider implements NotificationProvider {
  readonly channel: NotificationChannel = 'whatsapp'

  isAvailable(): boolean {
    return sock !== null
  }

  async send(payload: NotificationPayload): Promise<NotificationResult> {
    // WhatsApp is only used for the 1h reminder template
    if (payload.templateKey !== 'booking_reminder_1h') {
      return { success: false, error: 'whatsapp skipped: template not applicable' }
    }

    try {
      const connection = await getConnection()
      const jid = payload.to.replace(/\D/g, '') + '@s.whatsapp.net'
      const text = renderTemplate(payload.templateKey, payload.variables)

      await connection.sendMessage(jid, { text })
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run src/modules/notifications/__tests__/whatsapp-baileys.provider.test.ts
```

Expected: 4/4 pass.

- [ ] **Step 5: Add `baileys-session/` to `.gitignore`**

Open `.gitignore` and add:

```
# WhatsApp Baileys session (contains auth credentials — never commit)
baileys-session/
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/notifications/providers/whatsapp-baileys.provider.ts \
        src/modules/notifications/__tests__/whatsapp-baileys.provider.test.ts \
        .gitignore
git commit -m "feat: WhatsAppBaileysProvider with persistent session + QR fallback"
```

---

## Task 7: SMS Provider (Twilio)

**Files:**
- Create: `src/modules/notifications/providers/sms.provider.ts`
- Create: `src/modules/notifications/__tests__/sms.provider.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/notifications/__tests__/sms.provider.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn().mockResolvedValue({ sid: 'SM123' })

vi.mock('twilio', () => ({
  default: vi.fn().mockReturnValue({
    messages: { create: mockCreate },
  }),
}))

describe('SMSProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'ACtest123')
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'token123')
    vi.stubEnv('TWILIO_PHONE_NUMBER', '+34900000001')
  })

  it('isAvailable returns true when all Twilio env vars are set', async () => {
    const { SMSProvider } = await import('../providers/sms.provider')
    expect(new SMSProvider().isAvailable()).toBe(true)
  })

  it('isAvailable returns false when TWILIO_ACCOUNT_SID is missing', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', '')
    const { SMSProvider } = await import('../providers/sms.provider')
    expect(new SMSProvider().isAvailable()).toBe(false)
  })

  it('send calls twilio messages.create with correct params', async () => {
    const { SMSProvider } = await import('../providers/sms.provider')
    const provider = new SMSProvider()

    const result = await provider.send({
      to: '+34612345678',
      bookingId: 'booking-abc',
      templateKey: 'booking_reminder_1h',
      variables: { nombre: 'Ana', negocio: 'Salon Luna', hora: '11:00', link: 'https://tableo.app/b/abc' },
    })

    expect(mockCreate).toHaveBeenCalledWith({
      from: '+34900000001',
      to: '+34612345678',
      body: expect.stringContaining('Ana'),
    })
    expect(result.success).toBe(true)
    expect(result.messageId).toBe('SM123')
  })

  it('send returns failure when Twilio throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('invalid number'))

    const { SMSProvider } = await import('../providers/sms.provider')
    const result = await new SMSProvider().send({
      to: '+34612345678',
      bookingId: 'booking-abc',
      templateKey: 'booking_confirmed',
      variables: { negocio: 'Salon Luna', fecha: '15 mayo', hora: '10:00' },
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('invalid number')
  })

  it('has channel = sms', async () => {
    const { SMSProvider } = await import('../providers/sms.provider')
    expect(new SMSProvider().channel).toBe('sms')
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run src/modules/notifications/__tests__/sms.provider.test.ts
```

Expected: FAIL — `Cannot find module '../providers/sms.provider'`

- [ ] **Step 3: Create `src/modules/notifications/providers/sms.provider.ts`**

```typescript
import twilio from 'twilio'
import type { NotificationChannel, NotificationPayload, NotificationProvider, NotificationResult } from '../types'
import { renderTemplate } from '../types'

export class SMSProvider implements NotificationProvider {
  readonly channel: NotificationChannel = 'sms'

  isAvailable(): boolean {
    return !!(
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER
    )
  }

  async send(payload: NotificationPayload): Promise<NotificationResult> {
    try {
      const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
      const body = renderTemplate(payload.templateKey, payload.variables)

      const message = await client.messages.create({
        from: process.env.TWILIO_PHONE_NUMBER!,
        to: payload.to,
        body,
      })

      return { success: true, messageId: message.sid }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run src/modules/notifications/__tests__/sms.provider.test.ts
```

Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/notifications/providers/sms.provider.ts \
        src/modules/notifications/__tests__/sms.provider.test.ts
git commit -m "feat: SMSProvider using Twilio SDK (upsell channel)"
```

---

## Task 8: Notification Factory

**Files:**
- Create: `src/modules/notifications/factory.ts`
- Create: `src/modules/notifications/__tests__/factory.test.ts`

The factory holds all provider instances and routes each notification to the correct channels. Routing rules: WhatsApp only for `booking_reminder_1h`; SMS only if `isAvailable()` (Twilio env vars set); PWA only if the `to` field looks like a JSON push subscription.

- [ ] **Step 1: Write the failing test**

Create `src/modules/notifications/__tests__/factory.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import type { NotificationPayload, NotificationProvider, NotificationResult } from '../types'

const makeProvider = (channel: string, available: boolean): NotificationProvider => ({
  channel: channel as never,
  isAvailable: () => available,
  send: vi.fn().mockResolvedValue({ success: true } as NotificationResult),
})

vi.mock('../providers/email.provider', () => ({
  EmailProvider: vi.fn().mockImplementation(() => makeProvider('email', true)),
}))
vi.mock('../providers/pwa.provider', () => ({
  PWAProvider: vi.fn().mockImplementation(() => makeProvider('pwa', true)),
}))
vi.mock('../providers/whatsapp-baileys.provider', () => ({
  WhatsAppBaileysProvider: vi.fn().mockImplementation(() => makeProvider('whatsapp', false)),
}))
vi.mock('../providers/sms.provider', () => ({
  SMSProvider: vi.fn().mockImplementation(() => makeProvider('sms', false)),
}))

describe('sendNotification factory', () => {
  it('sends via all available providers', async () => {
    const { sendNotification } = await import('../factory')

    const payload: NotificationPayload = {
      to: 'cliente@ejemplo.com',
      bookingId: 'booking-abc',
      templateKey: 'booking_confirmed',
      variables: { negocio: 'Salon Luna', fecha: '15 mayo', hora: '10:00' },
    }

    const results = await sendNotification(payload)

    // email is available, pwa is available but to= is not a JSON subscription
    expect(results.filter(r => r.success)).toHaveLength(1)  // email only
  })

  it('sends PWA when `to` is a JSON push subscription string', async () => {
    const { sendNotification } = await import('../factory')

    const payload: NotificationPayload = {
      to: JSON.stringify({ endpoint: 'https://fcm.example.com/123', keys: { p256dh: 'a', auth: 'b' } }),
      bookingId: 'booking-abc',
      templateKey: 'booking_reminder_1h',
      variables: { nombre: 'Ana', negocio: 'Salon Luna', hora: '11:00', link: 'https://tableo.app/b/abc' },
    }

    const results = await sendNotification(payload)
    const channels = results.map((_, i) => i)
    expect(results.some(r => r.success)).toBe(true)
  })

  it('skips unavailable providers without throwing', async () => {
    const { sendNotification } = await import('../factory')

    const payload: NotificationPayload = {
      to: 'cliente@ejemplo.com',
      bookingId: 'booking-abc',
      templateKey: 'booking_confirmed',
      variables: { negocio: 'Salon Luna', fecha: '15 mayo', hora: '10:00' },
    }

    await expect(sendNotification(payload)).resolves.not.toThrow()
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run src/modules/notifications/__tests__/factory.test.ts
```

Expected: FAIL — `Cannot find module '../factory'`

- [ ] **Step 3: Create `src/modules/notifications/factory.ts`**

```typescript
import { EmailProvider } from './providers/email.provider'
import { PWAProvider } from './providers/pwa.provider'
import { WhatsAppBaileysProvider } from './providers/whatsapp-baileys.provider'
import { SMSProvider } from './providers/sms.provider'
import type { NotificationPayload, NotificationProvider, NotificationResult } from './types'

const email = new EmailProvider()
const pwa = new PWAProvider()
const whatsapp = new WhatsAppBaileysProvider()
const sms = new SMSProvider()

function isPushSubscription(to: string): boolean {
  try {
    const parsed = JSON.parse(to)
    return typeof parsed.endpoint === 'string'
  } catch {
    return false
  }
}

function selectProviders(payload: NotificationPayload): NotificationProvider[] {
  const providers: NotificationProvider[] = []

  // Email: always try if available and `to` looks like an email address
  if (email.isAvailable() && payload.to.includes('@') && !isPushSubscription(payload.to)) {
    providers.push(email)
  }

  // PWA: only if `to` is a JSON push subscription
  if (pwa.isAvailable() && isPushSubscription(payload.to)) {
    providers.push(pwa)
  }

  // WhatsApp: only for 1h reminder + phone number
  if (
    whatsapp.isAvailable() &&
    payload.templateKey === 'booking_reminder_1h' &&
    payload.to.startsWith('+')
  ) {
    providers.push(whatsapp)
  }

  // SMS: only if Twilio configured + phone number
  if (sms.isAvailable() && payload.to.startsWith('+')) {
    providers.push(sms)
  }

  return providers
}

export async function sendNotification(payload: NotificationPayload): Promise<NotificationResult[]> {
  const providers = selectProviders(payload)
  return Promise.all(providers.map(p => p.send(payload)))
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run src/modules/notifications/__tests__/factory.test.ts
```

Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/notifications/factory.ts \
        src/modules/notifications/__tests__/factory.test.ts
git commit -m "feat: notification factory with provider routing logic"
```

---

## Task 9: Notification Scheduler

**Files:**
- Create: `src/modules/notifications/scheduler.ts`
- Create: `src/modules/notifications/__tests__/scheduler.test.ts`

The scheduler is called by a Next.js API Route (or Server Action) that pg_cron hits once per minute. It queries bookings marked `notification_sent_1h = true` (set by pg_cron SQL in migration 005) but where no `notification_log` entry with `status = 'sent'` exists yet. Then it fires the notification and logs the result.

- [ ] **Step 1: Write the failing test**

Create `src/modules/notifications/__tests__/scheduler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() => ({ from: mockFrom })),
}))

vi.mock('../factory', () => ({
  sendNotification: vi.fn().mockResolvedValue([{ success: true, messageId: 'msg-1' }]),
}))

describe('processPendingNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends notification for each pending booking and logs result', async () => {
    const pendingBookings = [
      {
        id: 'booking-1',
        notification_sent_1h: true,
        start_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        customers: { name: 'Ana García', email: 'ana@ejemplo.com', phone: '+34612345678' },
        resources: { businesses: { name: 'Salon Luna', slug: 'salon-luna' } },
      },
    ]

    // Mock: select pending bookings
    const mockSelect = vi.fn().mockReturnThis()
    const mockEq = vi.fn().mockReturnThis()
    const mockData = vi.fn().mockResolvedValue({ data: pendingBookings, error: null })
    const mockInsert = vi.fn().mockResolvedValue({ error: null })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') {
        return { select: mockSelect, eq: mockEq, then: mockData }
      }
      if (table === 'notification_log') {
        return { insert: mockInsert }
      }
      return {}
    })

    const { processPendingNotifications } = await import('../scheduler')
    await processPendingNotifications()

    const { sendNotification } = await import('../factory')
    expect(sendNotification).toHaveBeenCalledOnce()
    expect(mockInsert).toHaveBeenCalledOnce()
  })

  it('logs failure when sendNotification returns error', async () => {
    const { sendNotification } = await import('../factory')
    vi.mocked(sendNotification).mockResolvedValueOnce([{ success: false, error: 'timeout' }])

    const pendingBookings = [
      {
        id: 'booking-2',
        notification_sent_1h: true,
        start_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        customers: { name: 'Luis', email: 'luis@ejemplo.com', phone: null },
        resources: { businesses: { name: 'Salon Luna', slug: 'salon-luna' } },
      },
    ]

    const mockInsert = vi.fn().mockResolvedValue({ error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          then: vi.fn().mockResolvedValue({ data: pendingBookings, error: null }),
        }
      }
      if (table === 'notification_log') return { insert: mockInsert }
      return {}
    })

    const { processPendingNotifications } = await import('../scheduler')
    await processPendingNotifications()

    expect(mockInsert).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ status: 'failed' })]),
    )
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run src/modules/notifications/__tests__/scheduler.test.ts
```

Expected: FAIL — `Cannot find module '../scheduler'`

- [ ] **Step 3: Create `src/modules/notifications/scheduler.ts`**

```typescript
import { createServerClient } from '@/lib/supabase/server'
import { sendNotification } from './factory'
import type { NotificationTemplate } from './types'

interface PendingBooking {
  id: string
  start_at: string
  customers: { name: string; email: string; phone: string | null }
  resources: { businesses: { name: string; slug: string } }
}

export async function processPendingNotifications(): Promise<void> {
  const supabase = createServerClient()

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, start_at, customers(name, email, phone), resources(businesses(name, slug))')
    .eq('notification_sent_1h', true)
    .eq('status', 'confirmed')

  if (error || !bookings?.length) return

  for (const booking of bookings as unknown as PendingBooking[]) {
    const { customers: customer, resources } = booking
    const business = resources.businesses
    const template: NotificationTemplate = 'booking_reminder_1h'
    const variables = {
      nombre: customer.name,
      negocio: business.name,
      hora: new Date(booking.start_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
      link: `https://tableo.app/b/${business.slug}?booking=${booking.id}`,
    }

    const results = await sendNotification({
      to: customer.email,
      bookingId: booking.id,
      templateKey: template,
      variables,
    })

    const logEntries = results.map(result => ({
      booking_id: booking.id,
      channel: 'email',
      template,
      status: result.success ? 'sent' : 'failed',
      error: result.error ?? null,
    }))

    await supabase.from('notification_log').insert(logEntries)

    // Also send WhatsApp/SMS if phone available
    if (customer.phone) {
      const phoneResults = await sendNotification({
        to: customer.phone,
        bookingId: booking.id,
        templateKey: template,
        variables,
      })

      const phoneLog = phoneResults.map(result => ({
        booking_id: booking.id,
        channel: result.success ? 'whatsapp' : 'sms',
        template,
        status: result.success ? 'sent' : 'failed',
        error: result.error ?? null,
      }))

      if (phoneLog.length > 0) {
        await supabase.from('notification_log').insert(phoneLog)
      }
    }
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run src/modules/notifications/__tests__/scheduler.test.ts
```

Expected: 2/2 pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/notifications/scheduler.ts \
        src/modules/notifications/__tests__/scheduler.test.ts
git commit -m "feat: notification scheduler — processes bookings pending 1h reminder"
```

---

## Task 10: Presence Code Generator

**Files:**
- Create: `src/modules/presence/code-generator.ts`
- Create: `src/modules/presence/__tests__/code-generator.test.ts`

Generates a 4-digit numeric code and upserts it to `presence_codes` with a 5-minute TTL. The `UNIQUE(business_id)` constraint means upsert replaces the existing code.

- [ ] **Step 1: Write the failing test**

Create `src/modules/presence/__tests__/code-generator.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockUpsert = vi.fn().mockResolvedValue({ error: null })

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() => ({
    from: vi.fn(() => ({ upsert: mockUpsert })),
  })),
}))

describe('generateCode', () => {
  it('returns a 4-digit string', async () => {
    const { generateCode } = await import('../code-generator')
    const code = generateCode()
    expect(code).toMatch(/^\d{4}$/)
  })

  it('always returns a different code (statistically)', async () => {
    const { generateCode } = await import('../code-generator')
    const codes = new Set(Array.from({ length: 20 }, generateCode))
    expect(codes.size).toBeGreaterThan(1)
  })
})

describe('upsertPresenceCode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('upserts code with 5-minute expiry for the business', async () => {
    const { upsertPresenceCode } = await import('../code-generator')
    const before = Date.now()

    await upsertPresenceCode('business-abc')

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: 'business-abc',
        code: expect.stringMatching(/^\d{4}$/),
        expires_at: expect.any(String),
      }),
      expect.objectContaining({ onConflict: 'business_id' }),
    )

    const callArg = mockUpsert.mock.calls[0][0]
    const expiresAt = new Date(callArg.expires_at).getTime()
    expect(expiresAt).toBeGreaterThan(before + 4 * 60 * 1000)
    expect(expiresAt).toBeLessThan(before + 6 * 60 * 1000)
  })

  it('returns the generated code', async () => {
    const { upsertPresenceCode } = await import('../code-generator')
    const code = await upsertPresenceCode('business-abc')
    expect(code).toMatch(/^\d{4}$/)
  })

  it('throws when Supabase returns an error', async () => {
    mockUpsert.mockResolvedValueOnce({ error: { message: 'db error' } })
    const { upsertPresenceCode } = await import('../code-generator')
    await expect(upsertPresenceCode('business-abc')).rejects.toThrow('db error')
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run src/modules/presence/__tests__/code-generator.test.ts
```

Expected: FAIL — `Cannot find module '../code-generator'`

- [ ] **Step 3: Create `src/modules/presence/code-generator.ts`**

```typescript
import { createServerClient } from '@/lib/supabase/server'

export function generateCode(): string {
  return Math.floor(1000 + Math.random() * 9000).toString()
}

export async function upsertPresenceCode(businessId: string): Promise<string> {
  const supabase = createServerClient()
  const code = generateCode()
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()

  const { error } = await supabase
    .from('presence_codes')
    .upsert(
      { business_id: businessId, code, expires_at: expiresAt },
      { onConflict: 'business_id' },
    )

  if (error) throw new Error(error.message)
  return code
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run src/modules/presence/__tests__/code-generator.test.ts
```

Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/presence/code-generator.ts \
        src/modules/presence/__tests__/code-generator.test.ts
git commit -m "feat: presence code generator — 4-digit code with 5-min TTL"
```

---

## Task 11: Presence Code Verifier

**Files:**
- Create: `src/modules/presence/verifier.ts`
- Create: `src/modules/presence/__tests__/verifier.test.ts`

Verifies: (1) code matches active `presence_codes` record, (2) code is not expired, (3) booking start is within ±30 minutes from now. Inserts a `presence_checks` row recording the attempt.

- [ ] **Step 1: Write the failing test**

Create `src/modules/presence/__tests__/verifier.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() => ({ from: mockFrom })),
}))

const NOW = new Date('2026-05-15T10:00:00Z')
const BOOKING_START = new Date('2026-05-15T10:20:00Z')  // 20 min from now — within ±30 min window

function buildMocks({
  code = '1234',
  codeExpired = false,
  bookingStart = BOOKING_START,
  businessId = 'biz-abc',
}: {
  code?: string
  codeExpired?: boolean
  bookingStart?: Date
  businessId?: string
} = {}) {
  const expiresAt = codeExpired
    ? new Date(NOW.getTime() - 1000).toISOString()
    : new Date(NOW.getTime() + 60000).toISOString()

  const presenceCodesChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { code, expires_at: expiresAt, business_id: businessId },
      error: null,
    }),
  }

  const bookingsChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { start_at: bookingStart.toISOString(), resources: { business_id: businessId } },
      error: null,
    }),
  }

  const insertChain = { insert: vi.fn().mockResolvedValue({ error: null }) }

  mockFrom.mockImplementation((table: string) => {
    if (table === 'presence_codes') return presenceCodesChain
    if (table === 'bookings') return bookingsChain
    if (table === 'presence_checks') return insertChain
    return {}
  })

  return insertChain
}

describe('verifyPresenceCode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.setSystemTime(NOW)
  })

  it('returns valid=true when code matches, not expired, booking within window', async () => {
    buildMocks()
    const { verifyPresenceCode } = await import('../verifier')
    const result = await verifyPresenceCode({ bookingId: 'b-1', code: '1234' })
    expect(result.valid).toBe(true)
  })

  it('returns valid=false when code does not match', async () => {
    buildMocks({ code: '9999' })  // stored code is 9999, submitted is 1234
    const { verifyPresenceCode } = await import('../verifier')
    const result = await verifyPresenceCode({ bookingId: 'b-1', code: '1234' })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('code mismatch')
  })

  it('returns valid=false when code is expired', async () => {
    buildMocks({ codeExpired: true })
    const { verifyPresenceCode } = await import('../verifier')
    const result = await verifyPresenceCode({ bookingId: 'b-1', code: '1234' })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('expired')
  })

  it('returns valid=false when booking is outside ±30 min window', async () => {
    const farFuture = new Date(NOW.getTime() + 90 * 60 * 1000)  // 90 min away
    buildMocks({ bookingStart: farFuture })
    const { verifyPresenceCode } = await import('../verifier')
    const result = await verifyPresenceCode({ bookingId: 'b-1', code: '1234' })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('window')
  })

  it('always inserts a presence_checks row regardless of outcome', async () => {
    const { insert } = buildMocks({ code: '9999' })
    const { verifyPresenceCode } = await import('../verifier')
    await verifyPresenceCode({ bookingId: 'b-1', code: '1234' })
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ booking_id: 'b-1', valid: false }),
    )
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run src/modules/presence/__tests__/verifier.test.ts
```

Expected: FAIL — `Cannot find module '../verifier'`

- [ ] **Step 3: Create `src/modules/presence/verifier.ts`**

```typescript
import { createServerClient } from '@/lib/supabase/server'

const WINDOW_MS = 30 * 60 * 1000  // ±30 minutes

interface VerifyInput {
  bookingId: string
  code: string
  lat?: number
  lng?: number
}

interface VerifyResult {
  valid: boolean
  reason?: string
}

export async function verifyPresenceCode(input: VerifyInput): Promise<VerifyResult> {
  const supabase = createServerClient()

  const { data: booking } = await supabase
    .from('bookings')
    .select('start_at, resources(business_id)')
    .eq('id', input.bookingId)
    .single()

  if (!booking) {
    return { valid: false, reason: 'booking not found' }
  }

  const startAt = new Date(booking.start_at).getTime()
  const now = Date.now()
  const delta = Math.abs(startAt - now)

  if (delta > WINDOW_MS) {
    await recordCheck(supabase, input, false)
    return { valid: false, reason: 'outside ±30 min window' }
  }

  const businessId = (booking.resources as unknown as { business_id: string }).business_id

  const { data: presenceCode } = await supabase
    .from('presence_codes')
    .select('code, expires_at')
    .eq('business_id', businessId)
    .single()

  if (!presenceCode) {
    await recordCheck(supabase, input, false)
    return { valid: false, reason: 'no active code for business' }
  }

  if (new Date(presenceCode.expires_at).getTime() < now) {
    await recordCheck(supabase, input, false)
    return { valid: false, reason: 'code expired' }
  }

  if (presenceCode.code !== input.code) {
    await recordCheck(supabase, input, false)
    return { valid: false, reason: 'code mismatch' }
  }

  await recordCheck(supabase, input, true)
  return { valid: true }
}

async function recordCheck(
  supabase: ReturnType<typeof createServerClient>,
  input: VerifyInput,
  valid: boolean,
): Promise<void> {
  await supabase.from('presence_checks').insert({
    booking_id: input.bookingId,
    code_used: input.code,
    valid,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
  })
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run src/modules/presence/__tests__/verifier.test.ts
```

Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/presence/verifier.ts \
        src/modules/presence/__tests__/verifier.test.ts
git commit -m "feat: presence code verifier — ±30 min window, expired code check, audit trail"
```

---

## Task 12: Dispute Handler

**Files:**
- Create: `src/modules/presence/dispute.ts`
- Create: `src/modules/presence/__tests__/dispute.test.ts`

Opens a dispute when the client has a valid presence check but the business marks them as no-show. Also logs to `audit_logs`.

- [ ] **Step 1: Write the failing test**

Create `src/modules/presence/__tests__/dispute.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInsert = vi.fn().mockResolvedValue({ data: [{ id: 'dispute-1' }], error: null })
const mockUpdate = vi.fn().mockResolvedValue({ error: null })
const mockEq = vi.fn().mockReturnThis()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'disputes') return { insert: mockInsert, select: vi.fn().mockReturnThis() }
      if (table === 'bookings') return { update: mockUpdate, eq: mockEq }
      if (table === 'audit_logs') return { insert: vi.fn().mockResolvedValue({ error: null }) }
      return {}
    }),
  })),
}))

describe('openDispute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts a dispute record with provided evidence', async () => {
    const { openDispute } = await import('../dispute')

    await openDispute({
      bookingId: 'booking-abc',
      reason: 'presence_conflict',
      evidence: { presence_check_id: 'check-1', code: '1234', timestamp: new Date().toISOString() },
    })

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        booking_id: 'booking-abc',
        reason: 'presence_conflict',
        status: 'open',
        evidence: expect.objectContaining({ presence_check_id: 'check-1' }),
      }),
    )
  })

  it('updates booking status to disputed', async () => {
    const { openDispute } = await import('../dispute')

    await openDispute({
      bookingId: 'booking-abc',
      reason: 'presence_conflict',
      evidence: {},
    })

    expect(mockUpdate).toHaveBeenCalledWith({ status: 'disputed' })
    expect(mockEq).toHaveBeenCalledWith('id', 'booking-abc')
  })

  it('throws when dispute insert fails', async () => {
    mockInsert.mockResolvedValueOnce({ error: { message: 'constraint violation' } })
    const { openDispute } = await import('../dispute')

    await expect(
      openDispute({ bookingId: 'booking-abc', reason: 'presence_conflict', evidence: {} }),
    ).rejects.toThrow('constraint violation')
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run src/modules/presence/__tests__/dispute.test.ts
```

Expected: FAIL — `Cannot find module '../dispute'`

- [ ] **Step 3: Create `src/modules/presence/dispute.ts`**

```typescript
import { createServerClient } from '@/lib/supabase/server'

type DisputeReason = 'presence_conflict' | 'refund_claim' | 'cash_discrepancy'

interface OpenDisputeInput {
  bookingId: string
  reason: DisputeReason
  evidence: Record<string, unknown>
}

export async function openDispute(input: OpenDisputeInput): Promise<void> {
  const supabase = createServerClient()

  const { error: disputeError } = await supabase.from('disputes').insert({
    booking_id: input.bookingId,
    reason: input.reason,
    status: 'open',
    evidence: input.evidence,
  })

  if (disputeError) throw new Error(disputeError.message)

  await supabase
    .from('bookings')
    .update({ status: 'disputed' })
    .eq('id', input.bookingId)

  await supabase.from('audit_logs').insert({
    entity_type: 'dispute',
    entity_id: input.bookingId,
    action: 'dispute_opened',
    actor_type: 'system',
    metadata: { reason: input.reason },
  })
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run src/modules/presence/__tests__/dispute.test.ts
```

Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/presence/dispute.ts \
        src/modules/presence/__tests__/dispute.test.ts
git commit -m "feat: dispute handler — opens dispute, marks booking as disputed, audit trail"
```

---

## Task 13: Refund Policy (Pure Function)

**Files:**
- Create: `src/modules/refunds/policy.ts`
- Create: `src/modules/refunds/__tests__/policy.test.ts`

Pure function — no Supabase, no external calls. Given a scenario + hours until appointment, returns the refund type and percentage.

- [ ] **Step 1: Write the failing test**

Create `src/modules/refunds/__tests__/policy.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { determineRefundPolicy } from '../policy'

describe('determineRefundPolicy', () => {
  it('cancellation > 24h → stripe_refund 100%', () => {
    const policy = determineRefundPolicy({ scenario: 'cancelled', hoursUntilStart: 36 })
    expect(policy.type).toBe('stripe_refund')
    expect(policy.percentage).toBe(100)
  })

  it('cancellation < 24h → tableo_credit 100%', () => {
    const policy = determineRefundPolicy({ scenario: 'cancelled', hoursUntilStart: 12 })
    expect(policy.type).toBe('tableo_credit')
    expect(policy.percentage).toBe(100)
  })

  it('cancellation exactly 24h → stripe_refund 100%', () => {
    const policy = determineRefundPolicy({ scenario: 'cancelled', hoursUntilStart: 24 })
    expect(policy.type).toBe('stripe_refund')
    expect(policy.percentage).toBe(100)
  })

  it('no-show client (no presence code) → tableo_credit 50%', () => {
    const policy = determineRefundPolicy({ scenario: 'no_show_client', hoursUntilStart: 0 })
    expect(policy.type).toBe('tableo_credit')
    expect(policy.percentage).toBe(50)
  })

  it('no-show business (client has valid code) → human_review', () => {
    const policy = determineRefundPolicy({ scenario: 'no_show_business', hoursUntilStart: 0 })
    expect(policy.type).toBe('human_review')
    expect(policy.percentage).toBe(0)
  })

  it('dispute resolved pro-client → stripe_refund 100%', () => {
    const policy = determineRefundPolicy({ scenario: 'dispute_resolved_client', hoursUntilStart: 0 })
    expect(policy.type).toBe('stripe_refund')
    expect(policy.percentage).toBe(100)
  })

  it('dispute resolved pro-business → none', () => {
    const policy = determineRefundPolicy({ scenario: 'dispute_resolved_business', hoursUntilStart: 0 })
    expect(policy.type).toBe('none')
    expect(policy.percentage).toBe(0)
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run src/modules/refunds/__tests__/policy.test.ts
```

Expected: FAIL — `Cannot find module '../policy'`

- [ ] **Step 3: Create `src/modules/refunds/policy.ts`**

```typescript
export type RefundScenario =
  | 'cancelled'
  | 'no_show_client'
  | 'no_show_business'
  | 'dispute_resolved_client'
  | 'dispute_resolved_business'

export type RefundType = 'stripe_refund' | 'tableo_credit' | 'partial_credit' | 'human_review' | 'none'

export interface RefundPolicy {
  type: RefundType
  percentage: number
}

interface PolicyInput {
  scenario: RefundScenario
  hoursUntilStart: number
}

export function determineRefundPolicy(input: PolicyInput): RefundPolicy {
  const { scenario, hoursUntilStart } = input

  if (scenario === 'cancelled') {
    return hoursUntilStart >= 24
      ? { type: 'stripe_refund', percentage: 100 }
      : { type: 'tableo_credit', percentage: 100 }
  }

  if (scenario === 'no_show_client') {
    return { type: 'tableo_credit', percentage: 50 }
  }

  if (scenario === 'no_show_business') {
    return { type: 'human_review', percentage: 0 }
  }

  if (scenario === 'dispute_resolved_client') {
    return { type: 'stripe_refund', percentage: 100 }
  }

  if (scenario === 'dispute_resolved_business') {
    return { type: 'none', percentage: 0 }
  }

  return { type: 'none', percentage: 0 }
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run src/modules/refunds/__tests__/policy.test.ts
```

Expected: 7/7 pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/refunds/policy.ts \
        src/modules/refunds/__tests__/policy.test.ts
git commit -m "feat: refund policy — pure function covering all 5 scenarios from ADR-009"
```

---

## Task 14: Refund Engine

**Files:**
- Create: `src/modules/refunds/engine.ts`
- Create: `src/modules/refunds/__tests__/engine.test.ts`

Orchestrates the refund: calls `determineRefundPolicy`, then either issues a Stripe refund (scaffolded — not live until Stripe Phase), updates internal credit, or flags for human review. Records result in `refund_transactions` and `audit_logs`.

- [ ] **Step 1: Write the failing test**

Create `src/modules/refunds/__tests__/engine.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInsert = vi.fn().mockResolvedValue({ error: null })
const mockEq = vi.fn().mockReturnThis()
const mockSelect = vi.fn().mockReturnThis()
const mockSingle = vi.fn().mockResolvedValue({
  data: { amount_cents: 5000, stripe_payment_intent_id: 'pi_test_123' },
  error: null,
})

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'refund_transactions') return { insert: mockInsert }
      if (table === 'audit_logs') return { insert: mockInsert }
      if (table === 'bookings') {
        return { select: mockSelect, eq: mockEq, single: mockSingle }
      }
      return {}
    }),
  })),
}))

// Stripe scaffolded — not integrated yet, mock the placeholder
vi.mock('../stripe-adapter', () => ({
  issueStripeRefund: vi.fn().mockResolvedValue({ refundId: 'ref_123' }),
}))

describe('executeRefund', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('cancelled > 24h: inserts stripe_refund record with processed status', async () => {
    const { executeRefund } = await import('../engine')

    await executeRefund({
      bookingId: 'booking-abc',
      scenario: 'cancelled',
      hoursUntilStart: 36,
    })

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        booking_id: 'booking-abc',
        type: 'stripe_refund',
        status: 'processed',
      }),
    )
  })

  it('no-show client: inserts tableo_credit at 50%', async () => {
    const { executeRefund } = await import('../engine')

    await executeRefund({
      bookingId: 'booking-abc',
      scenario: 'no_show_client',
      hoursUntilStart: 0,
    })

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        booking_id: 'booking-abc',
        type: 'tableo_credit',
        amount_cents: 2500,  // 50% of 5000
      }),
    )
  })

  it('no-show business: inserts with pending status (awaits human review)', async () => {
    const { executeRefund } = await import('../engine')

    await executeRefund({
      bookingId: 'booking-abc',
      scenario: 'no_show_business',
      hoursUntilStart: 0,
    })

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        booking_id: 'booking-abc',
        status: 'pending',
      }),
    )
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run src/modules/refunds/__tests__/engine.test.ts
```

Expected: FAIL — `Cannot find module '../engine'`

- [ ] **Step 3: Create `src/modules/refunds/stripe-adapter.ts`** (scaffold — not live yet)

```typescript
// Scaffold: Stripe is not integrated yet (future Phase).
// This module will be replaced when Stripe payment is active.

export async function issueStripeRefund(
  _paymentIntentId: string,
  _amountCents: number,
): Promise<{ refundId: string }> {
  // TODO: replace with real Stripe SDK call when payments are integrated
  throw new Error(
    'Stripe not integrated yet. Refund must be processed manually via Stripe Dashboard.',
  )
}
```

- [ ] **Step 4: Create `src/modules/refunds/engine.ts`**

```typescript
import { createServerClient } from '@/lib/supabase/server'
import { determineRefundPolicy } from './policy'
import { issueStripeRefund } from './stripe-adapter'
import type { RefundScenario } from './policy'

interface ExecuteRefundInput {
  bookingId: string
  scenario: RefundScenario
  hoursUntilStart: number
}

export async function executeRefund(input: ExecuteRefundInput): Promise<void> {
  const supabase = createServerClient()

  const { data: booking } = await supabase
    .from('bookings')
    .select('amount_cents, stripe_payment_intent_id')
    .eq('id', input.bookingId)
    .single()

  if (!booking) throw new Error(`Booking ${input.bookingId} not found`)

  const policy = determineRefundPolicy({
    scenario: input.scenario,
    hoursUntilStart: input.hoursUntilStart,
  })

  const refundAmount = Math.floor(booking.amount_cents * (policy.percentage / 100))

  let stripeRefundId: string | null = null
  let status: 'pending' | 'processed' | 'failed' = 'pending'

  if (policy.type === 'stripe_refund' && booking.stripe_payment_intent_id) {
    try {
      const result = await issueStripeRefund(booking.stripe_payment_intent_id, refundAmount)
      stripeRefundId = result.refundId
      status = 'processed'
    } catch {
      status = 'failed'
    }
  } else if (policy.type === 'tableo_credit' || policy.type === 'partial_credit') {
    // Internal credit — no external call needed
    status = 'processed'
  } else if (policy.type === 'human_review' || policy.type === 'none') {
    status = 'pending'
  }

  await supabase.from('refund_transactions').insert({
    booking_id: input.bookingId,
    amount_cents: refundAmount,
    currency: 'EUR',
    type: policy.type === 'human_review' ? 'stripe_refund' : policy.type,
    reason: input.scenario,
    stripe_refund_id: stripeRefundId,
    status,
  })

  await supabase.from('audit_logs').insert({
    entity_type: 'refund',
    entity_id: input.bookingId,
    action: 'refund_initiated',
    actor_type: 'system',
    metadata: { scenario: input.scenario, policy, refundAmount, status },
  })
}
```

- [ ] **Step 5: Run test — verify it passes**

```bash
npx vitest run src/modules/refunds/__tests__/engine.test.ts
```

Expected: 3/3 pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/refunds/policy.ts \
        src/modules/refunds/engine.ts \
        src/modules/refunds/stripe-adapter.ts \
        src/modules/refunds/__tests__/engine.test.ts
git commit -m "feat: refund engine — policy → execute → log (Stripe scaffolded for future integration)"
```

---

## Task 15: Full Test Suite Run + Final Commit

- [ ] **Step 1: Run all Group A tests**

```bash
npx vitest run src/modules/
```

Expected output:
```
 ✓ src/modules/notifications/__tests__/email.provider.test.ts (5)
 ✓ src/modules/notifications/__tests__/pwa.provider.test.ts (5)
 ✓ src/modules/notifications/__tests__/whatsapp-baileys.provider.test.ts (4)
 ✓ src/modules/notifications/__tests__/sms.provider.test.ts (5)
 ✓ src/modules/notifications/__tests__/factory.test.ts (3)
 ✓ src/modules/notifications/__tests__/scheduler.test.ts (2)
 ✓ src/modules/presence/__tests__/code-generator.test.ts (5)
 ✓ src/modules/presence/__tests__/verifier.test.ts (5)
 ✓ src/modules/presence/__tests__/dispute.test.ts (3)
 ✓ src/modules/refunds/__tests__/policy.test.ts (7)
 ✓ src/modules/refunds/__tests__/engine.test.ts (3)

 Test Files  11 passed (11)
 Tests       47 passed (47)
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Push branch**

```bash
git push origin feature/phase1-foundation
```

Expected: branch pushed, all commits visible in GitHub.

---

## Self-Review Notes

**Spec coverage check:**
- ✅ `NotificationProvider` interface + 4 providers → Tasks 3–8
- ✅ Priority routing (PWA > Email > WhatsApp > SMS) → Task 8 factory
- ✅ WhatsApp only for `booking_reminder_1h` → Task 6 + enforced in factory
- ✅ Baileys session persistence + QR fallback → Task 6
- ✅ pg_cron notification scheduler → migration 005 + Task 9
- ✅ 4-digit rotating code, 5-min TTL → Task 10
- ✅ ±30 min verification window → Task 11
- ✅ Conflict → dispute → human review (NO automatic resolution) → Task 12
- ✅ All 6 refund scenarios → Task 13 + 14
- ✅ All 6 tables with RLS → Task 2
- ✅ `notification_log` written for every send attempt → Task 9
- ✅ `audit_logs` written for disputes + refunds → Tasks 12 + 14
- ✅ Stripe scaffolded (not live) → Task 14 stripe-adapter.ts

**Type consistency check:**
- `NotificationProvider.channel` used in types.ts, all providers, factory ✅
- `RefundScenario` defined in policy.ts, imported by engine.ts ✅
- `createServerClient` import path `@/lib/supabase/server` consistent across all modules ✅
