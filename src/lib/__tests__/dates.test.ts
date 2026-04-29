import { describe, it, expect } from 'vitest'
import { toBusinessLocal, formatSlotTime, dayBoundsUTC } from '../dates'

describe('dayBoundsUTC', () => {
  it('devuelve los límites UTC correctos para timezone UTC+0', () => {
    const { startOfDay, endOfDay } = dayBoundsUTC('2024-06-15', 'Atlantic/Reykjavik')
    expect(startOfDay.getUTCHours()).toBe(0)
    expect(startOfDay.getUTCMinutes()).toBe(0)
    expect(endOfDay.getUTCHours()).toBe(23)
    expect(endOfDay.getUTCMinutes()).toBe(59)
  })

  it('devuelve los límites UTC correctos para Europe/Madrid (UTC+2 en verano)', () => {
    const { startOfDay } = dayBoundsUTC('2024-06-15', 'Europe/Madrid')
    // Medianoche en Madrid (UTC+2) = 22:00 UTC del día anterior
    expect(startOfDay.getUTCHours()).toBe(22)
    expect(startOfDay.getUTCDate()).toBe(14)
  })
})

describe('formatSlotTime', () => {
  it('formatea hora UTC a la hora local del negocio', () => {
    const utcDate = new Date('2024-06-15T10:00:00Z')
    expect(formatSlotTime(utcDate, 'Atlantic/Reykjavik')).toBe('10:00')
  })
})
