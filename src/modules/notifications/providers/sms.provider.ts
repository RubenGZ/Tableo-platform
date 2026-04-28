import twilio from 'twilio'
import type { NotificationChannel, NotificationPayload, NotificationProvider, NotificationResult } from '../types'
import { renderTemplate } from '../types'

export class SMSProvider implements NotificationProvider {
  readonly channel: NotificationChannel = 'sms'

  isAvailable(): boolean {
    return !!(
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER
    )
  }

  async send(payload: NotificationPayload): Promise<NotificationResult> {
    try {
      const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
      const body = renderTemplate(payload.templateKey, payload.variables)

      const message = await client.messages.create({
        from: process.env.TWILIO_PHONE_NUMBER!,
        to: payload.to,
        body,
      })

      return { success: true, messageId: message.sid }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }
}
