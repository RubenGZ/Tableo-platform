import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('web-push', function () {
  return {
    default: {
      setVapidDetails: vi.fn(),
      sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }),
    },
  }
})

const VALID_SUBSCRIPTION = JSON.stringify({
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: { p256dh: 'key1', auth: 'auth1' },
})

describe('PWAProvider', () => {
  beforeEach(() => {
    vi.stubEnv('VAPID_PUBLIC_KEY', 'BPub1234567890')
    vi.stubEnv('VAPID_PRIVATE_KEY', 'priv1234567890')
    vi.stubEnv('VAPID_SUBJECT', 'mailto:hola@tableo.app')
  })

  it('isAvailable returns true when VAPID keys are set', async () => {
    const { PWAProvider } = await import('../providers/pwa.provider')
    const provider = new PWAProvider()
    expect(provider.isAvailable()).toBe(true)
  })

  it('isAvailable returns false when VAPID_PUBLIC_KEY is missing', async () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', '')
    const { PWAProvider } = await import('../providers/pwa.provider')
    const provider = new PWAProvider()
    expect(provider.isAvailable()).toBe(false)
  })

  it('send calls webpush.sendNotification with parsed subscription', async () => {
    const webpush = (await import('web-push')).default
    const { PWAProvider } = await import('../providers/pwa.provider')
    const provider = new PWAProvider()

    const result = await provider.send({
      to: VALID_SUBSCRIPTION,
      bookingId: 'booking-abc',
      templateKey: 'booking_reminder_1h',
      variables: { nombre: 'Ana', negocio: 'Salon Luna', hora: '11:00', link: 'https://tableo.app/b/abc' },
    })

    expect(webpush.sendNotification).toHaveBeenCalledOnce()
    expect(result.success).toBe(true)
  })

  it('send returns failure when sendNotification throws', async () => {
    const webpush = (await import('web-push')).default
    vi.mocked(webpush.sendNotification).mockRejectedValueOnce(new Error('subscription gone'))

    const { PWAProvider } = await import('../providers/pwa.provider')
    const provider = new PWAProvider()

    const result = await provider.send({
      to: VALID_SUBSCRIPTION,
      bookingId: 'booking-abc',
      templateKey: 'booking_reminder_1h',
      variables: { nombre: 'Ana', negocio: 'Salon Luna', hora: '11:00', link: 'https://tableo.app/b/abc' },
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('subscription gone')
  })

  it('has channel = pwa', async () => {
    const { PWAProvider } = await import('../providers/pwa.provider')
    expect(new PWAProvider().channel).toBe('pwa')
  })
})
