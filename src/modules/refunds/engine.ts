import { createServerClient } from '@/lib/supabase/server'
import { determineRefundPolicy } from './policy'
import { issueStripeRefund } from './stripe-adapter'
import type { RefundScenario } from './policy'

interface ExecuteRefundInput {
  bookingId: string
  scenario: RefundScenario
  hoursUntilStart: number
}

export async function executeRefund(input: ExecuteRefundInput): Promise<void> {
  const supabase = await createServerClient()

  const { data: booking } = await supabase
    .from('bookings')
    .select('amount_cents, stripe_payment_intent_id')
    .eq('id', input.bookingId)
    .single()

  if (!booking) throw new Error(`Booking ${input.bookingId} not found`)

  const policy = determineRefundPolicy({
    scenario: input.scenario,
    hoursUntilStart: input.hoursUntilStart,
  })

  const refundAmount = Math.floor(booking.amount_cents * (policy.percentage / 100))

  let stripeRefundId: string | null = null
  let status: 'pending' | 'processed' | 'failed' = 'pending'

  if (policy.type === 'stripe_refund' && booking.stripe_payment_intent_id) {
    try {
      const result = await issueStripeRefund(booking.stripe_payment_intent_id, refundAmount)
      stripeRefundId = result.refundId
      status = 'processed'
    } catch {
      status = 'failed'
    }
  } else if (policy.type === 'tableo_credit' || policy.type === 'partial_credit') {
    status = 'processed'
  } else if (policy.type === 'human_review' || policy.type === 'none') {
    status = 'pending'
  }

  await supabase.from('refund_transactions').insert({
    booking_id: input.bookingId,
    amount_cents: refundAmount,
    currency: 'EUR',
    type: policy.type === 'human_review' ? 'stripe_refund' : policy.type,
    reason: input.scenario,
    stripe_refund_id: stripeRefundId,
    status,
  })

  await supabase.from('audit_logs').insert({
    entity_type: 'refund',
    entity_id: input.bookingId,
    action: 'refund_initiated',
    actor_type: 'system',
    metadata: { scenario: input.scenario, policy, refundAmount, status },
  })
}
