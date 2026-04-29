// src/lib/ai/types.ts

export interface AiBookingRequest {
  business_slug: string
  resource_id: string
  datetime: string | { date: string; time: string }
  duration_minutes?: number
  customer: {
    name: string
    phone?: string
    email?: string
  }
  service?: string
  notes?: string
}

export type AiErrorCode =
  | 'ERROR_CAPACITY_FULL'
  | 'ERROR_MISSING_DATA'
  | 'ERROR_INVALID_DATETIME'
  | 'ERROR_DUPLICATE_BOOKING'
  | 'ERROR_BUSINESS_NOT_FOUND'
  | 'ERROR_INVALID_TOKEN'

export interface AlternativeSlot {
  start_at: string   // ISO UTC
  end_at: string     // ISO UTC
  formatted: string  // 'HH:mm' en timezone del negocio
}

export interface AiErrorResponse {
  code: AiErrorCode
  message_for_ai: string
  suggested_user_prompt: string
  alternative_slots?: AlternativeSlot[]  // solo cuando code = ERROR_CAPACITY_FULL
}

export interface AiSuccessResponse {
  booking_id: string
  status: 'pending_ai_confirmation'
  start_at: string
  end_at: string
  message_for_ai: string
  suggested_user_prompt: string
}

// Error interno lanzado por normalizeDateTime
export class ParseError extends Error {
  constructor(
    message: string,
    public readonly input: unknown
  ) {
    super(message)
    this.name = 'ParseError'
  }
}
