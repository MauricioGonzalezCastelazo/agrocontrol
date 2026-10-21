# 20 · Remisiones, cobros y anticipos

Los pedidos de zanahoria y papa tienen número de remisión. Los cobros registran dinero recibido de un cliente y permiten aplicarlo a uno o varios pedidos, dejarlo como anticipo o conservar un excedente a favor.

## Uso

1. En **Pedidos → Nuevo pedido**, seleccionar cliente y producto e introducir una remisión entera positiva. Es única entre los pedidos vigentes del producto dentro de la empresa, incluso entre clientes diferentes. Al eliminar el pedido se libera la remisión para crear otro o editar uno existente; también se liberan las remisiones de pedidos eliminados antes de este ajuste. Zanahoria 82 y papa 82 pueden coexistir.
2. Abrir el pedido para ver **total del pedido, total pagado y restante**. Un pedido nuevo comienza sin pagos. Los pedidos anteriores se conservan sin inventarles remisión; completarla mediante **Editar pedido** antes de registrar una aplicación.
3. Entrar a **Cobros → Registrar cobro**, seleccionar cliente, monto recibido, fecha y descripción. Elegir anticipo o aplicación a pedidos. Cada aplicación selecciona producto y pedido, muestra la remisión e indica el importe abonado. Se pueden agregar varios pedidos del mismo cliente.
4. En **Cobros**, abrir la cuenta del cliente para consultar pedidos, deuda, dinero recibido e historial de cobros. El crédito disponible se presenta por separado de la deuda de pedidos.
5. Abrir un cobro con saldo disponible y elegir **Aplicar saldo a pedidos**. Esta operación consume dinero ya registrado; no crea otro ingreso. Permite repartir el saldo entre pedidos nuevos o existentes del mismo cliente.
6. Para corregir, **Quitar abono de estos pedidos** deja ese importe como saldo a favor y restaura la deuda del pedido. **Anular cobro** retira todos sus abonos y su crédito. Ambas acciones requieren motivo y conservan el historial. Los cobros se consultan por separado en **Vigentes** y **Anulados**. [Ajuste de eliminación e interfaz](21_clear_payments.md).

Ejemplo: pedidos por $1,000 y $1,780. Se reciben $300 aplicados al primero y luego un anticipo de $2,000. Aplicar $700 y $500 del anticipo deja $1,500 pagados en pedidos, $1,280 pendientes y $800 disponibles a favor. El dinero recibido permanece en $2,300.

## Reglas y consistencia

- Remisión entre 1 y 2,147,483,647, sin decimales. Índice único parcial en PostgreSQL para `deleted_at IS NULL`; IndexedDB reserva una clave de producto/remisión solo en pedidos vigentes. La reserva se actualiza al editar y se libera al eliminar, dentro de la misma transacción. Los UUID y las referencias de cobros anteriores se conservan aunque el número se reutilice; el pedido nuevo comienza sin abonos.
- Importes positivos y exactos en MXN, con hasta ocho decimales para permitir liquidar los totales calculados. Entrada y salida de API como cadenas decimales sin separadores. La interfaz agrupa miles con comas y utiliza punto decimal.
- La suma aplicada no puede superar el recibido o el crédito disponible, ni el saldo de cada pedido. Los excedentes se conservan sin aplicar. No se admite repetir el mismo pedido en una aplicación.
- El total pagado deriva de aplicaciones vigentes de cobros vigentes; no se duplica en una columna editable del pedido. Los cambios de cobros actualizan la versión del pedido para detectar ediciones desactualizadas.
- Un pedido con historial de aplicaciones conserva cliente, producto y remisión para mantener sus referencias. Puede eliminarse cuando no tiene abonos vigentes: los cobros anulados y los abonos retirados no lo bloquean. Su total puede editarse siempre que no quede por debajo de lo pagado.
- UUID y huella de contenido hacen idempotentes las recepciones y aplicaciones. Repetir el mismo UUID/cuerpo confirma el registro; contenido distinto se rechaza. Anulaciones usan versión esperada y motivo.
- PostgreSQL bloquea cliente/cobro y pedidos en orden estable dentro de una transacción. Las aplicaciones simultáneas vuelven a validar el saldo antes de escribir. IndexedDB utiliza una transacción de clientes, pedidos y cobros.

## Permisos

Cada endpoint conserva autenticación y membresía activa. Administradores consultan y gestionan todos los movimientos de la organización. Operadores consultan sus pedidos y sus cobros, aplican únicamente a pedidos autorizados y no anulan aplicaciones sobre pedidos de otros operadores. El pagado de un pedido autorizado incluye los abonos válidos del equipo para evitar mostrar una deuda incorrecta.

Los detalles de cobros filtran pedidos ajenos al operador. Su cuenta de cliente se identifica como parcial: pedidos propios y cobros propios; el administrador consulta la cuenta completa. No se comparten UUID, remisiones ni archivos de pedidos ajenos. El crédito pertenece al cliente y al cobro de origen; un operador no puede gastar crédito registrado por otro operador.

