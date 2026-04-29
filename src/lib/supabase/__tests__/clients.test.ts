// src/lib/supabase/__tests__/clients.test.ts
import { describe, it, expect, vi, beforeAll } from 'vitest'

// Mock de next/headers para entorno de test (no existe en jsdom)
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({
    getAll: () => [],
    set: vi.fn(),
  })),
}))

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
})

describe('createBrowserClient', () => {
  it('se crea sin lanzar error', async () => {
    const { createBrowserClient } = await import('../client')
    expect(() => createBrowserClient()).not.toThrow()
  })
})

describe('createServerClient', () => {
  it('se crea sin lanzar error', async () => {
    const { createServerClient } = await import('../server')
    await expect(createServerClient()).resolves.toBeDefined()
  })
})
