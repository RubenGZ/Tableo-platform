import { describe, it, expect, vi } from 'vitest'
import type { NotificationPayload, NotificationProvider, NotificationResult } from '../types'

vi.mock('../providers/email.provider', () => ({
  EmailProvider: function EmailProvider() {
    return {
      channel: 'email',
      isAvailable: () => true,
      send: vi.fn().mockResolvedValue({ success: true } as NotificationResult),
    }
  },
}))
vi.mock('../providers/pwa.provider', () => ({
  PWAProvider: function PWAProvider() {
    return {
      channel: 'pwa',
      isAvailable: () => true,
      send: vi.fn().mockResolvedValue({ success: true } as NotificationResult),
    }
  },
}))
vi.mock('../providers/whatsapp-baileys.provider', () => ({
  WhatsAppBaileysProvider: function WhatsAppBaileysProvider() {
    return {
      channel: 'whatsapp',
      isAvailable: () => false,
      send: vi.fn().mockResolvedValue({ success: true } as NotificationResult),
    }
  },
}))
vi.mock('../providers/sms.provider', () => ({
  SMSProvider: function SMSProvider() {
    return {
      channel: 'sms',
      isAvailable: () => false,
      send: vi.fn().mockResolvedValue({ success: true } as NotificationResult),
    }
  },
}))

describe('sendNotification factory', () => {
  it('sends via all available providers', async () => {
    const { sendNotification } = await import('../factory')

    const payload: NotificationPayload = {
      to: 'cliente@ejemplo.com',
      bookingId: 'booking-abc',
      templateKey: 'booking_confirmed',
      variables: { negocio: 'Salon Luna', fecha: '15 mayo', hora: '10:00' },
    }

    const results = await sendNotification(payload)

    // email is available, pwa is available but to= is not a JSON subscription
    expect(results.filter(r => r.success)).toHaveLength(1)  // email only
  })

  it('sends PWA when `to` is a JSON push subscription string', async () => {
    const { sendNotification } = await import('../factory')

    const payload: NotificationPayload = {
      to: JSON.stringify({ endpoint: 'https://fcm.example.com/123', keys: { p256dh: 'a', auth: 'b' } }),
      bookingId: 'booking-abc',
      templateKey: 'booking_reminder_1h',
      variables: { nombre: 'Ana', negocio: 'Salon Luna', hora: '11:00', link: 'https://tableo.app/b/abc' },
    }

    const results = await sendNotification(payload)
    expect(results.some(r => r.success)).toBe(true)
  })

  it('skips unavailable providers without throwing', async () => {
    const { sendNotification } = await import('../factory')

    const payload: NotificationPayload = {
      to: 'cliente@ejemplo.com',
      bookingId: 'booking-abc',
      templateKey: 'booking_confirmed',
      variables: { negocio: 'Salon Luna', fecha: '15 mayo', hora: '10:00' },
    }

    await expect(sendNotification(payload)).resolves.not.toThrow()
  })
})
