# 06 · Especificación de API

**Contrato añadido:** remisiones y cobros en [documento 20](20_remissions_payments.md). POST de pedido nuevo requiere `remission_number` entero positivo. Se agregan total pagado, restante y estado de pago a las respuestas, y los endpoints de cuentas, cobros, aplicaciones y anulaciones.

## Health y sesión

| Método y ruta | Acceso | Respuesta |
|---|---|---|
| GET `/health/live` | Público, sin datos comerciales | 200 `{"status":"ok"}` |
| GET `/health/ready` | Público, sin detalles internos | 200 si BD/migración disponibles; 503 de otro modo |
| GET `/api/v1/session` | Bearer JWT + `X-Organization-ID` UUID | `user_id`, `organization_id`, `role` de membresía activa |

OpenAPI ejecutable en `/docs`, JSON en `/openapi.json`. El contrato vigente de negocio se detalla a continuación.

Sesión: 401 por ausencia/token inválido, 403 por organización no autorizada o membresía inactiva, 422 por cabeceras malformadas, 503 por identidad/base inaccesible. No se devuelve existencia de datos ajenos. Respuestas con `Cache-Control: no-store`, `X-Content-Type-Options` y correlación `X-Request-ID`.

## Implementado: clientes, zanahoria, papa y archivos

`GET/POST /api/v1/customers`, `GET/PATCH/DELETE /api/v1/customers/{id}`, `GET/POST /api/v1/orders`, `GET/PATCH/DELETE /api/v1/orders/{id}`. Listados con `q`, `offset` y `limit` acotado; clientes filtran `active`, pedidos `product_type` y `customer_id`. PATCH y DELETE de cliente requieren administrador. Operadores consultan, editan y eliminan pedidos propios; administradores, los de su organización. Todas las operaciones siguen requiriendo identidad y membresía activa.

PATCH de pedido recibe los mismos campos de negocio de la creación, sin `id`, más `expected_version`. `attachments` contiene la lista final de manifiestos; los existentes deben conservar nombre, tamaño y hash, los omitidos se retiran y los nuevos quedan pendientes hasta subir sus bytes. El servidor recalcula el importe, conserva creador y creación e incrementa versión de forma atómica junto con detalles, manifiestos y auditoría. Repetir exactamente la última edición devuelve el estado actual sin duplicar el cambio, incluso después de confirmar archivos.

DELETE requiere `expected_version` positivo en la query y responde 200 `{"id":"UUID","deleted":true}`. Repetir una eliminación ya aplicada devuelve la misma confirmación. Una versión obsoleta produce 409. La eliminación es lógica: `deleted_at` excluye el registro del catálogo; no borra pedidos de un cliente eliminado. Pedidos eliminados y adjuntos retirados rechazan consulta/subida/descarga con 410 para el usuario autorizado. Registros ajenos siguen devolviendo 404. Un reintento de creación no restaura un UUID eliminado. No se ejecuta purga de filas ni archivos físicos.

POST de pedido requiere fecha ISO `YYYY-MM-DD`, `product_type="carrot"|"potato"` y detalle correspondiente. Zanahoria conserva `hectares` y `unit_price`. Entradas decimales como cadenas de hasta cuatro decimales, descripción opcional y lista `attachments` con `id`, `filename`, `size_bytes`, `sha256`. No aceptar campos desconocidos ni total/moneda/autor/organización como autoridad. Total recalculado y MXN fijado por servidor. Repetir UUID/cuerpo devuelve registro; contenido distinto produce 409. Manifiestos y pedido atómicos.

`PUT /api/v1/orders/{order_id}/attachments/{attachment_id}` recibe bytes sin multipart (hasta 25 MiB por archivo). Verifica tamaño y hash antes de marcar ready. Reintento de archivo confirmado no duplica eventos/versiones. `GET .../{attachment_id}/download` requiere la misma autorización del pedido; sirve `application/octet-stream`, `Content-Disposition: attachment`, `nosniff`, `no-store`. No hay rutas públicas ni URLs estáticas para archivos.

Respuesta de pedido: cliente UUID/nombre, fecha del pedido, currency=MXN, descripción, hectáreas/precio/total como cadenas, responsable, creación, versión, adjuntos y `attachment_status=complete|pending`. «Complete» solo describe adjuntos guardados en servidor; no equivale a sincronización offline completa.

### Referencia histórica de diseño (el contrato ejecutable prevalece)

