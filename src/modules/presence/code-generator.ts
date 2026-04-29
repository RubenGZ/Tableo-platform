import { createServerClient } from '@/lib/supabase/server'

export function generateCode(): string {
  return Math.floor(1000 + Math.random() * 9000).toString()
}

export async function upsertPresenceCode(businessId: string): Promise<string> {
  const supabase = await createServerClient()
  const code = generateCode()
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()

  const { error } = await supabase
    .from('presence_codes')
    .upsert(
      { business_id: businessId, code, expires_at: expiresAt },
      { onConflict: 'business_id' },
    )

  if (error) throw new Error(error.message)
  return code
}
