import { describe, it, expect } from 'vitest'
import { determineRefundPolicy } from '../policy'

describe('determineRefundPolicy', () => {
  it('cancellation > 24h → stripe_refund 100%', () => {
    const policy = determineRefundPolicy({ scenario: 'cancelled', hoursUntilStart: 36 })
    expect(policy.type).toBe('stripe_refund')
    expect(policy.percentage).toBe(100)
  })

  it('cancellation < 24h → tableo_credit 100%', () => {
    const policy = determineRefundPolicy({ scenario: 'cancelled', hoursUntilStart: 12 })
    expect(policy.type).toBe('tableo_credit')
    expect(policy.percentage).toBe(100)
  })

  it('cancellation exactly 24h → stripe_refund 100%', () => {
    const policy = determineRefundPolicy({ scenario: 'cancelled', hoursUntilStart: 24 })
    expect(policy.type).toBe('stripe_refund')
    expect(policy.percentage).toBe(100)
  })

  it('no-show client (no presence code) → tableo_credit 50%', () => {
    const policy = determineRefundPolicy({ scenario: 'no_show_client', hoursUntilStart: 0 })
    expect(policy.type).toBe('tableo_credit')
    expect(policy.percentage).toBe(50)
  })

  it('no-show business (client has valid code) → human_review', () => {
    const policy = determineRefundPolicy({ scenario: 'no_show_business', hoursUntilStart: 0 })
    expect(policy.type).toBe('human_review')
    expect(policy.percentage).toBe(0)
  })

  it('dispute resolved pro-client → stripe_refund 100%', () => {
    const policy = determineRefundPolicy({ scenario: 'dispute_resolved_client', hoursUntilStart: 0 })
    expect(policy.type).toBe('stripe_refund')
    expect(policy.percentage).toBe(100)
  })

  it('dispute resolved pro-business → none', () => {
    const policy = determineRefundPolicy({ scenario: 'dispute_resolved_business', hoursUntilStart: 0 })
    expect(policy.type).toBe('none')
    expect(policy.percentage).toBe(0)
  })
})
