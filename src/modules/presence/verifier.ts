import { createServerClient } from '@/lib/supabase/server'

const WINDOW_MS = 30 * 60 * 1000  // ±30 minutes

interface VerifyInput {
  bookingId: string
  code: string
  lat?: number
  lng?: number
}

interface VerifyResult {
  valid: boolean
  reason?: string
}

export async function verifyPresenceCode(input: VerifyInput): Promise<VerifyResult> {
  const supabase = await createServerClient()

  const { data: booking } = await supabase
    .from('bookings')
    .select('start_at, resources(business_id)')
    .eq('id', input.bookingId)
    .single()

  if (!booking) {
    return { valid: false, reason: 'booking not found' }
  }

  const startAt = new Date(booking.start_at).getTime()
  const now = Date.now()
  const delta = Math.abs(startAt - now)

  if (delta > WINDOW_MS) {
    await recordCheck(supabase, input, false)
    return { valid: false, reason: 'outside ±30 min window' }
  }

  const businessId = (booking.resources as unknown as { business_id: string }).business_id

  const { data: presenceCode } = await supabase
    .from('presence_codes')
    .select('code, expires_at')
    .eq('business_id', businessId)
    .single()

  if (!presenceCode) {
    await recordCheck(supabase, input, false)
    return { valid: false, reason: 'no active code for business' }
  }

  if (new Date(presenceCode.expires_at).getTime() < now) {
    await recordCheck(supabase, input, false)
    return { valid: false, reason: 'code expired' }
  }

  if (presenceCode.code !== input.code) {
    await recordCheck(supabase, input, false)
    return { valid: false, reason: 'code mismatch' }
  }

  await recordCheck(supabase, input, true)
  return { valid: true }
}

async function recordCheck(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  input: VerifyInput,
  valid: boolean,
): Promise<void> {
  await supabase.from('presence_checks').insert({
    booking_id: input.bookingId,
    code_used: input.code,
    valid,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
  })
}
