# Spec: Grupo A — Capa de Confianza y Notificaciones

**Fecha:** 2026-04-28  
**Estado:** Aprobado  
**Contexto:** Tableo MVP — extensión de ADR-003, ADR-004, ADR-005  
**Siguiente fase:** Grupos B y C (Business Rules Engine + Intelligence Layer)

---

## Scope

Este spec cubre tres subsistemas independientes que comparten el objetivo de eliminar el fraude bilateral y comunicar proactivamente con clientes y negocios:

1. **Capa de Notificaciones** — abstracción multi-canal (Email, PWA, WhatsApp/Baileys, SMS)
2. **Verificación de Presencia** — código rotativo + crosscheck anti-fraude
3. **Motor de Devoluciones** — política híbrida de reembolsos

---

## 1. Capa de Notificaciones

### Decisión de arquitectura

Patrón `NotificationProvider` idéntico al `AvailabilityAdapter` (ADR-002). El sistema llama a la interfaz — no sabe qué proveedor hay debajo. Añadir un canal nuevo = crear un archivo nuevo.

### Interfaz

```typescript
// src/modules/notifications/types.ts
export interface NotificationPayload {
  to: string              // email, número de teléfono, o push subscription
  bookingId: string
  templateKey: NotificationTemplate
  variables: Record<string, string>
}

export type NotificationTemplate =
  | 'booking_confirmed'
  | 'booking_reminder_1h'
  | 'booking_cancelled'
  | 'booking_reminder_24h'
  | 'dispute_opened'
  | 'refund_processed'

export interface NotificationProvider {
  send(payload: NotificationPayload): Promise<{ success: boolean; messageId?: string }>
  isAvailable(): boolean
}
```

### Proveedores

| Proveedor | Canal | Coste | Condición de activación |
|-----------|-------|-------|------------------------|
| `EmailProvider` | Email (Resend) | €0 hasta 3.000/mes | Siempre activo |
| `PWAProvider` | Push nativo browser | €0 | Cliente aceptó notificaciones |
| `WhatsAppBaileysProvider` | WhatsApp | €0 operacional + SIM €5-10 | Tableo configura en servidor |
| `SMSProvider` | SMS (Twilio) | $0.02/SMS coste, $0.05 PVP | Negocio activa en configuración (upsell) |

### Prioridad de envío

```
1. PWA Push           → gratis, instantáneo
2. Email              → gratis, confirmaciones + recordatorios
3. WhatsApp (Baileys) → recordatorio 1h antes SOLO
4. SMS                → solo si negocio lo ha activado (upsell de pago)
```

### WhatsApp/Baileys — decisión técnica

- **Biblioteca:** Baileys (Node.js, open source)
- **Número:** SIM dedicada Tableo (no asociada a ningún negocio concreto)
- **Template único aprobado internamente:**
  > *"Hola {nombre} 👋 Tu cita en {negocio} es hoy a las {hora}. Si necesitas cancelar: {link}. ¡Hasta pronto!"*
- **Riesgo aceptado:** Meta puede banear el número. Si ocurre, se reemplaza la SIM en minutos. Email + PWA siguen activos como fallback — ningún cliente se queda sin recordatorio.
- **Scheduler:** `pg_cron` dispara notificaciones 1h antes de cada `booking` con `status = 'confirmed'`

### Estructura de módulo

```
src/modules/notifications/
├── types.ts
├── factory.ts                        ← registro de proveedores
├── scheduler.ts                      ← integración con pg_cron
└── providers/
    ├── email.provider.ts             ← Resend SDK
    ├── pwa.provider.ts               ← Web Push API
    ├── whatsapp-baileys.provider.ts  ← Baileys client
    └── sms.provider.ts               ← Twilio SDK (upsell)
```

### Tabla de log

```sql
CREATE TABLE notification_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings,
  channel     text NOT NULL CHECK (channel IN ('email', 'pwa', 'whatsapp', 'sms')),
  template    text NOT NULL,
  status      text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error       text,
  sent_at     timestamptz DEFAULT now()
);
```

---

## 2. Verificación de Presencia

### Decisión de arquitectura

Código rotativo de 4 dígitos generado por el dashboard del negocio. El cliente lo introduce al llegar. Esto crea prueba criptográfica de presencia que requiere cooperación física de ambas partes — ninguna puede actuar sola.

### Flujo completo

```
Cliente llega al negocio
  → Negocio ve código de 4 dígitos en su dashboard (rota cada 5 minutos)
  → Cliente abre su página de reserva en el móvil e introduce el código
  → Sistema valida: código correcto + dentro de ventana temporal (±30 min de la cita)
  → Sistema registra: timestamp + coordenadas GPS (opcional, mejora evidencia)
  → Negocio pulsa "Confirmar asistencia" en dashboard

CASO A — Todo coincide:
  → booking.status = 'completed', comisión normal

CASO B — Cliente introdujo código, negocio marca 'no_show':
  → Sistema abre disputa automática
  → booking.status = 'disputed', fondos retenidos
  → Equipo Tableo revisa evidencia en 24-48h: código válido + timestamp + GPS
  → Resolución humana — no automática

CASO C — Nadie confirma presencia:
  → No-show real → política de devoluciones
  
CASO D — Negocio confirma, cliente no introdujo código:
  → No-show del cliente → política de devoluciones
```

