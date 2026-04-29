import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() => ({ from: mockFrom })),
}))

const NOW = new Date('2026-05-15T10:00:00Z')
const BOOKING_START = new Date('2026-05-15T10:20:00Z')  // 20 min from now — within ±30 min window

function buildMocks({
  code = '1234',
  codeExpired = false,
  bookingStart = BOOKING_START,
  businessId = 'biz-abc',
}: {
  code?: string
  codeExpired?: boolean
  bookingStart?: Date
  businessId?: string
} = {}) {
  const expiresAt = codeExpired
    ? new Date(NOW.getTime() - 1000).toISOString()
    : new Date(NOW.getTime() + 60000).toISOString()

  const presenceCodesChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { code, expires_at: expiresAt, business_id: businessId },
      error: null,
    }),
  }

  const bookingsChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { start_at: bookingStart.toISOString(), resources: { business_id: businessId } },
      error: null,
    }),
  }

  const insertChain = { insert: vi.fn().mockResolvedValue({ error: null }) }

  mockFrom.mockImplementation((table: string) => {
    if (table === 'presence_codes') return presenceCodesChain
    if (table === 'bookings') return bookingsChain
    if (table === 'presence_checks') return insertChain
    return {}
  })

  return insertChain
}

describe('verifyPresenceCode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.setSystemTime(NOW)
  })

  it('returns valid=true when code matches, not expired, booking within window', async () => {
    buildMocks()
    const { verifyPresenceCode } = await import('../verifier')
    const result = await verifyPresenceCode({ bookingId: 'b-1', code: '1234' })
    expect(result.valid).toBe(true)
  })

  it('returns valid=false when code does not match', async () => {
    buildMocks({ code: '9999' })  // stored code is 9999, submitted is 1234
    const { verifyPresenceCode } = await import('../verifier')
    const result = await verifyPresenceCode({ bookingId: 'b-1', code: '1234' })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('code mismatch')
  })

  it('returns valid=false when code is expired', async () => {
    buildMocks({ codeExpired: true })
    const { verifyPresenceCode } = await import('../verifier')
    const result = await verifyPresenceCode({ bookingId: 'b-1', code: '1234' })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('expired')
  })

  it('returns valid=false when booking is outside ±30 min window', async () => {
    const farFuture = new Date(NOW.getTime() + 90 * 60 * 1000)  // 90 min away
    buildMocks({ bookingStart: farFuture })
    const { verifyPresenceCode } = await import('../verifier')
    const result = await verifyPresenceCode({ bookingId: 'b-1', code: '1234' })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('window')
  })

  it('always inserts a presence_checks row regardless of outcome', async () => {
    const { insert } = buildMocks({ code: '9999' })
    const { verifyPresenceCode } = await import('../verifier')
    await verifyPresenceCode({ bookingId: 'b-1', code: '1234' })
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ booking_id: 'b-1', valid: false }),
    )
  })
})
