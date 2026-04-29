// src/modules/availability/types.ts
import type { SectorType, BookingMetadata } from '@/lib/db/types'

export interface Slot {
  startAt: Date
  endAt: Date
  durationMinutes: number
}

export interface LockResult {
  success: boolean
  bookingId?: string
  reservedUntil?: Date
  reason?: 'not_available' | 'concurrent_lock'
}

export interface AvailabilityAdapter {
  readonly sectorType: SectorType
  getSlots(resourceId: string, date: string, timezoneId: string): Promise<Slot[]>
  claimSlot(resourceId: string, startAt: Date, endAt: Date, sessionId: string): Promise<LockResult>
  confirmBooking(bookingId: string, customerId: string, metadata: BookingMetadata): Promise<string>
  releaseSlot(sessionId: string): Promise<void>
}
