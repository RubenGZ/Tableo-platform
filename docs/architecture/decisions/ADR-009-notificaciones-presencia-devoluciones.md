# ADR-009: Notificaciones, Verificación de Presencia y Motor de Devoluciones

**Status:** Accepted  
**Date:** 2026-04-28  
**Deciders:** Equipo Tableo  
**Origen:** Diseño Grupo A — Capa de Confianza y Notificaciones

## Context

Con el motor de reservas definido (ADR-002, ADR-004), Tableo necesita tres capas complementarias para operar con confianza en producción:

1. **Notificaciones:** comunicar confirmaciones y recordatorios sin coste de infraestructura
2. **Verificación de presencia:** eliminar fraude bilateral (negocio finge no-shows para evitar comisión; cliente finge presencia para recibir devolución)
3. **Devoluciones:** política que protege a las tres partes (cliente, negocio, Tableo)

## Decisions

### A — Capa de Notificaciones: Patrón Adapter Multi-Canal

Misma arquitectura que `AvailabilityAdapter` (ADR-002). Interfaz `NotificationProvider` — el sistema no sabe qué proveedor está activo.

**Proveedores por orden de prioridad:**

| Canal | Proveedor | Coste | Activación |
|-------|-----------|-------|------------|
| PWA Push | Web Push API nativa | €0 | Cliente acepta notificaciones |
| Email | Resend | €0 hasta 3.000/mes | Siempre activo |
| WhatsApp | Baileys (WhatsApp Web unofficial) | €0 + SIM €5-10 única | Tableo configura en servidor |
| SMS | Twilio | $0.02/SMS coste → $0.05 PVP | Negocio activa (upsell) |

**WhatsApp/Baileys — decisión consciente:**
Baileys reverse-engineerea WhatsApp Web. Viola ToS de Meta. Riesgo aceptado porque:
- Email + PWA son el canal primario — si Baileys cae, cero impacto crítico
- Reemplazar SIM baneada tarda minutos
- Coste de alternativa oficial (~$0.024/mensaje) es inaceptable para MVP

**Template de WhatsApp (único, fijo):**
> *"Hola {nombre} 👋 Tu cita en {negocio} es hoy a las {hora}. Si necesitas cancelar: {link}. ¡Hasta pronto!"*

**Scheduler:** `pg_cron` ejecuta cada minuto, selecciona bookings confirmados con `start_at` entre 60-61 minutos en el futuro y dispara notificaciones.

### B — Verificación de Presencia: Código Rotativo Bilateral

**Mecanismo:** Código de 4 dígitos generado por el dashboard del negocio, renovado automáticamente cada 5 minutos. El cliente lo introduce en su página de reserva al llegar físicamente.

**Por qué no OTP unilateral ni GPS solo:**
- OTP enviado al cliente: el negocio puede negar haberlo visto
- GPS solo: el cliente puede falsificar coordenadas con apps triviales
- Código del negocio: requiere presencia física — el negocio no puede negar que lo proporcionó, el cliente no puede obtenerlo remotamente

**Crosscheck anti-fraude:**

```
Cliente tiene código válido + negocio marca no-show
→ Disputa automática + fondos retenidos + revisión humana Tableo (24-48h)
→ NUNCA resolución automática en caso de conflicto

Nadie confirma presencia
→ No-show real → política de devoluciones sin disputa

Ambos confirman
→ completed, comisión normal
```

**Ventana temporal válida:** ±30 minutos desde el inicio de la cita. Fuera de esa ventana el código no es válido aunque sea correcto.

### C — Motor de Devoluciones: Política Híbrida

**Regla de decisión basada en tiempo y evidencia:**

| Escenario | Resolución | Justificación |
|-----------|-----------|---------------|
| Cancelación >24h | Reembolso Stripe 100% | Cliente no generó coste al negocio |
| Cancelación <24h | Crédito Tableo 100% | Negocio pierde slot — cliente rebookea |
| No-show cliente (sin código) | Crédito Tableo 50% | Penalización moderada, no abusiva |
| No-show negocio (cliente tiene código) | Disputa → humano decide | No hay resolución automática — evidencia ambigua posible |
| Disputa resuelta pro-cliente | Reembolso Stripe 100% | Negocio demostró mala fe |
| Disputa resuelta pro-negocio | Sin reembolso | Cliente intentó defraudar |

**No hay resolución automática en disputas.** La automatización solo actúa en casos sin ambigüedad (nadie confirma = no-show, ambos confirman = asistencia).

## Tablas nuevas

```sql
notification_log    -- historial de notificaciones enviadas por booking
presence_codes      -- código activo por negocio (TTL 5 min, UNIQUE por business_id)
presence_checks     -- check-ins de clientes (código + timestamp + GPS opcional)
disputes            -- cola de conflictos (revisión manual Tableo)
audit_logs          -- trazabilidad completa de todas las acciones del sistema
refund_transactions -- historial de devoluciones (Stripe + créditos internos)
```

**Regla:** Todas las tablas nuevas tienen RLS activado desde su migración. Sin excepciones (ADR-005).

## Consequences

- ✅ Fraude bilateral eliminado sin fricciones UX innecesarias — el código rotativo es el único paso extra
- ✅ Notificaciones a coste €0 con fallback automático si WhatsApp cae
- ✅ Política de devoluciones clara para cliente, negocio y Tableo antes de que exista un primer conflicto
- ✅ Audit trail completo para cualquier disputa legal futura
- ⚠️ WhatsApp/Baileys puede ser baneado — Email + PWA deben estar siempre operativos primero
- ⚠️ El panel de revisión de disputas (interfaz interna Tableo) se construye post-MVP — inicialmente las disputas se gestionan directamente desde Supabase Dashboard
- ⚠️ `refunds/engine.ts` depende de la integración de Stripe (pagos) — implementar cuando Stripe esté activo
- ⚠️ SMS upsell requiere cuenta Twilio verificada antes de activarlo

## Action Items

1. [ ] Crear migración `005_trust_notifications.sql` con las 6 tablas nuevas + RLS
2. [ ] Implementar `NotificationProvider` interface y los 4 providers
3. [ ] Configurar pg_cron para rotación de códigos de presencia (cada 5 min) y scheduler de notificaciones (cada minuto)
4. [ ] Implementar `code-generator.ts` y `verifier.ts` en módulo `presence/`
5. [ ] Implementar `policy.ts` y `engine.ts` en módulo `refunds/`
6. [ ] Añadir componente "Introduce el código" a la página de reserva del cliente (Phase 3)
7. [ ] Añadir componente "Código de presencia" al dashboard del negocio (Phase 4)
8. [ ] Configurar Baileys con SIM dedicada en servidor de producción antes del primer go-live
