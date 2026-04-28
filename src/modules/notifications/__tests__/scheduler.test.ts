import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() => ({ from: mockFrom })),
}))

vi.mock('../factory', () => ({
  sendNotification: vi.fn().mockResolvedValue([{ success: true, messageId: 'msg-1' }]),
}))

describe('processPendingNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends notification for each pending booking and logs result', async () => {
    const pendingBookings = [
      {
        id: 'booking-1',
        notification_sent_1h: true,
        start_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        customers: { name: 'Ana García', email: 'ana@ejemplo.com', phone: '+34612345678' },
        resources: { businesses: { name: 'Salon Luna', slug: 'salon-luna' } },
      },
    ]

    // Mock: select pending bookings
    const mockInsert = vi.fn().mockResolvedValue({ error: null })

    const bookingsChain: Record<string, unknown> = {}
    bookingsChain.select = vi.fn().mockReturnValue(bookingsChain)
    bookingsChain.eq = vi.fn().mockReturnValue(bookingsChain)
    bookingsChain.then = (onfulfilled: (v: unknown) => unknown) =>
      Promise.resolve({ data: pendingBookings, error: null }).then(onfulfilled)

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') {
        return bookingsChain
      }
      if (table === 'notification_log') {
        return { insert: mockInsert }
      }
      return {}
    })

    const { processPendingNotifications } = await import('../scheduler')
    await processPendingNotifications()

    const { sendNotification } = await import('../factory')
    // Called twice: once for email, once for phone (booking has phone)
    expect(sendNotification).toHaveBeenCalledTimes(2)
    // Insert called twice: once for email log, once for phone log
    expect(mockInsert).toHaveBeenCalledTimes(2)
  })

  it('logs failure when sendNotification returns error', async () => {
    const { sendNotification } = await import('../factory')
    vi.mocked(sendNotification).mockResolvedValueOnce([{ success: false, error: 'timeout' }])

    const pendingBookings = [
      {
        id: 'booking-2',
        notification_sent_1h: true,
        start_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        customers: { name: 'Luis', email: 'luis@ejemplo.com', phone: null },
        resources: { businesses: { name: 'Salon Luna', slug: 'salon-luna' } },
      },
    ]

    const mockInsert = vi.fn().mockResolvedValue({ error: null })
    const bookingsChain2: Record<string, unknown> = {}
    bookingsChain2.select = vi.fn().mockReturnValue(bookingsChain2)
    bookingsChain2.eq = vi.fn().mockReturnValue(bookingsChain2)
    bookingsChain2.then = (onfulfilled: (v: unknown) => unknown) =>
      Promise.resolve({ data: pendingBookings, error: null }).then(onfulfilled)

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') return bookingsChain2
      if (table === 'notification_log') return { insert: mockInsert }
      return {}
    })

    const { processPendingNotifications } = await import('../scheduler')
    await processPendingNotifications()

    expect(mockInsert).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ status: 'failed' })]),
    )
  })
})
