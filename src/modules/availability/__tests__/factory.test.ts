import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdapter } from '../factory'
import { BeautyAdapter } from '../beauty-adapter'

const mockSupabase = {} as SupabaseClient

describe('getAdapter', () => {
  it('devuelve un BeautyAdapter para sector beauty', () => {
    const adapter = getAdapter('beauty', mockSupabase)
    expect(adapter).toBeInstanceOf(BeautyAdapter)
    expect(adapter.sectorType).toBe('beauty')
  })

  it('lanza NotImplementedError para sector restaurant', () => {
    expect(() => getAdapter('restaurant', mockSupabase)).toThrow(
      'AvailabilityAdapter for sector "restaurant" is not implemented yet'
    )
  })

  it('lanza NotImplementedError para sector real_estate', () => {
    expect(() => getAdapter('real_estate', mockSupabase)).toThrow(
      'AvailabilityAdapter for sector "real_estate" is not implemented yet'
    )
  })
})
