// src/lib/ai/error-factory.ts
// Construye respuestas de error conversacionales para LLMs.
// El LLM usa message_for_ai para entender el contexto técnico.
// El LLM usa suggested_user_prompt para comunicarlo al usuario final.

import type { AiErrorCode, AiErrorResponse, AlternativeSlot } from './types'

interface ErrorContext {
  missing?: string[]           // para ERROR_MISSING_DATA
  input?: string               // para ERROR_INVALID_DATETIME
  slot?: string                // para ERROR_CAPACITY_FULL (hora solicitada, ej. "10:00")
  business?: string            // nombre del negocio
  name?: string                // nombre del cliente
  slug?: string                // para ERROR_BUSINESS_NOT_FOUND
  alternatives?: AlternativeSlot[]  // para ERROR_CAPACITY_FULL
}

export function buildError(
  code: AiErrorCode,
  context: ErrorContext = {}
): AiErrorResponse {
  switch (code) {
    case 'ERROR_CAPACITY_FULL': {
      const alts = context.alternatives ?? []
      const altTimes = alts.slice(0, 3).map(a => a.formatted).join(', ')
      return {
        code,
        message_for_ai: `The requested slot ${context.slot ?? ''} is not available for the requested resource. ${alts.length} alternative slots found.`,
        suggested_user_prompt: altTimes
          ? `Lo siento, ${context.slot ? `a las ${context.slot}` : 'en ese horario'} ya no hay disponibilidad en ${context.business ?? 'el negocio'}. ¿Te vendría bien a las ${altTimes}?`
          : `Lo siento, no hay disponibilidad en ese horario en ${context.business ?? 'el negocio'}. ¿Quieres que busque otro día?`,
        alternative_slots: alts.slice(0, 3),
      }
    }

    case 'ERROR_MISSING_DATA': {
      const missing = context.missing?.join(', ') ?? 'campos requeridos'
      return {
        code,
        message_for_ai: `Required fields missing from request: ${missing}`,
        suggested_user_prompt: `Para hacer la reserva necesito que me indiques: ${missing}.`,
      }
    }

    case 'ERROR_INVALID_DATETIME':
      return {
        code,
        message_for_ai: `Cannot parse datetime input: "${context.input ?? 'unknown'}". Expected ISO 8601, relative date, or {date, time} object.`,
        suggested_user_prompt: `No he entendido bien la fecha "${context.input ?? ''}". ¿Puedes decirme el día y la hora con más detalle? Por ejemplo: "el lunes a las 10 de la mañana".`,
      }

    case 'ERROR_DUPLICATE_BOOKING':
      return {
        code,
        message_for_ai: `Customer ${context.name ?? ''} already has a booking at the requested time slot.`,
        suggested_user_prompt: `Parece que ${context.name ?? 'este cliente'} ya tiene una cita en ${context.business ?? 'el negocio'} a esa hora. ¿Quieres cambiarla o es para otra persona?`,
      }

    case 'ERROR_BUSINESS_NOT_FOUND':
      return {
        code,
        message_for_ai: `Business with slug "${context.slug ?? ''}" not found in the database.`,
        suggested_user_prompt: `No he encontrado el negocio "${context.slug ?? ''}". ¿Puedes confirmar el nombre exacto del negocio?`,
      }

    case 'ERROR_INVALID_TOKEN':
      return {
        code,
        message_for_ai: 'Invalid or missing x-tableo-ai-token header.',
        suggested_user_prompt: 'No tengo autorización para hacer reservas en este momento. Por favor, contacta directamente con el negocio.',
      }
  }
}
