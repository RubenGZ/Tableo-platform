# ADR-002: Motor de Disponibilidad Polimórfico

**Status:** Accepted  
**Date:** 2026-04-27  
**Deciders:** Equipo Tableo

## Context

Tableo necesita calcular disponibilidad de slots para múltiples sectores con lógicas radicalmente distintas:
- **Belleza (V1):** disponibilidad = profesional libre en franja horaria dado un servicio de N minutos
- **Restaurantes (V2):** disponibilidad = mesa con capacidad suficiente para el grupo en turno activo
- **Inmobiliaria (V3):** disponibilidad = activo no ocupado en ventana de inspección

El riesgo principal es introducir condicionales `if sector === 'beauty'` en el núcleo del sistema, lo que produce código espagueti inmantenible a medida que se añaden verticales.

## Decision

Implementar un **Motor de Disponibilidad Polimórfico** basado en el patrón Strategy + Factory. El engine define una interfaz `AvailabilityAdapter` y nunca importa adaptadores directamente. Cada sector implementa su propio adaptador que se registra en un factory al inicializar la aplicación.

## Options Considered

### Option A: Motor Polimórfico con Factory ✅ ELEGIDO

```typescript
// src/availability/types.ts
export interface AvailabilityAdapter {
  getSlots(params: GetSlotsParams): Promise<Slot[]>
  validateBooking(request: BookingRequest): Promise<ValidationResult>
  lockSlot(slotId: string, sessionId: string): Promise<LockResult>
}

// src/availability/engine.ts  
// El engine NUNCA importa adaptadores directamente
export function createEngine(sectorType: SectorType): AvailabilityAdapter {
  const adapter = adapterRegistry.get(sectorType)
  if (!adapter) throw new Error(`No adapter for sector: ${sectorType}`)
  return adapter
}

// src/availability/adapters/beauty.adapter.ts
// Registra automáticamente al importar el módulo
adapterRegistry.register('beauty', new BeautyAdapter())
```

| Dimensión | Evaluación |
|-----------|------------|
| Extensibilidad | Máxima — añadir sector = nuevo archivo |
| Aislamiento de cambios | Total — editar beauty no toca restaurants |
| Testabilidad | Alta — cada adaptador se testea en aislamiento |
| AI-friendliness | Alta — cada adaptador < 150 líneas |
| Complejidad | Media — requiere disciplina en la interfaz |

**Pros:**
- Añadir V2 (restaurantes) = crear `restaurant.adapter.ts` sin tocar el engine
- Tests unitarios completamente aislados por sector
- Claude Code edita un adaptador sin riesgo de romper otro
- La interfaz fuerza consistencia entre sectores

**Cons:**
- La interfaz debe ser diseñada correctamente desde el inicio — cambiarla después requiere actualizar todos los adaptadores
- El patrón de registro puede ser confuso para devs nuevos

### Option B: Switch/Case centralizado en el engine

```typescript
// Anti-patrón — lo que NO hacemos
function getSlots(sector: string, params: any) {
  if (sector === 'beauty') { /* 100 líneas */ }
  else if (sector === 'restaurant') { /* 150 líneas */ }
  else if (sector === 'real_estate') { /* 120 líneas */ }
}
```

**Pros:** Simple de entender inicialmente.

**Cons:** El archivo crece 150 líneas por cada sector. En V3 ya nadie entiende el código. Claude Code empieza a cometer errores al editar archivos de 500+ líneas con lógica mezclada. Inaceptable.

### Option C: Funciones independientes sin interfaz común

**Pros:** Máxima libertad por sector.

**Cons:** Sin interfaz común, no hay garantía de que los sectores sean intercambiables. Las API routes necesitarían conocer el sector para llamar a la función correcta — el problema de los condicionales se desplaza hacia arriba.

## Interfaz Completa del Motor

```typescript
// src/availability/types.ts

export type SectorType = 'beauty' | 'restaurant' | 'real_estate'

export interface Slot {
  id: string
  resourceId: string
  startAt: Date
  endAt: Date
  status: 'available' | 'reserved' | 'confirmed' | 'blocked'
  capacity: number          // 1 para belleza, N para mesas
  metadata: Record<string, unknown>
}

export interface GetSlotsParams {
  businessId: string
  resourceIds?: string[]    // undefined = todos los recursos del negocio
  dateRange: { from: Date; to: Date }
  duration?: number         // minutos — relevante para belleza
  partySize?: number        // personas — relevante para restaurantes
}

export interface BookingRequest {
  slotId: string
  customerId: string
  sessionId: string         // para el two-phase booking
  metadata: Record<string, unknown>
}

export interface ValidationResult {
  valid: boolean
  reason?: string
}

export interface LockResult {
  success: boolean
  reservedUntil?: Date
  bookingId?: string
}

export interface AvailabilityAdapter {
  getSlots(params: GetSlotsParams): Promise<Slot[]>
  validateBooking(request: BookingRequest): Promise<ValidationResult>
  lockSlot(request: BookingRequest): Promise<LockResult>
  confirmBooking(bookingId: string): Promise<void>
  releaseSlot(bookingId: string): Promise<void>
}
```

## Trade-off Analysis

El patrón Factory añade una capa de indirección que tiene un coste de comprensión inicial. Sin embargo, el beneficio es estructural: garantiza que añadir V2 (restaurantes) sea un cambio aditivo puro, sin modificar código existente. Esto es crítico en un equipo donde Claude Code genera gran parte del código — la IA trabaja mejor con archivos pequeños y contratos claros.

## Consequences

- ✅ Añadir un sector nuevo = crear un archivo, registrar en factory, cero cambios en el engine
- ✅ Claude Code puede editar `beauty.adapter.ts` con contexto completo del adaptador
- ✅ Tests de cada adaptador son completamente independientes
- ⚠️ La interfaz `AvailabilityAdapter` es un contrato sagrado — cambiarla requiere actualizar todos los adaptadores existentes. Diseñarla bien en V1 es crítico.
- ⚠️ El `metadata: Record<string, unknown>` en Slot y BookingRequest debe ser tipado progresivamente con tipos discriminados por sector

## Action Items

1. [ ] Diseñar y revisar la interfaz `AvailabilityAdapter` antes de escribir el primer adaptador
2. [ ] Implementar `BeautyAdapter` como implementación de referencia
3. [ ] Crear tests unitarios del `BeautyAdapter` con slots de ejemplo reales
4. [ ] Documentar el contrato de la interfaz con JSDoc para que Claude Code lo respete en futuros adaptadores
5. [ ] Añadir test de integración que valide que el factory devuelve el adaptador correcto por `sectorType`
