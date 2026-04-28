import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockUpsert = vi.fn().mockResolvedValue({ error: null })

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() => ({
    from: vi.fn(() => ({ upsert: mockUpsert })),
  })),
}))

describe('generateCode', () => {
  it('returns a 4-digit string', async () => {
    const { generateCode } = await import('../code-generator')
    const code = generateCode()
    expect(code).toMatch(/^\d{4}$/)
  })

  it('always returns a different code (statistically)', async () => {
    const { generateCode } = await import('../code-generator')
    const codes = new Set(Array.from({ length: 20 }, generateCode))
    expect(codes.size).toBeGreaterThan(1)
  })
})

describe('upsertPresenceCode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('upserts code with 5-minute expiry for the business', async () => {
    const { upsertPresenceCode } = await import('../code-generator')
    const before = Date.now()

    await upsertPresenceCode('business-abc')

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: 'business-abc',
        code: expect.stringMatching(/^\d{4}$/),
        expires_at: expect.any(String),
      }),
      expect.objectContaining({ onConflict: 'business_id' }),
    )

    const callArg = mockUpsert.mock.calls[0][0]
    const expiresAt = new Date(callArg.expires_at).getTime()
    expect(expiresAt).toBeGreaterThan(before + 4 * 60 * 1000)
    expect(expiresAt).toBeLessThan(before + 6 * 60 * 1000)
  })

  it('returns the generated code', async () => {
    const { upsertPresenceCode } = await import('../code-generator')
    const code = await upsertPresenceCode('business-abc')
    expect(code).toMatch(/^\d{4}$/)
  })

  it('throws when Supabase returns an error', async () => {
    mockUpsert.mockResolvedValueOnce({ error: { message: 'db error' } })
    const { upsertPresenceCode } = await import('../code-generator')
    await expect(upsertPresenceCode('business-abc')).rejects.toThrow('db error')
  })
})
