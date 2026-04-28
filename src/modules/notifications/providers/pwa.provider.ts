import webpush from 'web-push'
import type { NotificationChannel, NotificationPayload, NotificationProvider, NotificationResult } from '../types'
import { renderTemplate } from '../types'

export class PWAProvider implements NotificationProvider {
  readonly channel: NotificationChannel = 'pwa'

  isAvailable(): boolean {
    return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
  }

  async send(payload: NotificationPayload): Promise<NotificationResult> {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? 'mailto:hola@tableo.app',
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    )

    try {
      const subscription = JSON.parse(payload.to)
      const body = renderTemplate(payload.templateKey, payload.variables)

      await webpush.sendNotification(
        subscription,
        JSON.stringify({ title: 'Tableo', body }),
      )

      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }
}
