# 10 · Roadmap por incrementos

**Estado del 20 de octubre de 2026:** papa, edición/eliminación y parte del trabajo offline ya están implementados y probados. Ver [reporte 17](17_potato_orders.md) y [alcance offline](07_offline_sync.md). El plan siguiente es histórico; las menciones de papa bloqueada o CRUD no habilitado corresponden a etapas anteriores.

## Etapa 1 · Base técnica y visual (histórica)

Documentación 01–11, estructura modular, configuración por entorno, Docker Compose, modelos y primera revisión Alembic, adaptador de identidad, sesión autorizada y sistema visual responsive con rutas. Reportar pruebas y limitaciones en documento de cierre. No habilitar CRUD ni afirmar funcionamiento offline.

## Etapa 2 · Clientes y zanahoria

Incremento implementado: CRUD de clientes con edición restringida a administrador, creación/consulta de zanahoria, fecha editable, MXN y cálculo exacto. Los adjuntos de cualquier extensión y recuperación de envíos se adelantaron por petición explícita del usuario. Supabase externo y validación física siguen pendientes; ver reporte 13. La lista siguiente es el plan original, no una afirmación de que todos sus puntos estén cerrados.

1. Confirmar unidad comercial, moneda, escala/redondeo, precio cero y matriz de permisos.
2. CRUD de clientes sin borrado destructivo, búsqueda y selección con estados reales de carga/error/vacío/éxito.
3. Validación tipada por registro de productos; zanahoria con `decimal.js` y `Decimal`, transacción pedido/detalle/auditoría y total recalculado por servidor.
4. Consulta y filtros de pedidos, responsable verificado y control optimista por versión. Papa permanece bloqueada.
5. Pruebas de persistencia PostgreSQL, autorización horizontal, aislamiento, cálculo y formularios móviles. Reporte verificable antes de pasar a etapa 3.

## Etapa 3 · Fotografías, offline y sincronización

Almacenamiento privado, validación real de imágenes, previews y compresión; esquema local Dexie con outbox y blobs; shell PWA controlado; idempotencia transaccional y conflictos; estado por entidad/adjunto, reintentos mientras app abierta y botón manual. Revisar seguridad y probar físicamente iOS/Android antes de piloto.

## Después del MVP

Definir notas comerciales, exportaciones Excel, controles financieros, inventario y depósitos por separado. No crear un dashboard financiero con datos provisionales. Revisar multiempresa (selector, membresías múltiples y políticas) sin cambiar las llaves existentes.

Antes de producción: respaldo/restauración, observabilidad sin datos sensibles, política de retención, carga concurrente, límites, HTTPS y proceso de soporte para pendientes locales. No hay despliegue de producción en esta tarea.

## Incremento de remisiones y cobros

Implementado el registro de cobros por cliente, pagos parciales por pedido, anticipos, saldo a favor y correcciones con historial. La exportación sigue pendiente de la plantilla Excel del usuario. Después: preparación de despliegue web privado, proyecto Supabase, copia/migración de los registros locales y pruebas físicas de celulares. [Alcance actual](20_remissions_payments.md).
