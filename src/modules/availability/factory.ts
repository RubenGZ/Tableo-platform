// Factory that returns the correct adapter for a business sector.
// The motor NEVER imports BeautyAdapter directly — always goes through here.
// Adding a new sector in V2 = one new case here + new adapter file.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AvailabilityAdapter } from './types'
import type { SectorType } from '@/lib/db/types'
import { BeautyAdapter } from './beauty-adapter'

export function getAdapter(
  sectorType: SectorType,
  supabase: SupabaseClient
): AvailabilityAdapter {
  switch (sectorType) {
    case 'beauty':
      return new BeautyAdapter(supabase)
    case 'restaurant':
    case 'real_estate':
      throw new Error(
        `AvailabilityAdapter for sector "${sectorType}" is not implemented yet`
      )
    default: {
      const _exhaustive: never = sectorType
      throw new Error(`Unknown sector type: ${String(_exhaustive)}`)
    }
  }
}
