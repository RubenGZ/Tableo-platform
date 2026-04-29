// src/lib/ai/token-auth.ts
// Valida el token TABLEO_AI_TOKEN del header x-tableo-ai-token.
// Token único compartido para todos los LLMs (V1).
// Phase 4: cada negocio tendrá su propio token desde el dashboard.

export function validateAiToken(request: Request): boolean {
  const token = request.headers.get('x-tableo-ai-token')
  const expected = process.env.TABLEO_AI_TOKEN

  if (!expected) {
    console.error('[AI API] TABLEO_AI_TOKEN env var not set')
    return false
  }

  return token === expected
}
