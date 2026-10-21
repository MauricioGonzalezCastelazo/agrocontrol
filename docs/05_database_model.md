# 05 · Modelo de base de datos

**Actualización de remisiones y cobros:** `0007_remissions_payments` añade las tablas de cobros, aplicaciones y asignaciones a pedidos. La migración vigente `0008_reusable_remissions` limita la unicidad por organización/producto/remisión a pedidos vigentes (`deleted_at IS NULL`), permitiendo reutilizar números eliminados sin alterar el historial. El pagado se deriva del historial vigente. [Modelo y restricciones actuales](20_remissions_payments.md).

La revisión inicial es `0001_initial`. Ningún esquema depende de nombres de clientes como llave. Timestamps con zona horaria, generados por servidor; UUID portables. Versiones comienzan en 1; los clientes se editan con control optimista de versión.

La revisión `0002_orders_files` añade `orders.order_date` (DATE editable), `currency` (MXN), huellas de creación en clientes/pedidos para reintentos idempotentes y `attachments` (UUID, pedido, organización, nombre, tamaño, SHA-256, pending/ready, fecha). Los archivos físicos se guardan fuera de PostgreSQL. El backfill de fecha convierte el timestamp histórico a America/Mexico_City. Edición de clientes con compare-and-swap de versión implementada.

| Tabla | Propósito y campos principales |
|---|---|
| organizations | `id`, `name`, `created_at`, `updated_at`, `version` |
| memberships | PK (`organization_id`, `user_id`), `role`, `active`; usuario externo Supabase sin contraseña local |
| customers | `id`, `organization_id`, `name`, `active`, `notes`, timestamps, `version` |
| orders | `id`, `organization_id`, `customer_id`, `product_type`, `description`, `total_amount`, `created_by`, timestamps, `version` |
| order_carrot_details | `order_id` PK, `organization_id`, `hectares`, `unit_price`, `price_unit` nullable |
| order_potato_details | `order_id` PK, `organization_id`, `gross_weight`, `tare_weight`, `additional_shrinkage` NUMERIC(14,4) |
| order_potato_lines | PK (`order_id`, `grade_code`), `organization_id`, `quantity` NUMERIC(14,4), `unit_price` NUMERIC(18,4) |
| audit_events | `id`, `organization_id`, `actor_id`, `action`, `record_id`, `created_at` |

`orders(customer_id, organization_id)` referencia `customers(id, organization_id)`; `orders(organization_id, created_by)` referencia membresía. Detalles de zanahoria referencian el par pedido/organización. Desactivar membresía conserva el responsable histórico. No hay cascadas de borrado destructivas.

Índices: cliente por organización/nombre; pedido por organización/fecha; auditoría por organización. Búsqueda tolerante a mayúsculas/acentos y paginación necesitan medirse en etapa 2; no se agregan extensiones PostgreSQL innecesarias.

Importes: `Decimal` / `NUMERIC`, nunca `float`. Entradas de zanahoria en tabla tipada, separadas del total calculado del pedido. La igualdad entre detalle y total será responsabilidad del servicio transaccional; no se afirma que el esquema aislado imponga esa regla entre tablas.

`sync_status` no existe en servidor: será propiedad local. Los adjuntos se añadieron en `0002_orders_files`; los blobs están en almacenamiento privado. Los creates usan UUID/huella de creación para reintentos. Recibos generales y cursores de cambios siguen en etapa 3, según `07_offline_sync.md`.

Auditoría: creación de cliente/pedido, edición de cliente y finalización de adjunto registran evento en la misma transacción del cambio. Un reintento idempotente no repite el evento.

El esquema de aplicación no se expone por Supabase Data API. El usuario de ejecución deberá tener permisos mínimos en producción, distintos del usuario de migraciones; Compose usa una sola cuenta local para simplificar desarrollo. RLS es defensa adicional por evaluar; no reemplaza filtros de organización ni referencias compuestas.

No hay seeds automáticos. El alta inicial de empresa/membresía requiere intervención administrativa documentada en README, con UUID de un usuario de pruebas del proveedor.

## Migraciones de papa: 0004, 0005 y 0006

**0006_editable_shrinkage** añade `shrinkage_override` NUMERIC(14,4) nullable con check no negativo. NULL significa automático; un decimal, incluido cero, es MERMA manual. El valor efectivo se deriva al responder, sin copiar CANTIDAD TOTAL a una columna mutable. No cambia la fórmula v2 ni importes existentes. Downgrade se bloquea mientras existan valores manuales para evitar perderlos. Índices/llaves y controles de versión se conservan.

La revisión siguiente, **0005_potato_formula**, añade `order_potato_details.calculation_version`. Backfill `potato-v1` para pedidos existentes; default `potato-v2` para nuevos/ediciones. El histórico usa el contrato anterior y conserva su total; no se reescribe dinero al consultar. Downgrade de 0005 se bloquea si hay pedidos con cálculo nuevo. Se probó el backfill y posterior edición con PostgreSQL. La sección siguiente describe la creación inicial de tablas en 0004.

Sobre `0003_edit_delete`, permite `carrot|potato`, añade `orders.updated_by` y las dos tablas tipadas de papa. Conserva clientes, zanahorias, archivos y tombstones. Relaciones compuestas mantienen organización de pedido/pesaje/líneas. Checks: códigos exactos, entradas no negativas, bruto mayor que tara y merma adicional acotada al peso. Cantidad total positiva y cuatro códigos únicos se validan en el servicio.

No hay columna JSON comercial ni pesos derivados duplicados. Respuesta recalculada desde entradas; `orders.total_amount` NUMERIC(32,8) se establece en la misma transacción. Edición admite cambio de producto y reemplaza únicamente los detalles tipados; mantiene UUID/creador/creación, registra `updated_by`/`updated_at`, incrementa versión y audita. La finalización de un archivo también registra actor/fecha.

Aplicar `alembic upgrade head` desde backend con base respaldada. Downgrade rechaza si existen pedidos de papa, incluidos eliminados, para no perder sus datos. No convertir pedidos comerciales solo para revertir: requiere migración y respaldo explícitos. Prueba PostgreSQL dedicada compara metadata, prueba máximos, conversión y reversión protegida; nunca se ejecuta sobre base de usuario.
