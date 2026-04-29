// src/modules/availability/__tests__/beauty-adapter.test.ts
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BeautyAdapter } from '../beauty-adapter'

// ─── Mock factory ─────────────────────────────────────────────────────────────
function makeQueryChain(data: unknown) {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn().mockReturnValue(chain)
  chain.eq = vi.fn().mockReturnValue(chain)
  chain.in = vi.fn().mockReturnValue(chain)
  chain.lt = vi.fn().mockReturnValue(chain)
  chain.gt = vi.fn().mockReturnValue(chain)
  chain.update = vi.fn().mockReturnValue(chain)
  chain.single = vi.fn().mockResolvedValue({ data, error: null })
  chain.then = (fn: (v: { data: unknown; error: null }) => unknown) =>
    Promise.resolve({ data, error: null }).then(fn)
  return chain
}

function makeSupabase(tables: Record<string, unknown>, rpcData?: unknown) {
  return {
    from: vi.fn().mockImplementation((table: string) =>
      makeQueryChain(tables[table] ?? null)
    ),
    rpc: vi.fn().mockResolvedValue({ data: rpcData ?? null, error: null }),
  } as unknown as SupabaseClient
}

// ─── Test data ────────────────────────────────────────────────────────────────
const WINDOW_MON_9_11 = { open_time: '09:00:00', close_time: '11:00:00' }
const RESOURCE_60MIN  = { metadata: { duration_default: 60 } }
const TIMEZONE = 'Atlantic/Reykjavik' // UTC+0 year-round, no DST

describe('BeautyAdapter.getSlots', () => {
  it('retorna todos los slots disponibles en un día sin reservas', async () => {
    const adapter = new BeautyAdapter(makeSupabase({
      availability_windows: [WINDOW_MON_9_11],
      resources: RESOURCE_60MIN,
      blocking_rules: [],
      bookings: [],
    }))

    const slots = await adapter.getSlots('res-1', '2024-06-17', TIMEZONE)

    expect(slots).toHaveLength(2)
    expect(slots[0].startAt.getUTCHours()).toBe(9)
    expect(slots[1].startAt.getUTCHours()).toBe(10)
    expect(slots[0].durationMinutes).toBe(60)
  })

  it('excluye slots que solapan con reservas existentes', async () => {
    const existingBooking = {
      start_at: '2024-06-17T09:00:00Z',
      end_at:   '2024-06-17T10:00:00Z',
    }
    const adapter = new BeautyAdapter(makeSupabase({
      availability_windows: [WINDOW_MON_9_11],
      resources: RESOURCE_60MIN,
      blocking_rules: [],
      bookings: [existingBooking],
    }))

    const slots = await adapter.getSlots('res-1', '2024-06-17', TIMEZONE)

    expect(slots).toHaveLength(1)
    expect(slots[0].startAt.getUTCHours()).toBe(10)
  })

  it('excluye slots que solapan con blocking rules', async () => {
    const block = {
      start_at: '2024-06-17T09:00:00Z',
      end_at:   '2024-06-17T10:00:00Z',
    }
    const adapter = new BeautyAdapter(makeSupabase({
      availability_windows: [WINDOW_MON_9_11],
      resources: RESOURCE_60MIN,
      blocking_rules: [block],
      bookings: [],
    }))

    const slots = await adapter.getSlots('res-1', '2024-06-17', TIMEZONE)

    expect(slots).toHaveLength(1)
    expect(slots[0].startAt.getUTCHours()).toBe(10)
  })

  it('retorna array vacío si no hay ventana de disponibilidad ese día', async () => {
    const adapter = new BeautyAdapter(makeSupabase({
      availability_windows: [],
      resources: RESOURCE_60MIN,
      blocking_rules: [],
      bookings: [],
    }))

    const slots = await adapter.getSlots('res-1', '2024-06-17', TIMEZONE)

    expect(slots).toHaveLength(0)
  })

  it('incluye el slot que termina exactamente en close_time', async () => {
    const tightWindow = { open_time: '09:00:00', close_time: '10:00:00' }
    const adapter = new BeautyAdapter(makeSupabase({
      availability_windows: [tightWindow],
      resources: RESOURCE_60MIN,
      blocking_rules: [],
      bookings: [],
    }))

    const slots = await adapter.getSlots('res-1', '2024-06-17', TIMEZONE)

    expect(slots).toHaveLength(1)
  })

  it('no incluye un slot que sobrepasaría close_time', async () => {
    const window = { open_time: '09:00:00', close_time: '10:30:00' }
    const adapter = new BeautyAdapter(makeSupabase({
      availability_windows: [window],
      resources: RESOURCE_60MIN,
      blocking_rules: [],
      bookings: [],
    }))

    const slots = await adapter.getSlots('res-1', '2024-06-17', TIMEZONE)

    expect(slots).toHaveLength(1)
    expect(slots[0].startAt.getUTCHours()).toBe(9)
  })
})

