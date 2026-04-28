import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(function () {
    return {
      emails: {
        send: vi.fn().mockResolvedValue({ data: { id: 'msg-123' }, error: null }),
      },
    }
  }),
}))

describe('EmailProvider', () => {
  beforeEach(() => {
    vi.stubEnv('RESEND_API_KEY', 're_test_key')
    vi.stubEnv('RESEND_FROM_EMAIL', 'Tableo <noreply@tableo.app>')
  })

  it('isAvailable returns true when RESEND_API_KEY is set', async () => {
    const { EmailProvider } = await import('../providers/email.provider')
    const provider = new EmailProvider()
    expect(provider.isAvailable()).toBe(true)
  })

  it('isAvailable returns false when RESEND_API_KEY is missing', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    const { EmailProvider } = await import('../providers/email.provider')
    const provider = new EmailProvider()
    expect(provider.isAvailable()).toBe(false)
  })

  it('send calls Resend with correct params and returns success', async () => {
    const { EmailProvider } = await import('../providers/email.provider')
    const provider = new EmailProvider()

    const result = await provider.send({
      to: 'cliente@ejemplo.com',
      bookingId: 'booking-abc',
      templateKey: 'booking_confirmed',
      variables: { negocio: 'Salon Luna', fecha: '15 mayo', hora: '10:00' },
    })

    expect(result.success).toBe(true)
    expect(result.messageId).toBe('msg-123')
  })

  it('send returns failure when Resend returns an error', async () => {
    const { Resend } = await import('resend')
    vi.mocked(Resend).mockImplementation(function () {
      return {
        emails: {
          send: vi.fn().mockResolvedValue({ data: null, error: { message: 'rate limit' } }),
        },
      }
    } as never)

    const { EmailProvider } = await import('../providers/email.provider')
    const provider = new EmailProvider()

    const result = await provider.send({
      to: 'cliente@ejemplo.com',
      bookingId: 'booking-abc',
      templateKey: 'booking_confirmed',
      variables: { negocio: 'Salon Luna', fecha: '15 mayo', hora: '10:00' },
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('rate limit')
  })

  it('has channel = email', async () => {
    const { EmailProvider } = await import('../providers/email.provider')
    const provider = new EmailProvider()
    expect(provider.channel).toBe('email')
  })
})
