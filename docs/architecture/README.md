# Arquitectura de Tableo

## Architecture Decision Records (ADRs)

| ADR | Título | Estado |
|-----|--------|--------|
| [ADR-001](decisions/ADR-001-monolito-modular.md) | Arquitectura General — Monolito Modular | Accepted |
| [ADR-002](decisions/ADR-002-motor-disponibilidad-polimorfico.md) | Motor de Disponibilidad Polimórfico | Accepted |
| [ADR-003](decisions/ADR-003-schema-base-datos-unificado.md) | Schema de Base de Datos Unificado | Accepted |
| [ADR-004](decisions/ADR-004-control-concurrencia-two-phase-booking.md) | Control de Concurrencia — Two-Phase Booking | Accepted |
| [ADR-005](decisions/ADR-005-multitenancy-rls.md) | Multi-tenancy via Row Level Security | Accepted |
| [ADR-006](decisions/ADR-006-timezones-y-ui-por-sector.md) | Zonas Horarias + UI Components por Sector | Accepted |

## Diagrama de Capas

```
┌─────────────────────────────────────────────────────┐
│                  NEXT.JS APP                        │
│   (dashboard) │ (booking/[slug]) │ api/             │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│           AVAILABILITY ENGINE (ADR-002)             │
│         interfaz AvailabilityAdapter                │
└──────┬────────────────────────────────┬─────────────┘
       │                                │
┌──────▼──────┐                ┌────────▼─────┐
│BeautyAdapter│                │  [V2, V3...] │
│    (V1)     │                │  (futuro)    │
└──────┬──────┘                └──────────────┘
       │
┌──────▼──────────────────────────────────────────────┐
│         SUPABASE / PostgreSQL  (ADR-003)            │
│  businesses · resources · bookings · customers      │
│  RLS policies (ADR-005) · pg_cron (ADR-004)         │
└─────────────────────────────────────────────────────┘
```

## Principios de diseño

1. **El engine nunca importa adaptadores directamente** — usa el factory
2. **Toda tabla tiene RLS** — sin excepciones
3. **Archivos < 200 líneas** — si crece, extraer responsabilidad
4. **Sin condicionales por sector fuera de los adaptadores**
5. **Two-phase booking para toda operación de reserva** — nunca INSERT directo