- `GET /api/v1/customers?q=...&cursor=...&limit=...` → resultados paginados de organización autorizada.
- `POST /api/v1/customers` → UUID, nombre, activo, notas; 201 al crear.
- `PATCH /api/v1/customers/{id}` → cambios con `expected_version`; 409 si desactualizado.
- `GET /api/v1/orders?product_type=...&customer_id=...&cursor=...`.
- `POST /api/v1/orders` → UUID, cliente UUID, producto, descripción y detalle tipado. Nunca aceptar `created_by` ni `organization_id` en el cuerpo como autoridad.
- `GET /api/v1/orders/{id}` → detalle autorizado, total del servidor y versión.

Ejemplo de cuerpo previsto, solo datos sintéticos:

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "customer_id": "22222222-2222-4222-8222-222222222222",
  "product_type": "carrot",
  "order_date": "2026-03-12",
  "description": null,
  "details": {"hectares": "1.2500", "unit_price": "100.0000"},
  "attachments": []
}
```

Resultado calculado: `"total_amount": "125.00000000"`, `"currency": "MXN"`. Se preservan decimales exactos; el redondeo comercial a centavos sigue pendiente de decisión. Las escrituras ya rechazan campos desconocidos y valores numéricos no admitidos.

Etapa 3 ampliará idempotencia y cambios por cursor para sincronización completa. La carga binaria privada y los reintentos de creación por UUID ya están implementados. CORS no es una barrera de autorización: cada endpoint usa sesión y filtros de organización.

## Contrato de papa

El mismo POST/PATCH recibe `product_type: "potato"` y este `details`:

```json
{
  "gross_weight": "12000",
  "tare_weight": "2000",
  "additional_shrinkage": "400",
  "lines": [
    {"grade_code": "1RA", "quantity": "100", "unit_price": "10"},
    {"grade_code": "2DA", "quantity": "0", "unit_price": "0"},
    {"grade_code": "3RA", "quantity": "700", "unit_price": "5"},
    {"grade_code": "4TA", "quantity": "0", "unit_price": "0"}
  ]
}
```

Exactamente cuatro códigos únicos. Precio puede omitirse solo con cantidad cero; la respuesta normaliza ceros. Bruto/tara obligatorios; merma adicional por defecto cero. 422 por pesos/rangos/cantidades/precios inválidos; nunca se acepta un total del cliente. PATCH admite cambio de producto con su detalle correspondiente y conserva la versión base explícita.

Respuesta común añade `updated_at` y `updated_by`. En papa, `hectares`/`unit_price` planos son null y `potato` contiene entradas, `weight`, `total_quantity`, `weight_after_shrinkage`, `net_unit_weight`, `net_total_weight`, `total_amount` y líneas con `grade_code`, cantidad, precio, `allocated_unit_weight`, `allocated_net_weight`, `line_total`. Entradas normalizadas a cuatro decimales, salidas a ocho. Ejemplo: peso 10000, cantidad 800, peso total 9600, unitario 12, pesos de líneas 1200/0/8400/0 y total 54000.00000000. Zanahoria conserva campos planos y `potato: null`.

La lista explícita de extensiones nuevas está en `app/domain/attachment-policy.json`; archivos fuera de ella producen 422. La edición puede conservar archivos antiguos listos. Solo manifiestos nuevos requieren la lista vigente. Bytes siguen privados, sin interpretación documental. Comparación de conflictos usa GET en vivo; no se consulta caché para elegir una versión base nueva.

Actualización de fórmula: nuevas escrituras usan `potato-v2`: peso total = peso − merma adicional − suma de cantidades. El ejemplo anterior ahora produce peso total 8800, unitario 11, pesos 1100/0/7700/0 y total 49500.00000000. La respuesta incluye `potato.calculation_version`; pedidos históricos v1 conservan resultados y total original hasta editar. El cliente no elige una versión para nuevas escrituras. Ambos extremos rechazan peso total negativo. Las comas son presentación del navegador: la API recibe/devuelve punto decimal sin miles.

MERMA editable: `details.shrinkage_override` opcional, null/omitido para automático o cadena decimal no negativa de cuatro decimales para manual. Cero es explícitamente manual. Respuesta añade `potato.shrinkage_override` (null o cuatro decimales) y `potato.shrinkage` efectivo a ocho decimales. Cambiar este campo no altera PESO TOTAL ni importes. Para conservar idempotencia con capturas anteriores, el nuevo null se omite de las huellas de creación/edición; manual sí participa. Se guarda en la misma transacción y bajo los mismos permisos/versiones.
