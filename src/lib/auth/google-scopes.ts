// src/lib/auth/google-scopes.ts
// Scopes requeridos en el OAuth de Google (ADR-008-B):
// - openid, email, profile: login básico
// - calendar: acceso al Google Calendar del dueño (necesario para confirmBooking en ADR-006)
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar',
] as const

export type GoogleScope = (typeof GOOGLE_SCOPES)[number]
