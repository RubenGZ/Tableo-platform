import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn().mockResolvedValue({ sid: 'SM123' })

vi.mock('twilio', () => ({
  default: vi.fn().mockReturnValue({
    messages: { create: mockCreate },
  }),
}))

describe('SMSProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'ACtest123')
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'token123')
    vi.stubEnv('TWILIO_PHONE_NUMBER', '+34900000001')
  })

  it('isAvailable returns true when all Twilio env vars are set', async () => {
    const { SMSProvider } = await import('../providers/sms.provider')
    expect(new SMSProvider().isAvailable()).toBe(true)
  })

  it('isAvailable returns false when TWILIO_ACCOUNT_SID is missing', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', '')
    const { SMSProvider } = await import('../providers/sms.provider')
    expect(new SMSProvider().isAvailable()).toBe(false)
  })

  it('send calls twilio messages.create with correct params', async () => {
    const { SMSProvider } = await import('../providers/sms.provider')
    const provider = new SMSProvider()

    const result = await provider.send({
      to: '+34612345678',
      bookingId: 'booking-abc',
      templateKey: 'booking_reminder_1h',
      variables: { nombre: 'Ana', negocio: 'Salon Luna', hora: '11:00', link: 'https://tableo.app/b/abc' },
    })

    expect(mockCreate).toHaveBeenCalledWith({
      from: '+34900000001',
      to: '+34612345678',
      body: expect.stringContaining('Ana'),
    })
    expect(result.success).toBe(true)
    expect(result.messageId).toBe('SM123')
  })

  it('send returns failure when Twilio throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('invalid number'))

    const { SMSProvider } = await import('../providers/sms.provider')
    const result = await new SMSProvider().send({
      to: '+34612345678',
      bookingId: 'booking-abc',
      templateKey: 'booking_confirmed',
      variables: { negocio: 'Salon Luna', fecha: '15 mayo', hora: '10:00' },
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('invalid number')
  })

  it('has channel = sms', async () => {
    const { SMSProvider } = await import('../providers/sms.provider')
    expect(new SMSProvider().channel).toBe('sms')
  })
})
