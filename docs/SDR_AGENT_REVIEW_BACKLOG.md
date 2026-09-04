# SDR IA — Recomendaciones para retomar (histórico)

> **Superseded on 2026-09-04:** this review describes the older `f7ba894`/`b31c207` state. The operational bridge, worker, grounding, deterministic guardrails, durable handoff, and notifications have since been implemented in the current working tree. Do not resume from the unchecked items below; use [`SDR_AGENT_PROGRESS.md`](./SDR_AGENT_PROGRESS.md) as the source of truth. The remaining next phase is controlled Shadow canary evidence, followed by approval/outbox work with outbound gates still disabled.

Fecha de revisión: 2026-08-28

Este documento registra el trabajo pendiente identificado después de revisar la implementación de Gemini y el panel SDR del commit `b31c207`. La revisión se realizó sobre `main` en `f7ba894`.

## Estado confirmado

La implementación actual sirve como fundación técnica, panel de configuración y simulador en Shadow Mode. Todavía no constituye un Agente SDR operativo conectado al Inbox.

- El bridge público continúa siendo un no-op desactivado.
- Los mensajes capturados pueden crear jobs, pero no existe un worker operativo que los consuma.
- `approval` y `auto` se guardan en la base de datos, pero no ejecutan respuestas.
- El prompt del sistema, las reglas de handoff y la base de conocimiento no están conectados completamente al provider.
- No existen todavía envío LinkedIn, aprobación humana, handoff operativo ni Google Calendar.

No habilitar producción ni asumir que seleccionar `auto` activa el agente hasta completar y verificar los puntos siguientes.

## Recomendación concreta y orden de implementación

1. Crear un bridge real que consulte la configuración activa del agente y mantenga el comportamiento fail-closed cuando falten credenciales o configuración.
2. Crear el worker que consuma `sdr_jobs`, renueve leases y procese únicamente los tipos y estados permitidos.
3. Pasar al provider de Gemini el contexto completo y versionado:
   - prompt del sistema;
   - políticas y reglas de handoff;
   - contexto de empresa;
   - documentos aprobados de la base de conocimiento;
   - historial conversacional limitado y redactado.
4. Implementar validaciones deterministas en backend para unsubscribe, do-not-contact, asuntos legales, descuentos no autorizados, baja confianza, prompt injection, solicitud de humano y errores de herramientas. No confiar únicamente en `requires_human` devuelto por el modelo.
5. Aplicar realmente `confidence_threshold`, `max_auto_turns`, modo del agente, estado del thread y límites por slot.
6. Evitar clasificación o acciones automáticas para threads `DO_NOT_CONTACT`, `RESOLVED`, `HUMAN_REVIEW` o `HUMAN_ACTIVE`, salvo una transición explícitamente autorizada.
7. Implementar primero el modo `approval`, persistiendo propuestas en `sdr_actions` y exigiendo aprobación antes de cualquier envío.
8. Implementar handoff real, bloqueo de IA y notificaciones al responsable.
9. Añadir rate limit, timeout, límites de tokens, presupuesto diario, circuit breaker y registro de tokens/coste para Gemini.
10. Conectar el estado efectivo del bridge con la UI para que esta distinga claramente entre configuración guardada y runtime realmente disponible.
11. Corregir los errores de ESLint de los archivos SDR y sustituir los usos innecesarios de `any` por contratos validados.
12. Añadir pruebas con un provider Gemini simulado para no depender de llamadas facturables en CI.
13. Ejecutar después el smoke test real de Gemini con contenido controlado y anonimizado.
14. Probar Shadow Mode con una cuenta LinkedIn autorizada y controlada antes de implementar o habilitar cualquier envío.
15. Promover gradualmente `off -> shadow -> approval -> auto`; `auto` sólo después de aprobar todos los gates del plan SDR.

## Problemas concretos que deben permanecer visibles

- `lib/sdr-agent/index.ts` exporta actualmente `createDisabledSdrBridge()`.
- `pages/api/sdr/simulate.ts` recibe `systemPrompt`, pero no lo aplica al provider.
- `lib/sdr-agent/pipeline.ts` no carga la versión activa, políticas ni fuentes aprobadas.
- `pages/api/sdr/knowledge.ts` persiste documentos, pero no existe recuperación/RAG en el pipeline.
- `confidence_threshold`, `max_auto_turns` y `handoff_rules` se almacenan, pero no se ejecutan como políticas backend.
- `captureSdrInboundMessage` puede crear jobs aunque el thread esté resuelto o marcado como no contactar.
- El simulador necesita límites de longitud, rate limit, presupuesto y métricas de consumo.

## Verificación registrada en esta revisión

```text
npm run test:sdr-foundation   PASS
npx tsc --noEmit              PASS
npm run build                 PASS (warning esperado por ausencia de @/ee)
ESLint focalizado SDR         FAIL (30 errores, 7 warnings)
npm run test:sdr-shadow       NO EJECUTADO (realiza llamadas externas facturables a Gemini)
```

## Instrucción para retomar

> Retomar el Agente SDR IA desde `docs/SDR_AGENT_REVIEW_BACKLOG.md`. Verificar primero SHA, working tree y tests. Mantener el bridge fail-closed y no habilitar envíos. Implementar en el orden registrado, comenzando por el bridge/worker de Shadow Mode y la conexión real de configuración, políticas y conocimiento.
