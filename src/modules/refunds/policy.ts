export type RefundScenario =
  | 'cancelled'
  | 'no_show_client'
  | 'no_show_business'
  | 'dispute_resolved_client'
  | 'dispute_resolved_business'

export type RefundType = 'stripe_refund' | 'tableo_credit' | 'partial_credit' | 'human_review' | 'none'

export interface RefundPolicy {
  type: RefundType
  percentage: number
}

interface PolicyInput {
  scenario: RefundScenario
  hoursUntilStart: number
}

export function determineRefundPolicy(input: PolicyInput): RefundPolicy {
  const { scenario, hoursUntilStart } = input

  if (scenario === 'cancelled') {
    return hoursUntilStart >= 24
      ? { type: 'stripe_refund', percentage: 100 }
      : { type: 'tableo_credit', percentage: 100 }
  }

  if (scenario === 'no_show_client') {
    return { type: 'tableo_credit', percentage: 50 }
  }

  if (scenario === 'no_show_business') {
    return { type: 'human_review', percentage: 0 }
  }

  if (scenario === 'dispute_resolved_client') {
    return { type: 'stripe_refund', percentage: 100 }
  }

  if (scenario === 'dispute_resolved_business') {
    return { type: 'none', percentage: 0 }
  }

  return { type: 'none', percentage: 0 }
}