## Guardado y conexión

En el espacio local iniciado con `python main.py`, clientes, pedidos y cobros permanecen en el mismo navegador y perfil. No necesita Supabase. El esquema de IndexedDB sube a versión 3 conservando clientes, pedidos, archivos, huellas e historial de cobros. Al recargar se reemplaza el índice anterior y se reservan solo las remisiones vigentes, sin borrar el almacenamiento del navegador. Los formularios de cobros quedan disponibles con la aplicación abierta para guardar sin red.

En el modo privado, el servidor es la autoridad para saldos. Las cuentas y detalles financieros requieren conexión; no se sirven desde la caché privada offline. Una captura ya abierta puede conservarse en la cola por usuario/organización. Una captura pendiente aún no modifica saldos.

Antes de enviar se conserva el cuerpo en `agrocontrol-pending-payments`. Tras intentarlo, el cuerpo queda fijo para reintentar con el mismo UUID aunque se pierda la respuesta. **Sincronización → Cobros por confirmar** permite revisarlo y reintentar. Para corregir una captura intentada, una lectura actual debe confirmar que el UUID no existe; para una aplicación, que no está en el cobro. Si ya existe, se confirma con el cuerpo original. No se crea otro ingreso para recuperar una respuesta perdida.

Al volver la conexión, con sesión verificada vigente y fuera de formularios activos, se reintentan los pendientes. Una recarga del acceso privado sigue requiriendo iniciar sesión con red. El almacenamiento del navegador puede borrarse; el modo local todavía no se comparte entre celular y computadora.

## Migración y API

Migración `0007_remissions_payments`, sobre `0006_editable_shrinkage`: remisión nullable para históricos, unicidad por empresa/producto/remisión y tablas `payments`, `payment_applications`, `payment_allocations`, con llaves compuestas de organización. Cobros y asignaciones usan `NUMERIC(32,8)` en PostgreSQL. La reversión se bloquea si existen remisiones o cobros, incluso anulados. Aplicar con `alembic upgrade head` antes de arrancar la API privada.

La migración vigente es `0008_reusable_remissions`: reemplaza la unicidad global anterior por un índice único para pedidos sin eliminar. No modifica las remisiones históricas ni sus cobros. Su reversión se rechaza si hay números reutilizados, para conservar ambos pedidos sin pérdida de datos. Actualizar la API privada con `alembic upgrade head` desde `backend`; el modo local se actualiza automáticamente al recargar.

| Método | Ruta `/api/v1` | Uso |
|---|---|---|
| GET | `/customer-accounts?q=&customer_id=&offset=&limit=` | Saldos por cliente autorizado |
| GET / POST | `/payments` | Listar / registrar dinero recibido |
| GET | `/payments/{id}` | Cobro, crédito e historial de aplicaciones |
| POST | `/payments/{id}/applications` | Aplicar crédito existente a pedidos |
| POST | `/payments/{id}/void` | Anular cobro con `expected_version` y `reason` |
| POST | `/payments/{id}/applications/{application_id}/void` | Deshacer aplicación con versión del cobro y motivo |

POST de cobro: `id`, `customer_id`, `amount`, `payment_date`, `description`, `allocations: [{order_id, amount}]`. Una lista vacía registra anticipo. Aplicación: `id`, `application_date`, `description`, `allocations` no vacía. Producto y remisión se resuelven del pedido en el servidor, sin confiar en etiquetas del navegador.

La respuesta de pedido agrega `remission_number`, `total_paid`, `remaining_amount`, `payment_status` (`unpaid`, `partial`, `paid`). GET de pedidos busca por cliente o remisión y admite filtro `remission_number` además de producto/cliente. Se mantienen UUID internos y las rutas existentes.

## Verificación y pendientes

Pruebas de validación, idempotencia, decimales grandes, anticipos, reparto, anulaciones, aislamiento por organización/operador, protección de pedidos y concurrencia real en PostgreSQL. Recorridos automatizados móviles/escritorio para modo local y API privada, accesibilidad, guardado offline y recuperación de respuesta perdida.

Resultados verificados del incremento: **261 casos correctos** entre suites y repeticiones dirigidas de los casos corregidos.

| Verificación | Casos correctos |
|---|---:|
| Pytest, incluido PostgreSQL real y migraciones | 128 |
| Vitest, incluidos importes y cambio de cuenta durante envío | 79 |
| Playwright local, móvil/escritorio | 18 |
| Playwright API privada, móvil/escritorio | 14 |
| Playwright vista previa y accesibilidad | 20 |
| Playwright build de producción y shell sin red | 2 |

Compilación TypeScript/Vite, Ruff y Prettier correctos. Las suites de navegador se ejecutaron por grupos, con hasta dos workers. El PostgreSQL utilizado fue una base efímera dedicada de pruebas; no se aplicaron migraciones a una base comercial.

Continúan pendientes la plantilla Excel del usuario, despliegue web, conexión real a Supabase y migración de los datos locales a la nube. No se envían documentos ni mensajes a clientes desde esta entrega.
