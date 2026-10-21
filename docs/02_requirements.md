# 02 · Requisitos y estado

Estado vigente: clientes y pedidos de zanahoria y papa con alta, consulta, edición y eliminación lógica. El [reporte de papa](17_potato_orders.md) describe esta entrega; los reportes 12–16 conservan el historial.

| Área | Implementado | Pendiente |
|---|---|---|
| Clientes | Alta, búsqueda en selector, consulta, edición/eliminación con versión | Aprobar política comercial de permisos y retención |
| Zanahoria | Fecha editable, hectáreas, precio por hectárea, total MXN, descripción, adjuntos | Redondeo comercial a centavos |
| Papa | 1RA, 2DA, 3RA, 4TA; cantidad y precio por clasificación; pesaje automático; edición/eliminación | Confirmar terminología de merma y base comercial del precio |
| Archivos | Selección múltiple, formato/tamaño/estado, vista previa compatible, descarga privada, retiro | Antivirus, compresión y conversión HEIC |
| Guardado local | Clientes, ambos productos y archivos sin Supabase | Migración a nube y respaldo/exportación |
| Sin conexión privado | Datos previamente consultados; captura/borradores durante sesión verificada vigente; outbox y reintento al volver la conexión | Login en frío offline, catálogo completo y sincronización por cursor |
| Conflictos | Versión base, 409, comparación y elección explícita; idempotencia | Fusión por campo y coordinación entre pestañas |
| Shell offline | Service Worker de producción, sin cachear API | Manifiesto/instalación PWA y teléfonos físicos |
| Acceso compartido | API autorizada por membresía/organización, tokens en memoria | Crear Supabase y validar integración externa |

Papa recalcula al cambiar cantidad, precio, bruto, tara o merma adicional. PESO TOTAL = PESO − MERMA ADICIONAL − CANTIDAD TOTAL. MERMA se llena con CANTIDAD TOTAL y permite borrarse/modificarse; el valor manual se conserva y no afecta PESO TOTAL. Botón Usar cantidad total restaura el automático. Las demás salidas son de solo lectura. No confirmar sin cliente, fecha válida, cantidad positiva, bruto mayor que tara y cantidad total más merma adicional dentro del peso. Clasificación sin uso cuenta como cero; cantidad positiva exige precio explícito, incluso cero. Sin botón Calcular. Campos numéricos muestran comas al escribir, conservando decimales/cursor y guardado canónico.

UUID estable, timestamps UTC de servidor, fecha civil independiente, versión positiva, organización obligatoria, decimales exactos como cadenas, validación en ambos extremos, autorización por endpoint y captura/archivos guardados antes de transmitir. No confirmar archivos hasta verificar sus bytes.

La señal de conexión indica navigator.onLine; no demuestra disponibilidad del servidor ni éxito del envío. La sincronización automática requiere app abierta y sesión vigente, fuera de un formulario activo. Reiniciar sesión privada requiere internet; los pendientes se conservan.

Aceptación: compilación, cálculo compartido Python/TypeScript, PostgreSQL, recorridos de ambos productos en escritorio/móvil, adjuntos, desconexión y conflictos. Chromium emulado no certifica Safari/iPhone físicos.
