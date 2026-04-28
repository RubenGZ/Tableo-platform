-- =============================================================
-- 005_trust_notifications.sql
-- Trust Layer: notifications, presence, disputes, refunds
-- All tables have RLS enabled. No exceptions. (ADR-005)
-- =============================================================

-- Add notification tracking column to bookings (from Phase 1)
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS notification_sent_1h boolean NOT NULL DEFAULT false;

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
-- Marks bookings as pending for the 1h reminder scheduler
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
