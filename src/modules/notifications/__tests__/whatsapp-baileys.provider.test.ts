import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSendMessage = vi.fn().mockResolvedValue({ status: 1 })
const mockSock = { sendMessage: mockSendMessage, ev: { on: vi.fn() } }

vi.mock('@whiskeysockets/baileys', () => ({
  default: vi.fn().mockReturnValue(mockSock),
  useMultiFileAuthState: vi.fn().mockResolvedValue({
    state: {},
    saveCreds: vi.fn(),
  }),
  DisconnectReason: { loggedOut: 401 },
}))

describe('WhatsAppBaileysProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('send formats phone number as WhatsApp JID and sends message', async () => {
    const { WhatsAppBaileysProvider } = await import('../providers/whatsapp-baileys.provider')
    const provider = new WhatsAppBaileysProvider()

    const result = await provider.send({
      to: '+34612345678',
      bookingId: 'booking-abc',
      templateKey: 'booking_reminder_1h',
      variables: {
        nombre: 'María',
        negocio: 'Salon Luna',
        hora: '11:00',
        link: 'https://tableo.app/b/abc',
      },
    })

    expect(mockSendMessage).toHaveBeenCalledWith(
      '34612345678@s.whatsapp.net',
      expect.objectContaining({ text: expect.stringContaining('María') }),
    )
    expect(result.success).toBe(true)
  })

  it('send returns failure when sendMessage throws', async () => {
    mockSendMessage.mockRejectedValueOnce(new Error('connection lost'))

    const { WhatsAppBaileysProvider } = await import('../providers/whatsapp-baileys.provider')
    const provider = new WhatsAppBaileysProvider()

    const result = await provider.send({
      to: '+34612345678',
      bookingId: 'booking-abc',
      templateKey: 'booking_reminder_1h',
      variables: { nombre: 'María', negocio: 'Salon Luna', hora: '11:00', link: 'https://tableo.app/b/abc' },
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('connection lost')
  })

  it('only accepts booking_reminder_1h template', async () => {
    const { WhatsAppBaileysProvider } = await import('../providers/whatsapp-baileys.provider')
    const provider = new WhatsAppBaileysProvider()

    const result = await provider.send({
      to: '+34612345678',
      bookingId: 'booking-abc',
      templateKey: 'booking_confirmed',   // NOT reminder_1h
      variables: { negocio: 'Salon Luna', fecha: '15 mayo', hora: '10:00' },
    })

    expect(mockSendMessage).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
    expect(result.error).toContain('skipped')
  })

  it('has channel = whatsapp', async () => {
    const { WhatsAppBaileysProvider } = await import('../providers/whatsapp-baileys.provider')
    expect(new WhatsAppBaileysProvider().channel).toBe('whatsapp')
  })
})
