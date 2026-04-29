import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInsert = vi.fn().mockResolvedValue({ data: [{ id: 'dispute-1' }], error: null })
const mockEq = vi.fn().mockResolvedValue({ error: null })
const mockUpdate = vi.fn(() => ({ eq: mockEq }))

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() => ({
    from: vi.fn(function(table: string) {
      if (table === 'disputes') return { insert: mockInsert, select: vi.fn().mockReturnThis() }
      if (table === 'bookings') return { update: mockUpdate }
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
