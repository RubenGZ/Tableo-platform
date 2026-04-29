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
  | 'disputed'

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
