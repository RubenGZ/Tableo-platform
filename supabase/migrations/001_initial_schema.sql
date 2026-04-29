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
    CHECK (status IN ('pending', 'reserved', 'confirmed', 'cancelled', 'completed', 'no_show', 'disputed')),
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
