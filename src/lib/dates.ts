import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'

export function toBusinessLocal(utcDate: Date, timezoneId: string): string {
  return new TZDate(utcDate, timezoneId).toLocaleString('es-ES', {
    dateStyle: 'full',
    timeStyle: 'short',
  })
}

export function formatSlotTime(utcDate: Date, timezoneId: string): string {
  const local = new TZDate(utcDate, timezoneId)
  return format(local, 'HH:mm')
}

export function dayBoundsUTC(
  date: string,
  timezoneId: string
): { startOfDay: Date; endOfDay: Date } {
  // Parse the date string (format: YYYY-MM-DD)
  const [year, month, day] = date.split('-').map(Number)

  // Create TZDate for midnight (00:00:00) local time in the given timezone
  const startOfDay = new TZDate(year, month - 1, day, 0, 0, 0, timezoneId)
  // Create TZDate for end of day (23:59:59) local time in the given timezone
  const endOfDay = new TZDate(year, month - 1, day, 23, 59, 59, timezoneId)

  return {
    startOfDay: new Date(startOfDay.getTime()),
    endOfDay:   new Date(endOfDay.getTime()),
  }
}
