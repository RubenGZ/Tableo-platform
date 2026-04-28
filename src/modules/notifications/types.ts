export type NotificationChannel = 'email' | 'pwa' | 'whatsapp' | 'sms'

export type NotificationTemplate =
  | 'booking_confirmed'
  | 'booking_reminder_1h'
  | 'booking_cancelled'
  | 'booking_reminder_24h'
  | 'dispute_opened'
  | 'refund_processed'

export interface NotificationPayload {
  to: string           // email address, E.164 phone, or push subscription JSON string
  bookingId: string
  templateKey: NotificationTemplate
  variables: Record<string, string>
}

export interface NotificationResult {
  success: boolean
  messageId?: string
  error?: string
}

export interface NotificationProvider {
  readonly channel: NotificationChannel
  send(payload: NotificationPayload): Promise<NotificationResult>
  isAvailable(): boolean
}

export const NOTIFICATION_TEMPLATES: Record<NotificationTemplate, string> = {
  booking_confirmed:    'Tu reserva en {negocio} está confirmada para el {fecha} a las {hora}.',
  booking_reminder_1h:  'Hola {nombre} 👋 Tu cita en {negocio} es hoy a las {hora}. Si necesitas cancelar: {link}. ¡Hasta pronto!',
  booking_cancelled:    'Tu reserva en {negocio} del {fecha} ha sido cancelada.',
  booking_reminder_24h: 'Mañana tienes cita en {negocio} a las {hora}. ¡Te esperamos!',
  dispute_opened:       'Se ha abierto una disputa para tu reserva del {fecha}. El equipo Tableo la revisará en 24-48h.',
  refund_processed:     'Tu devolución de {importe} ha sido procesada. Llegará en 5-10 días hábiles.',
}

export function renderTemplate(template: NotificationTemplate, variables: Record<string, string>): string {
  return NOTIFICATION_TEMPLATES[template].replace(
    /\{(\w+)\}/g,
    (_, key) => variables[key] ?? `{${key}}`
  )
}
