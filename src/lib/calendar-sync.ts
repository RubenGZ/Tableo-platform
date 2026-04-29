// src/lib/calendar-sync.ts
// Stub de integración con Google Calendar.
// Phase 5 implementa la llamada real a Google Calendar API.

export interface CalendarEvent {
  calendarId: string
  summary: string
  startAt: Date
  endAt: Date
  timezoneId: string
}

export async function createEvent(event: CalendarEvent): Promise<void> {
  console.log(
    '[calendarSync] createEvent stub:',
    event.summary,
    event.startAt.toISOString(),
    '→',
    event.endAt.toISOString()
  )
}

export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  console.log('[calendarSync] deleteEvent stub:', calendarId, eventId)
}
