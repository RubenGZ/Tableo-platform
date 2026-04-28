import { Resend } from 'resend'
import type { NotificationChannel, NotificationPayload, NotificationProvider, NotificationResult } from '../types'
import { renderTemplate } from '../types'

const SUBJECTS: Record<string, string> = {
  booking_confirmed:    'Tu reserva está confirmada ✅',
  booking_reminder_1h:  'Tu cita es en 1 hora 🕐',
  booking_cancelled:    'Tu reserva ha sido cancelada',
  booking_reminder_24h: 'Mañana tienes cita 📅',
  dispute_opened:       'Disputa abierta — Tableo la revisará pronto',
  refund_processed:     'Tu devolución ha sido procesada 💳',
}

export class EmailProvider implements NotificationProvider {
  readonly channel: NotificationChannel = 'email'

  isAvailable(): boolean {
    return !!process.env.RESEND_API_KEY
  }

  async send(payload: NotificationPayload): Promise<NotificationResult> {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const body = renderTemplate(payload.templateKey, payload.variables)
    const subject = SUBJECTS[payload.templateKey] ?? 'Notificación de Tableo'

    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? 'Tableo <noreply@tableo.app>',
      to: [payload.to],
      subject,
      html: `<p>${body.replace(/\n/g, '<br>')}</p>`,
    })

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, messageId: data?.id }
  }
}