### Tablas

```sql
-- Códigos rotativos por negocio
CREATE TABLE presence_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses ON DELETE CASCADE,
  code        text NOT NULL,               -- 4 dígitos
  expires_at  timestamptz NOT NULL,        -- NOW() + 5 minutos
  created_at  timestamptz DEFAULT now(),
  UNIQUE (business_id)                     -- un código activo por negocio
);

-- Check-ins de clientes
CREATE TABLE presence_checks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings ON DELETE CASCADE,
  code_used   text NOT NULL,
  valid       boolean NOT NULL,
  lat         numeric(9,6),               -- GPS opcional
  lng         numeric(9,6),
  checked_at  timestamptz DEFAULT now()
);

-- Cola de disputas
CREATE TABLE disputes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid NOT NULL REFERENCES bookings,
  reason          text NOT NULL,          -- 'presence_conflict' | 'refund_claim' | 'cash_discrepancy'
  status          text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved_client', 'resolved_business', 'resolved_tableo')),
  evidence        jsonb NOT NULL DEFAULT '{}',  -- código, timestamp, GPS, fotos si aplica
  resolved_by     uuid REFERENCES auth.users,
  resolved_at     timestamptz,
  created_at      timestamptz DEFAULT now()
);

-- Audit log general (trazabilidad completa)
CREATE TABLE audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,              -- 'booking' | 'refund' | 'presence' | 'dispute'
  entity_id   uuid NOT NULL,
  action      text NOT NULL,
  actor_type  text NOT NULL CHECK (actor_type IN ('client', 'business', 'system', 'tableo')),
  actor_id    text,                       -- uuid o session_id
  metadata    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz DEFAULT now()
);
```

### Módulo

```
src/modules/presence/
├── code-generator.ts   ← genera código, programa rotación con pg_cron
├── verifier.ts         ← valida código introducido por cliente
└── dispute.ts          ← abre disputa + notifica a Tableo
```

### RLS para `disputes` y `audit_logs`

```sql
-- Solo Tableo (service role) puede leer todas las disputas
-- El negocio ve sus propias disputas
-- El cliente no ve la tabla (acceso vía Server Action con service role)
ALTER TABLE disputes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "business_see_own_disputes"
ON disputes FOR SELECT
USING (
  booking_id IN (
    SELECT b.id FROM bookings b
    JOIN resources r ON b.resource_id = r.id
    JOIN businesses bs ON r.business_id = bs.id
    WHERE bs.owner_id = auth.uid()
  )
);
```

---

## 3. Motor de Devoluciones

### Política híbrida (aprobada)

| Escenario | Acción | Canal |
|-----------|--------|-------|
| Cancelación >24h antes | Reembolso 100% | Stripe (tarjeta original) |
| Cancelación <24h antes | Crédito 100% Tableo | Saldo interno |
| No-show cliente (sin código) | Crédito 50% si prepagó | Saldo interno |
| No-show negocio (cliente tiene código válido) | Disputa → revisión humana | Retenido hasta resolución |
| Disputa resuelta a favor del cliente | Reembolso 100% | Stripe |
| Disputa resuelta a favor del negocio | Sin reembolso | — |

### Tabla

```sql
CREATE TABLE refund_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid NOT NULL REFERENCES bookings,
  amount_cents    integer NOT NULL,
  currency        text NOT NULL DEFAULT 'EUR',
  type            text NOT NULL CHECK (type IN ('stripe_refund', 'tableo_credit', 'partial_credit')),
  reason          text NOT NULL,
  stripe_refund_id text,                  -- si aplica
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processed', 'failed')),
  processed_at    timestamptz,
  created_at      timestamptz DEFAULT now()
);
```

### Módulo

```
src/modules/refunds/
├── policy.ts   ← determina qué tipo de devolución aplica según el escenario
└── engine.ts   ← ejecuta el reembolso (llama a Stripe o actualiza crédito interno)
```

---

## Resumen de cambios al schema

### Tablas nuevas (6)
- `notification_log`
- `presence_codes`
- `presence_checks`
- `disputes`
- `audit_logs`
- `refund_transactions`

### Módulos nuevos (3)
- `src/modules/notifications/` (4 providers)
- `src/modules/presence/`
- `src/modules/refunds/`

### Migración
- `supabase/migrations/005_trust_notifications.sql`

### RLS
- Todas las tablas nuevas tienen RLS activado desde la primera migración

---

## Lo que este spec NO cubre (fases siguientes)

- **Grupo B:** Motor de excepciones (festivos, reservas off-schedule), Smart Selector pre-baked vs. custom
- **Grupo C:** Smart Waiting List, Reputation Score, Yield Management
- **Stripe Integration completa:** El `refunds/engine.ts` asume que Stripe ya está integrado (Phase de pagos futura)
- **Panel de disputas interno de Tableo:** Interfaz de gestión para el equipo — herramienta interna, no MVP del producto
