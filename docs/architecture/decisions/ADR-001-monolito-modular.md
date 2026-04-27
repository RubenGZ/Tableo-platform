# ADR-001: Arquitectura General — Monolito Modular

**Status:** Accepted  
**Date:** 2026-04-27  
**Deciders:** Equipo Tableo (2 founders + Claude Code)

## Context

Tableo es una plataforma de reservas sector-agnostic que en V1 cubre Belleza & Bienestar (competidor directo de Booksy). El equipo es de 2 personas que usan Claude Code como herramienta de desarrollo principal. El MVP debe estar en producción en 4-6 semanas con arquitectura extensible a nuevos verticales sin reescritura.

Las opciones consideradas deben resolver:
- Velocidad de desarrollo (2 personas + IA)
- Extensibilidad a nuevos sectores (restaurantes, inmobiliaria) sin deuda técnica
- Coste de infraestructura bajo (~€60/mes para 100 negocios)
- Archivos cortos y enfocados para que Claude Code razone correctamente

## Decision

Adoptar **Monolito Modular** sobre Next.js con separación interna por dominio y Motor de Disponibilidad Polimórfico como capa de abstracción entre sectores.

## Options Considered

### Option A: Monolito Modular ✅ ELEGIDO

| Dimensión | Evaluación |
|-----------|------------|
| Complejidad inicial | Baja |
| Coste infra | ~€45/mes (Vercel Pro + Supabase Pro) |
| Escalabilidad | Alta hasta ~500k MAU sin cambios |
| Familiaridad del equipo | Alta (Next.js + Supabase son el stack conocido) |
| AI-friendliness | Alta — archivos cortos, responsabilidades claras |

**Pros:**
- Un solo repo, un solo deploy, cero overhead de orquestación
- Claude Code genera código correcto en archivos enfocados (<200 líneas)
- Separación interna por módulos evita el spaghetti sin la complejidad de microservicios
- Supabase gestiona la infraestructura de base de datos

**Cons:**
- Escalar un componente específico (ej. el engine de disponibilidad) requiere escalar todo el monolito
- Si el equipo crece a 10+ devs, el monolito puede generar conflictos de merge

### Option B: BFF + Edge Functions

| Dimensión | Evaluación |
|-----------|------------|
| Complejidad inicial | Media-Alta |
| Coste infra | ~€80/mes |
| Escalabilidad | Muy Alta |
| AI-friendliness | Media — más archivos, más contexto necesario |

**Pros:** Separación clara entre frontend y lógica de disponibilidad. Edge functions escalan independientemente.

**Cons:** Latencia adicional entre capas. Más complejidad de deploy. Innecesario para el volumen del MVP.

### Option C: Microservicios desde el día 1

| Dimensión | Evaluación |
|-----------|------------|
| Complejidad inicial | Muy Alta |
| Coste infra | ~€200+/mes |
| Escalabilidad | Máxima |
| AI-friendliness | Baja — contexto fragmentado entre servicios |

**Pros:** Escala y deploys independientes por servicio.

**Cons:** 3x el trabajo de infraestructura antes de escribir producto. Overkill para 2 personas. Claude Code pierde contexto entre repos.

## Trade-off Analysis

El Monolito Modular sacrifica la escalabilidad granular de los microservicios a cambio de velocidad de desarrollo y simplicidad operacional. Para un equipo de 2 personas en early stage, esta es la decisión correcta: los monolitos modulares de Shopify, GitHub y Basecamp aguantaron millones de usuarios. La clave es la disciplina de modularización interna desde el día 1, no la separación en servicios.

La regla de oro: si en el futuro el engine de disponibilidad necesita escalar independientemente, extraerlo a un servicio propio es un refactor de días, no de semanas, porque los límites del módulo ya están definidos.

## Consequences

- ✅ MVP en producción en 4-6 semanas es alcanzable
- ✅ Claude Code puede trabajar en archivos enfocados sin perder contexto
- ✅ Un solo `vercel deploy` para todo el sistema
- ⚠️ Al crecer el equipo (>5 devs), revisar si extraer el Availability Engine como servicio independiente
- ⚠️ Los límites de módulo deben respetarse con disciplina — no importar entre módulos directamente

## Action Items

1. [ ] Crear estructura de directorios `src/{app,availability,modules,lib}` en el scaffold inicial
2. [ ] Definir regla de ESLint que prohíba importaciones cruzadas entre módulos (`import/no-restricted-paths`)
3. [ ] Documentar en CONTRIBUTING.md la norma de tamaño máximo de archivo (<200 líneas)
