import { createServerClient } from '@/lib/supabase/server'
import { sendNotification } from './factory'
import type { NotificationTemplate } from './types'

interface PendingBooking {
  id: string
  start_at: string
  customers: { name: string; email: string; phone: string | null }
  resources: { businesses: { name: string; slug: string } }
}

export async function processPendingNotifications(): Promise<void> {
  const supabase = await createServerClient()

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, start_at, customers(name, email, phone), resources(businesses(name, slug))')
    .eq('notification_sent_1h', true)
    .eq('status', 'confirmed')

  if (error || !bookings?.length) return

  for (const booking of bookings as unknown as PendingBooking[]) {
    const { customers: customer, resources } = booking
    const business = resources.businesses
    const template: NotificationTemplate = 'booking_reminder_1h'
    const variables = {
      nombre: customer.name,
      negocio: business.name,
      hora: new Date(booking.start_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
      link: `https://tableo.app/b/${business.slug}?booking=${booking.id}`,
    }

    const results = await sendNotification({
      to: customer.email,
      bookingId: booking.id,
      templateKey: template,
      variables,
    })

    const logEntries = results.map(result => ({
      booking_id: booking.id,
      channel: 'email',
      template,
      status: result.success ? 'sent' : 'failed',
      error: result.error ?? null,
    }))

    await supabase.from('notification_log').insert(logEntries)

    // Also send WhatsApp/SMS if phone available
    if (customer.phone) {
      const phoneResults = await sendNotification({
        to: customer.phone,
        bookingId: booking.id,
        templateKey: template,
        variables,
      })

      const phoneLog = phoneResults.map(result => ({
        booking_id: booking.id,
        channel: result.success ? 'whatsapp' : 'sms',
        template,
        status: result.success ? 'sent' : 'failed',
        error: result.error ?? null,
      }))

      if (phoneLog.length > 0) {
        await supabase.from('notification_log').insert(phoneLog)
      }
    }
  }
}
