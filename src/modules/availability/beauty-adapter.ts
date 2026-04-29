// src/modules/availability/beauty-adapter.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AvailabilityAdapter, Slot, LockResult } from './types'
import type { SectorType, BookingMetadata } from '@/lib/db/types'
import { dayBoundsUTC } from '@/lib/dates'
import { createEvent } from '@/lib/calendar-sync'

interface TimeRange {
  start: Date
  end: Date
}

function hasOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && a.end > b.start
}

export class BeautyAdapter implements AvailabilityAdapter {
  readonly sectorType: SectorType = 'beauty'

  constructor(private readonly supabase: SupabaseClient) {}

  async getSlots(resourceId: string, date: string, timezoneId: string): Promise<Slot[]> {
    const { startOfDay, endOfDay } = dayBoundsUTC(date, timezoneId)

    // day_of_week in schema: 0=Monday, 1=Tuesday, ..., 6=Sunday (ADR-003)
    // JS getDay(): 0=Sunday, 1=Monday, ..., 6=Saturday
    const jsDay = startOfDay.getDay()
    const dbDayOfWeek = jsDay === 0 ? 6 : jsDay - 1

    // 1. Availability windows for this day
    const { data: windows } = await this.supabase
      .from('availability_windows')
      .select('open_time, close_time')
      .eq('resource_id', resourceId)
      .eq('day_of_week', dbDayOfWeek)

    if (!windows?.length) return []

    // 2. Resource metadata (duration)
    const { data: resource } = await this.supabase
      .from('resources')
      .select('metadata')
      .eq('id', resourceId)
      .single()

    const durationMinutes: number =
      (resource?.metadata as { duration_default?: number })?.duration_default ?? 60
    const durationMs = durationMinutes * 60 * 1000

    // 3. Blocking rules overlapping this day
    const { data: blocks } = await this.supabase
      .from('blocking_rules')
      .select('start_at, end_at')
      .eq('resource_id', resourceId)
      .lt('start_at', endOfDay.toISOString())
      .gt('end_at', startOfDay.toISOString())

    // 4. Existing bookings overlapping this day
    const { data: bookings } = await this.supabase
      .from('bookings')
      .select('start_at, end_at')
      .eq('resource_id', resourceId)
      .in('status', ['reserved', 'confirmed'])
      .lt('start_at', endOfDay.toISOString())
      .gt('end_at', startOfDay.toISOString())

    const occupied: TimeRange[] = [
      ...(blocks ?? []).map((b: { start_at: string; end_at: string }) => ({
        start: new Date(b.start_at),
        end: new Date(b.end_at),
      })),
      ...(bookings ?? []).map((b: { start_at: string; end_at: string }) => ({
        start: new Date(b.start_at),
        end: new Date(b.end_at),
      })),
    ]

    const slots: Slot[] = []

    for (const window of windows as { open_time: string; close_time: string }[]) {
      const [openH, openM] = window.open_time.split(':').map(Number)
      const [closeH, closeM] = window.close_time.split(':').map(Number)

      const { TZDate } = await import('@date-fns/tz')
      const [year, month, day] = date.split('-').map(Number)
      const openUTC = new Date(
        new TZDate(year, month - 1, day, openH, openM, 0, timezoneId).getTime()
      )
      const closeUTC = new Date(
        new TZDate(year, month - 1, day, closeH, closeM, 0, timezoneId).getTime()
      )

      let cursor = openUTC.getTime()

      while (cursor + durationMs <= closeUTC.getTime()) {
        const slotStart = new Date(cursor)
        const slotEnd   = new Date(cursor + durationMs)

        const blocked = occupied.some(occ =>
          hasOverlap({ start: slotStart, end: slotEnd }, occ)
        )

        if (!blocked) {
          slots.push({ startAt: slotStart, endAt: slotEnd, durationMinutes })
        }

        cursor += durationMs
      }
    }

    return slots
  }

  // Stub implementations — completed in Task 6
  async claimSlot(_resourceId: string, _startAt: Date, _endAt: Date, _sessionId: string): Promise<LockResult> {
    throw new Error('Not implemented yet')
  }

  async confirmBooking(_bookingId: string, _customerId: string, _metadata: BookingMetadata): Promise<string> {
    throw new Error('Not implemented yet')
  }

  async releaseSlot(_sessionId: string): Promise<void> {
    throw new Error('Not implemented yet')
  }
}

// Suppress unused import warning — createEvent will be used in Task 6
void createEvent
