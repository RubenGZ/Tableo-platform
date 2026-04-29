// src/app/api/ai/book/route.ts
// Endpoint para reservas mediante LLMs (Gemini, Claude, GPT, Siri).
// Autenticado con TABLEO_AI_TOKEN en header x-tableo-ai-token.
// Las reservas se crean con status 'pending_ai_confirmation' — el negocio aprueba desde el dashboard.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAdapter } from '@/modules/availability/factory'
import { formatSlotTime } from '@/lib/dates'
import { validateAiToken } from '@/lib/ai/token-auth'
import { buildError } from '@/lib/ai/error-factory'
import { normalizeDateTime } from '@/lib/ai/date-normalizer'
import { ParseError } from '@/lib/ai/types'
import type { SectorType } from '@/lib/db/types'
import type { AiBookingRequest, AiSuccessResponse, AlternativeSlot } from '@/lib/ai/types'

export async function POST(request: Request) {
  // 1. Validar token
  if (!validateAiToken(request)) {
    return NextResponse.json(buildError('ERROR_INVALID_TOKEN'), { status: 401 })
  }

  // 2. Parsear body
  let body: AiBookingRequest
  try {
    body = await request.json() as AiBookingRequest
  } catch {
    return NextResponse.json(
      buildError('ERROR_MISSING_DATA', { missing: ['request body (invalid JSON)'] }),
      { status: 422 }
    )
  }

  // 3. Validar campos obligatorios
  const missing: string[] = []
  if (!body.business_slug) missing.push('business_slug')
  if (!body.resource_id)   missing.push('resource_id')
  if (!body.datetime)      missing.push('datetime')
  if (!body.customer?.name) missing.push('customer.name')

  if (missing.length > 0) {
    return NextResponse.json(
      buildError('ERROR_MISSING_DATA', { missing }),
      { status: 422 }
    )
  }

  const supabase = await createServerClient()

  // 4. Buscar el negocio por slug
  const { data: business } = await supabase
    .from('businesses')
    .select('id, name, sector_type, timezone_id, config')
    .eq('slug', body.business_slug)
    .single()

  if (!business) {
    return NextResponse.json(
      buildError('ERROR_BUSINESS_NOT_FOUND', { slug: body.business_slug }),
      { status: 404 }
    )
  }

  // 5. Normalizar fecha/hora
  let startAt: Date
  try {
    startAt = normalizeDateTime(body.datetime, business.timezone_id)
  } catch (err) {
    if (err instanceof ParseError) {
      return NextResponse.json(
        buildError('ERROR_INVALID_DATETIME', {
          input: typeof body.datetime === 'string'
            ? body.datetime
            : JSON.stringify(body.datetime),
        }),
        { status: 422 }
      )
    }
    throw err
  }

  // 6. Verificar disponibilidad del slot
  const adapter = getAdapter(business.sector_type as SectorType, supabase)
  const dateStr = startAt.toISOString().split('T')[0]
  const slots = await adapter.getSlots(body.resource_id, dateStr, business.timezone_id)

  // Buscar el slot que corresponde a startAt (tolerancia 1 minuto)
  const requestedSlot = slots.find(
    s => Math.abs(s.startAt.getTime() - startAt.getTime()) < 60_000
  )

  if (!requestedSlot) {
    // Slot no disponible — devolver las 3 alternativas más cercanas
    const alternatives: AlternativeSlot[] = slots
      .filter(s => s.startAt > new Date())
      .slice(0, 3)
      .map(s => ({
        start_at:  s.startAt.toISOString(),
        end_at:    s.endAt.toISOString(),
        formatted: formatSlotTime(s.startAt, business.timezone_id),
      }))

    return NextResponse.json(
      buildError('ERROR_CAPACITY_FULL', {
        slot:         formatSlotTime(startAt, business.timezone_id),
        business:     business.name,
        alternatives,
      }),
      { status: 409 }
    )
  }

  const endAt = requestedSlot.endAt

  // 7. Upsert cliente (by phone OR email, scoped to business_id)
  const orConditions = [
    body.customer.phone ? `phone.eq.${body.customer.phone}` : null,
    body.customer.email ? `email.eq.${body.customer.email}` : null,
  ].filter((c): c is string => c !== null)

  let customerId: string

  if (orConditions.length > 0) {
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id')
      .eq('business_id', business.id)
      .or(orConditions.join(','))
      .maybeSingle()

    if (existingCustomer?.id) {
      customerId = existingCustomer.id
    } else {
      const { data: newCustomer, error: customerError } = await supabase
        .from('customers')
        .insert({
          business_id: business.id,
          name:  body.customer.name,
          phone: body.customer.phone ?? null,
          email: body.customer.email ?? null,
        })
        .select('id')
        .single()

      if (customerError || !newCustomer) {
        console.error('[AI API] Error inserting customer:', customerError)
        return NextResponse.json(
          buildError('ERROR_MISSING_DATA', { missing: ['customer could not be created'] }),
          { status: 422 }
        )
      }
      customerId = newCustomer.id
    }
  } else {
    // Sin phone ni email — insertar cliente con solo el nombre
    const { data: newCustomer, error: customerError } = await supabase
      .from('customers')
      .insert({
        business_id: business.id,
        name:  body.customer.name,
        phone: null,
        email: null,
      })
      .select('id')
      .single()

    if (customerError || !newCustomer) {
      console.error('[AI API] Error inserting anonymous customer:', customerError)
      return NextResponse.json(
        buildError('ERROR_MISSING_DATA', { missing: ['customer.phone or customer.email (recommended for identification)'] }),
        { status: 422 }
      )
    }
    customerId = newCustomer.id
  }

  // 8. Verificar duplicate booking
  const { data: duplicate, error: duplicateError } = await supabase
    .from('bookings')
    .select('id')
    .eq('customer_id', customerId)
    .eq('resource_id', body.resource_id)
    .in('status', ['reserved', 'confirmed', 'pending_ai_confirmation'])
    .lt('start_at', endAt.toISOString())
    .gt('end_at', startAt.toISOString())
    .maybeSingle()

  if (duplicateError) {
    console.error('[AI API] Error checking duplicate booking:', duplicateError)
  }

  if (duplicate) {
    return NextResponse.json(
      buildError('ERROR_DUPLICATE_BOOKING', {
        name:     body.customer.name,
        business: business.name,
      }),
      { status: 409 }
    )
  }

  // 9. Insertar reserva con status pending_ai_confirmation
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .insert({
      resource_id:  body.resource_id,
      customer_id:  customerId,
      start_at:     startAt.toISOString(),
      end_at:       endAt.toISOString(),
      status:       'pending_ai_confirmation' as const,
      ai_source:    true,
      metadata: {
        service:         body.service ?? null,
        notes:           body.notes ?? null,
        ai_requested_by: body.customer.name,
      },
    })
    .select('id')
    .single()

  if (bookingError || !booking) {
    console.error('[AI API] Error inserting booking:', bookingError)
    return NextResponse.json(
      buildError('ERROR_MISSING_DATA', { missing: ['booking insert failed — check server logs'] }),
      { status: 500 }
    )
  }

  // 10. Respuesta de éxito
  const slotFormatted = formatSlotTime(startAt, business.timezone_id)
  const successResponse: AiSuccessResponse = {
    booking_id:  booking.id,
    status:      'pending_ai_confirmation',
    start_at:    startAt.toISOString(),
    end_at:      endAt.toISOString(),
    message_for_ai: 'Booking created successfully with status pending_ai_confirmation. Business owner must confirm before it becomes active.',
    suggested_user_prompt: `¡Perfecto! He solicitado tu cita en ${business.name} para las ${slotFormatted}. El negocio la confirmará en breve y te avisaremos cuando esté lista. ¿Necesitas algo más?`,
  }

  return NextResponse.json(successResponse, { status: 201 })
}
