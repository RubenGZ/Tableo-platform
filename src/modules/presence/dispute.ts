import { createServerClient } from '@/lib/supabase/server'

type DisputeReason = 'presence_conflict' | 'refund_claim' | 'cash_discrepancy'

interface OpenDisputeInput {
  bookingId: string
  reason: DisputeReason
  evidence: Record<string, unknown>
}

export async function openDispute(input: OpenDisputeInput): Promise<void> {
  const supabase = createServerClient()

  const { error: disputeError } = await supabase.from('disputes').insert({
    booking_id: input.bookingId,
    reason: input.reason,
    status: 'open',
    evidence: input.evidence,
  })

  if (disputeError) throw new Error(disputeError.message)

  const bookingsQuery = supabase.from('bookings')
  bookingsQuery.eq('id', input.bookingId)
  await bookingsQuery.update({ status: 'disputed' })

  await supabase.from('audit_logs').insert({
    entity_type: 'dispute',
    entity_id: input.bookingId,
    action: 'dispute_opened',
    actor_type: 'system',
    metadata: { reason: input.reason },
  })
}
