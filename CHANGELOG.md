# Historial de cambios

## 2026-10-21 · Reutilización de remisiones eliminadas

- Eliminar un pedido libera su remisión para otro pedido del mismo producto. También permite editar un pedido para usar el número liberado y mantiene el rechazo de duplicados vigentes.
- Se conservan UUID, remisiones históricas, cobros y adjuntos; los abonos anteriores siguen relacionados con el pedido eliminado.
- IndexedDB versión 3 actualiza los datos anteriores automáticamente al recargar. Migración privada `0008_reusable_remissions` con índice único parcial y reversión protegida si existen números reutilizados.

## 2026-10-20 · Cobros y eliminación de pedidos

- Los cobros anulados y abonos retirados dejan de bloquear la eliminación del pedido; siguen protegidos los pedidos con abonos vigentes.
- Confirmación con explicación y acceso a cobros asociados, e historial que identifica pedidos eliminados.
- Cobros vigentes/anulados separados, filtro por pedido, elección visible entre abono y anticipo, y textos claros para anular todo el cobro o quitar solo el abono.
- Se conservan saldos a favor e historial. Funciona con datos anteriores, sin migración. [Detalle](docs/21_clear_payments.md).

## 2026-10-20 · Remisiones, cobros y anticipos

- Remisión entera única por producto y organización, compatible entre zanahoria y papa, con validación en formulario y almacenamiento.
- Cobros por cliente, fecha, descripción, aplicaciones parciales a varios pedidos y saldo a favor utilizable después sin duplicar dinero recibido.
- Detalles de pedidos con total, pagado, restante y estado; cuentas por cliente e historial de cobros. Correcciones/anulaciones con motivo y conservación de historial.
- Migración 0007, transacciones con bloqueos, permisos por organización/operador y protección de pedidos con movimientos. Guardado local y cola idempotente de cobros privados.
- [Uso, contrato, verificación y límites](docs/20_remissions_payments.md).

## 2026-10-20 · MERMA automática editable

- PESO TOTAL descuenta MERMA ADICIONAL y CANTIDAD TOTAL, independientemente de MERMA.
- MERMA se llena con la suma; permite borrar/escribir, conservar valores manuales (incluido cero) y volver a automático. Mantiene comas de miles.
- Guardado, edición, borradores offline y conflictos conservan el modo/valor; migración 0006 añade override nullable y protege reversión con datos manuales. Huellas automáticas compatibles con peticiones anteriores. [Reporte](docs/19_editable_shrinkage.md).

## 2026-10-20 · Ajuste de merma y formato numérico

- PESO TOTAL = PESO − MERMA ADICIONAL − MERMA, con MERMA automática igual a la suma de cantidades. Recalcula pesos/importes y rechaza resultados negativos.
- Comas de miles durante escritura, pegado, borrado y edición de cualquier campo numérico de papa/zanahoria; conserva cursor, precisión y ceros decimales. Resultados, listas, detalle y comparaciones también agrupan miles. Punto decimal; API sin separadores.
- Migración 0005_potato_formula y contrato potato-v2. Preserva cálculo/importes históricos hasta guardar una edición. [Detalle](docs/18_potato_formula_number_format.md).

## 2026-10-20 · Papa y captura sin conexión

- Formulario y detalle de papa con 1RA/2DA/3RA/4TA, cantidad/precio, pesaje y resultados automáticos de solo lectura. Edición, eliminación y cambio de producto reutilizan clientes/archivos/CRUD existentes.
- Contrato común Python/TypeScript y aritmética racional exacta; entradas cuatro decimales, salidas ocho HALF_UP sin redondeos intermedios.
- Migración 0004_potato con pesajes/líneas tipadas y modificador de pedido; conserva zanahorias y protege reversión con papa existente.
- Adjuntos múltiples con lista explícita de formatos, estado, tamaño, preview compatible, descarga privada y retiro.
- Borradores editables offline durante sesión vigente, caché autorizada por identidad/rol, reintento al regresar conexión y comparación/resolución explícita de conflictos.
- Shell offline de producción sin cachear API/tokens; conserva outbox. Recarga privada requiere autenticarse con red; instalación PWA pendiente.
- Pruebas de paridad, validación, PostgreSQL y recorridos móviles/escritorio, conservando regresiones de zanahoria/clientes. [Detalle y evidencia](docs/17_potato_orders.md).

El importe provisional usa peso neto de clasificación × precio; la suma de cantidades se presenta como CANTIDAD TOTAL. Confirmaciones registradas en docs/11_open_questions.md. Sin despliegue de producción.
