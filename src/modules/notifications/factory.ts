import { EmailProvider } from './providers/email.provider'
import { PWAProvider } from './providers/pwa.provider'
import { WhatsAppBaileysProvider } from './providers/whatsapp-baileys.provider'
import { SMSProvider } from './providers/sms.provider'
import type { NotificationPayload, NotificationProvider, NotificationResult } from './types'

const email = new EmailProvider()
const pwa = new PWAProvider()
const whatsapp = new WhatsAppBaileysProvider()
const sms = new SMSProvider()

function isPushSubscription(to: string): boolean {
  try {
    const parsed = JSON.parse(to)
    return typeof parsed.endpoint === 'string'
  } catch {
    return false
  }
}

function selectProviders(payload: NotificationPayload): NotificationProvider[] {
  const providers: NotificationProvider[] = []

  // Email: always try if available and `to` looks like an email address
  if (email.isAvailable() && payload.to.includes('@') && !isPushSubscription(payload.to)) {
    providers.push(email)
  }

  // PWA: only if `to` is a JSON push subscription
  if (pwa.isAvailable() && isPushSubscription(payload.to)) {
    providers.push(pwa)
  }

  // WhatsApp: only for 1h reminder + phone number
  if (
    whatsapp.isAvailable() &&
    payload.templateKey === 'booking_reminder_1h' &&
    payload.to.startsWith('+')
  ) {
    providers.push(whatsapp)
  }

  // SMS: only if Twilio configured + phone number
  if (sms.isAvailable() && payload.to.startsWith('+')) {
    providers.push(sms)
  }

  return providers
}

export async function sendNotification(payload: NotificationPayload): Promise<NotificationResult[]> {
  const providers = selectProviders(payload)
  return Promise.all(providers.map(p => p.send(payload)))
}
