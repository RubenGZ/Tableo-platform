// src/lib/ai/date-normalizer.ts
// Normaliza cualquier representación de fecha/hora a un Date UTC.
// Acepta: ISO 8601, strings relativos (español/inglés), objetos { date, time }.

import * as chrono from 'chrono-node'
import { TZDate } from '@date-fns/tz'
import { ParseError } from './types'

type DatetimeInput = string | { date: string; time: string }

/**
 * Convierte cualquier formato de fecha/hora a un Date UTC.
 * @param input        Input del LLM — puede ser ISO, relativo o objeto
 * @param timezoneId   IANA timezone del negocio (para interpretar fechas locales)
 * @param referenceDate Fecha de referencia para "mañana", "el viernes", etc. (default: now)
 */
export function normalizeDateTime(
  input: DatetimeInput,
  timezoneId: string,
  referenceDate?: Date
): Date {
  const now = referenceDate ?? new Date()
  let result: Date
  let isRelative = false

  // 1. Objeto { date, time } — formato Siri, Google Assistant
  if (typeof input === 'object' && input !== null) {
    const timeStr = input.time.includes(':') ? input.time : `${input.time}:00`
    const paddedTime = timeStr.length === 5 ? `${timeStr}:00` : timeStr
    const isoLocal = `${input.date}T${paddedTime}`
    const [y, mo, d, h, mi, s] = parseLocalParts(isoLocal)
    const tzDate = new TZDate(y, mo, d, h, mi, s, timezoneId)
    result = new Date(tzDate.getTime())
  }
  // 2. ISO con timezone explícita (termina en Z o +HH:MM o -HH:MM)
  else if (/Z$|[+-]\d{2}:\d{2}$/.test(input)) {
    result = new Date(input)
  }
  // 3. ISO sin timezone — interpretar como hora local del negocio
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(input)) {
    const [y, mo, d, h, mi, s] = parseLocalParts(input)
    const tzDate = new TZDate(y, mo, d, h, mi, s, timezoneId)
    result = new Date(tzDate.getTime())
  }
  // 4. String relativo — chrono-node con soporte español e inglés
  else {
    isRelative = true
    // Pasar el offset UTC en minutos para que chrono interprete la hora
    // en la zona horaria del negocio, no en la del servidor.
    const tzOffsetMinutes = getUtcOffsetMinutes(timezoneId, now)
    const chronoRef = { instant: now, timezone: tzOffsetMinutes }
    // Intentar inglés primero (más preciso con relativos como "tomorrow"),
    // luego español para inputs como "mañana a las 10".
    const parsed =
      chrono.parseDate(input, chronoRef) ??
      chrono.es.parseDate(input, chronoRef)

    if (!parsed) {
      throw new ParseError(`Cannot parse datetime input: "${input}"`, input)
    }
    result = parsed
  }

  if (isNaN(result.getTime())) {
    throw new ParseError(`Invalid date produced from input: "${String(input)}"`, input)
  }

  // Solo rechazar pasado para inputs relativos (no para ISO explícitos).
  // Comparar contra la referencia (o now) para que los tests con fecha fija funcionen.
  if (isRelative) {
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000)
    if (result < fiveMinutesAgo) {
      throw new ParseError(`Datetime is in the past: ${result.toISOString()}`, input)
    }
  }

  return result
}

// Helper: extrae partes numéricas de un string ISO local 'YYYY-MM-DDTHH:MM:SS'
// para el constructor por partes de TZDate
function parseLocalParts(iso: string): [number, number, number, number, number, number] {
  const [datePart, timePart = '00:00:00'] = iso.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour = 0, min = 0, sec = 0] = timePart.split(':').map(Number)
  return [year, month - 1, day, hour, min, sec]
}

// Helper: obtiene el offset UTC en minutos para una IANA timezone en una fecha dada
function getUtcOffsetMinutes(tzId: string, date: Date): number {
  const utcMs = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
  const tzMs  = new Date(date.toLocaleString('en-US', { timeZone: tzId })).getTime()
  return Math.round((tzMs - utcMs) / 60000)
}
