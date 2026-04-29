import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInsert = vi.fn().mockResolvedValue({ error: null })
const mockEq = vi.fn().mockReturnThis()
const mockSelect = vi.fn().mockReturnThis()
const mockSingle = vi.fn().mockResolvedValue({
  data: { amount_cents: 5000, stripe_payment_intent_id: 'pi_test_123' },
  error: null,
})

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(function() {
    return {
      from: vi.fn(function(table: string) {
        if (table === 'refund_transactions') return { insert: mockInsert }
        if (table === 'audit_logs') return { insert: mockInsert }
        if (table === 'bookings') {
          return { select: mockSelect, eq: mockEq, single: mockSingle }
        }
        return {}
      }),
    }
  }),
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
