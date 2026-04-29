// src/app/(booking)/[slug]/layout.tsx
import { createServerClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type { Business } from '@/lib/db/types'

export default async function BookingLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createServerClient()

  const { data: business } = await supabase
    .from('businesses')
    .select('id, name, config')
    .eq('slug', slug)
    .single<Pick<Business, 'id' | 'name' | 'config'>>()

  if (!business) notFound()

  const branding = business.config?.branding ?? {}

  return (
    <div
      style={{
        '--color-accent': branding.accent_color ?? '#7c6dff',
        '--color-accent-dark': branding.accent_dark ?? '#5a4fe0',
      } as React.CSSProperties}
    >
      {children}
    </div>
  )
}