describe('BeautyAdapter.claimSlot', () => {
  it('retorna success:true con bookingId y reservedUntil cuando el slot está libre', async () => {
    const reservedUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    const adapter = new BeautyAdapter(makeSupabase({}, {
      success: true,
      booking_id: 'booking-123',
      reserved_until: reservedUntil,
    }))

    const result = await adapter.claimSlot(
      'res-1',
      new Date('2024-06-17T09:00:00Z'),
      new Date('2024-06-17T10:00:00Z'),
      'session-abc'
    )

    expect(result.success).toBe(true)
    expect(result.bookingId).toBe('booking-123')
    expect(result.reservedUntil).toBeInstanceOf(Date)
  })

  it('retorna success:false con reason:not_available cuando el slot está ocupado', async () => {
    const adapter = new BeautyAdapter(makeSupabase({}, {
      success: false,
      reason: 'not_available',
    }))

    const result = await adapter.claimSlot(
      'res-1',
      new Date('2024-06-17T09:00:00Z'),
      new Date('2024-06-17T10:00:00Z'),
      'session-abc'
    )

    expect(result.success).toBe(false)
    expect(result.reason).toBe('not_available')
  })

  it('retorna success:false con reason:concurrent_lock en conflicto de concurrencia', async () => {
    const adapter = new BeautyAdapter(makeSupabase({}, {
      success: false,
      reason: 'concurrent_lock',
    }))

    const result = await adapter.claimSlot(
      'res-1',
      new Date('2024-06-17T09:00:00Z'),
      new Date('2024-06-17T10:00:00Z'),
      'session-xyz'
    )

    expect(result.success).toBe(false)
    expect(result.reason).toBe('concurrent_lock')
  })
})

describe('BeautyAdapter.confirmBooking', () => {
  it('actualiza el booking y retorna el bookingId', async () => {
    const bookingData = {
      id: 'booking-123',
      start_at: '2024-06-17T09:00:00Z',
      end_at: '2024-06-17T10:00:00Z',
    }
    const adapter = new BeautyAdapter(makeSupabase({
      bookings: bookingData,
    }))

    const result = await adapter.confirmBooking(
      'booking-123',
      'customer-456',
      { service: 'Corte', price_eur: 25 }
    )

    expect(result).toBe('booking-123')
  })

  it('lanza error si el booking no existe o no está en estado reserved', async () => {
    const adapter = new BeautyAdapter(makeSupabase({
      bookings: null,
    }))

    await expect(
      adapter.confirmBooking('booking-inexistente', 'customer-456', {})
    ).rejects.toThrow('confirmBooking')
  })
})

describe('BeautyAdapter.releaseSlot', () => {
  it('llama release_slot() PG sin lanzar error', async () => {
    const mockSupabase = makeSupabase({}, { success: true, released: 1 })
    const adapter = new BeautyAdapter(mockSupabase)

    await expect(adapter.releaseSlot('session-abc')).resolves.toBeUndefined()
    expect(mockSupabase.rpc).toHaveBeenCalledWith('release_slot', {
      p_session_id: 'session-abc',
    })
  })
})
