// src/lib/ai/__tests__/date-normalizer.test.ts
import { describe, it, expect } from 'vitest'
import { normalizeDateTime } from '../date-normalizer'
import { ParseError } from '../types'

const MADRID_TZ = 'Europe/Madrid'
const UTC_TZ    = 'Atlantic/Reykjavik'

describe('normalizeDateTime', () => {
  it('pasa ISO UTC sin modificar', () => {
    const input = '2024-06-17T10:00:00Z'
    const result = normalizeDateTime(input, UTC_TZ)
    expect(result.toISOString()).toBe('2024-06-17T10:00:00.000Z')
  })

  it('interpreta ISO sin timezone como hora local del negocio (Madrid UTC+2 en verano)', () => {
    const result = normalizeDateTime('2024-06-17T10:00:00', MADRID_TZ)
    // 10:00 Madrid (UTC+2) = 08:00 UTC
    expect(result.getUTCHours()).toBe(8)
    expect(result.getUTCDate()).toBe(17)
  })

  it('parsea objeto Siri/Google { date, time }', () => {
    const result = normalizeDateTime({ date: '2024-06-17', time: '10:00' }, MADRID_TZ)
    expect(result.getUTCHours()).toBe(8)
    expect(result.getUTCDate()).toBe(17)
  })

  it('parsea objeto con hora sin minutos { date, time: "15" }', () => {
    const result = normalizeDateTime({ date: '2024-06-17', time: '15' }, UTC_TZ)
    expect(result.getUTCHours()).toBe(15)
  })

  it('parsea texto relativo en inglés "tomorrow at 3pm"', () => {
    const reference = new Date('2024-06-17T12:00:00Z') // lunes mediodía
    const result = normalizeDateTime('tomorrow at 3pm', UTC_TZ, reference)
    expect(result.getUTCHours()).toBe(15)
    expect(result.getUTCDate()).toBe(18) // martes
  })

  it('parsea texto relativo en español "mañana a las 10"', () => {
    const reference = new Date('2024-06-17T12:00:00Z')
    const result = normalizeDateTime('mañana a las 10', UTC_TZ, reference)
    expect(result.getUTCHours()).toBe(10)
    expect(result.getUTCDate()).toBe(18)
  })

  it('lanza ParseError si el input no puede parsearse', () => {
    expect(() => normalizeDateTime('xyzzy foo bar', UTC_TZ)).toThrow(ParseError)
  })

  it('lanza ParseError si la fecha resultante es en el pasado', () => {
    const reference = new Date('2024-06-17T12:00:00Z')
    expect(() =>
      normalizeDateTime('yesterday at 10am', UTC_TZ, reference)
    ).toThrow(ParseError)
  })
})
