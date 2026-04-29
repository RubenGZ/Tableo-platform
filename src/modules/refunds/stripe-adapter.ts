// Scaffold: Stripe is not integrated yet (future Phase).
// This module will be replaced when Stripe payment is active.

export async function issueStripeRefund(
  _paymentIntentId: string,
  _amountCents: number,
): Promise<{ refundId: string }> {
  // TODO: replace with real Stripe SDK call when payments are integrated
  throw new Error(
    'Stripe not integrated yet. Refund must be processed manually via Stripe Dashboard.',
  )
}
