// src/modules/availability/beauty-adapter.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AvailabilityAdapter, Slot, LockResult } from './types'
import type { SectorType, BookingMetadata } from '@/lib/db/types'
import { dayBoundsUTC } from '@/lib/dates'
import { TZDate } from '@date-fns/tz'
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

  async claimSlot(
    resourceId: string,
    startAt: Date,
    endAt: Date,
    sessionId: string
  ): Promise<LockResult> {
    const { data } = await this.supabase.rpc('claim_slot', {
      p_resource_id: resourceId,
      p_start_at:    startAt.toISOString(),
      p_end_at:      endAt.toISOString(),
      p_session_id:  sessionId,
    })

    if (!data?.success) {
      return {
        success: false,
        reason: (data?.reason as LockResult['reason']) ?? 'not_available',
      }
    }

    return {
      success:       true,
      bookingId:     data.booking_id as string,
      reservedUntil: new Date(data.reserved_until as string),
    }
  }

  async confirmBooking(
    bookingId: string,
    customerId: string,
    metadata: BookingMetadata
  ): Promise<string> {
    const { data, error } = await this.supabase
      .from('bookings')
      .update({
        status:         'confirmed',
        customer_id:    customerId,
        metadata,
        reserved_until: null,
        session_id:     null,
      })
      .eq('id', bookingId)
      .eq('status', 'reserved')
      .select('id, start_at, end_at')
      .single()

    if (error || !data) {
      throw new Error(
        `confirmBooking: booking ${bookingId} not found or not in 'reserved' state`
      )
    }

    const confirmed = data as { id: string; start_at: string; end_at: string }

    // Google Calendar sync — stub in Phase 2, real implementation in Phase 5
    await createEvent({
      calendarId: 'primary',
      summary:    'Reserva confirmada',
      startAt:    new Date(confirmed.start_at),
      endAt:      new Date(confirmed.end_at),
      timezoneId: 'Europe/Madrid',
    })

    return confirmed.id
  }

  async releaseSlot(sessionId: string): Promise<void> {
    await this.supabase.rpc('release_slot', { p_session_id: sessionId })
  }
}
