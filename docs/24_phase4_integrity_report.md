# Fase 4 · Etapa B: integridad, trazabilidad y conciliación

Fecha: 21 de octubre de 2026. Rama: `feature/sqlite-local`. Esta entrega amplía la persistencia SQLite de la fase 2; conserva sus cambios pendientes y su informe histórico [23](23_sqlite_stage_b_report.md). No se realizaron commits, push, merges ni operaciones destructivas sobre Git. No se implementaron SharePoint, respaldos externos, Excel, dashboard ni instaladores.

Resultado de cierre: implementación terminada, **366 pruebas correctas y 1 omitida** en las últimas ejecuciones de las suites, sin sumar reejecuciones parciales. Build, formato y análisis estático correctos. La validación sobre PostgreSQL real queda pendiente por indisponibilidad del entorno.

## Auditoría versionada

Las operaciones públicas que modifican clientes, pedidos, cobros, aplicaciones, anulaciones, adjuntos, capturas pendientes y conciliaciones generan eventos versión 2 dentro de la misma transacción que sus cambios. Cada evento conserva autor verificado, fecha UTC con sufijo `Z`, identificador de operación, motivo cuando se proporciona y valores observados antes/después. Los cambios de pedidos incluyen detalles de producto y documentos; las aplicaciones/anulaciones incluyen las filas y versiones relacionadas que cambian. Los decimales se serializan como texto, sin conversión a flotantes.

Los eventos anteriores siguen en versión 1, con sus campos originales. Operación, motivo, valores anterior/posterior y fecha UTC nueva permanecen `NULL` cuando no existían: no se reconstruyen ni se inventan. El timestamp histórico se entrega por separado, sin atribuirle información de zona horaria adicional. Los nuevos eventos y comprobantes son de solo inserción mediante triggers de SQLite/PostgreSQL.

`GET /api/v1/audit-events` permite consulta paginada por registro u operación a administradores de la organización. Los valores pueden contener datos comerciales personales; el endpoint conserva la autorización del modo correspondiente. El motivo es obligatorio y se recorta/valida al eliminar clientes y pedidos y al anular cobros/abonos. En las demás operaciones puede ser nulo si no fue proporcionado.

## Idempotencia y resultados

`operation_receipts` conserva identificador, organización, autor, acción, registro, huella SHA-256 de la solicitud, versión de formato, resultado, respuesta original y fecha UTC. Cambio comercial, auditoría y comprobante se confirman juntos. Una excepción antes de confirmar revierte las tres partes. Los reintentos no vuelven a ejecutar una edición o anulación ya confirmada.

Se admite `Idempotency-Key` con UUID. Su reutilización con otros datos o autor devuelve conflicto. Para clientes anteriores que no envían esa cabecera, las confirmaciones usan una identidad determinista derivada de organización, autor, acción, registro y cuerpo validado. Una solicitud rechazada sin clave explícita se registra como intento independiente, para permitir un nuevo intento si cambian las condiciones. Con clave explícita también se reproduce el rechazo original.

La respuesta normal de un reintento comercial consulta el estado actual del recurso y agrega `X-Operation-Replayed: true`, sin volver a modificarlo. Esto conserva la compatibilidad con adjuntos que terminaron de subir y registros editados después de la operación original. `GET /api/v1/operations/{id}` entrega el resultado y la respuesta conservada al confirmar; su ausencia no demuestra por sí sola que una operación haya sido rechazada. Solo el autor o un administrador de esa organización puede consultarlo. Una creación reintentada de un registro posteriormente eliminado sigue devolviendo su condición de eliminado, sin recrearlo.

Las escrituras SQLite mantienen `BEGIN IMMEDIATE`, incluida la reserva que se recupera después de un rollback para registrar un rechazo. PostgreSQL serializa las operaciones de la organización mediante bloqueo de su fila, además de los bloqueos y versiones de negocio existentes.

La interfaz distingue errores conocidos de resultado incierto. La pérdida de conexión, una respuesta incompleta o un error 5xx no se anuncian como guardado confirmado. Los reintentos conservan los datos originales del intento, incluida la versión esperada y el motivo en eliminaciones/anulaciones, y el cuerpo original en altas/ediciones de clientes. Pedidos, cobros y aplicaciones conservan además sus capturas recuperables existentes. La confirmación sigue requiriendo respuesta válida o una consulta posterior que establezca el resultado.

## Migraciones y copia local previa

Se agregaron revisiones nuevas; no se modificó ninguna revisión anterior:

- SQLite: `local_0003` agrega auditoría/comprobantes y `local_0004` agrega identidad de conservación e historial de documentos.
- PostgreSQL: `0009_audit_operations` agrega los campos y comprobantes, y protección contra UPDATE/DELETE del historial.
- `backend/migrations/env.py` incorpora la comprobación/copia previa para PostgreSQL. Es el orquestador; los archivos anteriores de `versions/` permanecen intactos.

Antes de actualizar SQLite existente se reserva la escritura, se ejecutan `integrity_check` y `foreign_key_check`, se verifica la revisión conocida y se comprueban tamaño/hash de los documentos declarados confirmados. Un documento confirmado faltante o corrupto detiene la migración. Las capturas que aún esperaban su primera subida se conservan como pendientes; no se inventa su contenido.

La copia utiliza la API SQLite Backup con la escritura reservada durante la copia y la migración. Guarda la base consistente y todos los documentos presentes —incluidos originales preparados, documentos retirados, temporales y archivos sin referencia— en un directorio único `migration-snapshots/<UUID>` junto a la base. Su manifiesto identifica formato, UUID, fecha UTC, revisión, versión SQLite, hashes SHA-256, tamaños y cobertura. Se sincronizan archivos y se verifica nuevamente la copia. Un fallo conserva los originales y detiene el cambio de esquema; una copia parcial se retiene para revisión y no se considera válida sin manifiesto verificado.

El lanzador espera a la API mientras su proceso permanezca activo: no interrumpe una revisión o copia correcta por exceder el antiguo límite de 45 segundos. Una base grande puede tardar varios minutos en iniciar. Ctrl+C permite interrumpir el arranque; una copia interrumpida no habilita la migración. El arranque de la interfaz conserva su espera acotada.

La restauración solo crea una carpeta nueva. No reemplaza una instalación ni sobrescribe un archivo. Desde `backend`, en Windows:

```powershell
../.venv/Scripts/python -m app.local.cli verify-snapshot 'D:/ruta/copia/migration-snapshots/UUID'
../.venv/Scripts/python -m app.local.cli restore-copy 'D:/ruta/copia/migration-snapshots/UUID' 'D:/ruta/nueva-recuperacion'
```

En macOS/Linux se utiliza `../.venv/bin/python`. Estos comandos no inician ni migran automáticamente la carpeta recuperada. Una migración posterior de esa copia vuelve a pasar por los controles anteriores. Se rechazan rutas de manifiesto que escapen de la copia y destinos de conservación dentro del origen de documentos.

Para una actualización PostgreSQL existente es necesario detener la API y declarar mantenimiento mediante `AGROCONTROL_PG_MAINTENANCE=true`, con `pg_dump` y `pg_restore` compatibles con el servidor disponibles en PATH. El orquestador bloquea DML, revisa relaciones/constraints y documentos confirmados, exporta un snapshot transaccional y crea un dump custom usando ese snapshot. Verifica su catálogo con `pg_restore --list`, copia adjuntos y sella el manifiesto antes de permitir las migraciones. Las credenciales se pasan por variables del proceso, sin incluirlas en argumentos o manifiestos. Un fallo o falta de herramientas detiene la actualización.

La ubicación PostgreSQL predeterminada es `migration-snapshots-postgresql` junto a la carpeta configurada de documentos. `AGROCONTROL_PRESERVATION_DIR` admite otra ruta absoluta fuera de los adjuntos. La generación SQL offline no crea una copia física y no sustituye este procedimiento: no debe usarse para saltar la conservación previa. El dump requiere una restauración en una base nueva mediante herramientas PostgreSQL; `restore-copy` está restringido a SQLite.

Estas copias locales previas a migración cumplen la condición de conservación de esta entrega. No son un servicio de respaldos externos, no programan copias periódicas y no cambian el estado de respaldo externo pendiente.

## Diagnósticos y documentos

En Configuración del modo SQLite, **Revisar integridad** consulta `GET /api/v1/local/diagnostics`. La revisión es de lectura y comprueba:

- Integridad física y claves foráneas de SQLite.
- Detalles de producto y recálculo exacto por la versión de fórmula guardada, sin modificar importes.
- Abonos por pedido, crédito por cobro, conciliación por cliente y vínculos de cliente/organización en aplicaciones.
- Unicidad de remisiones vigentes por producto y presencia de remisión en pedidos con abonos; los pedidos históricos sin remisión conservan su tratamiento anterior.
- Hash/tamaño de adjuntos confirmados y preparados; documentos faltantes, corruptos o pendientes de confirmación; originales faltantes en capturas; archivos sin referencia y temporales.

El reporte incluye versión, fecha UTC, hallazgos e identidad persistente para futuros manifiestos. `metadata_created_at_utc` registra cuándo se introdujo esa identidad, no una supuesta fecha histórica de instalación. El estado externo permanece `pending`.

**Conciliar documentos** exige motivo y ejecuta una operación con comprobante durable. Solo confirma metadatos pendientes si los bytes existentes coinciden en hash, tamaño y formato. No adivina asociaciones de archivos ni corrige cálculos, saldos o remisiones. Los faltantes/dañados se reportan y requieren el original.

Los archivos con nombre temporal generado por AgroControl y antigüedad mínima de 24 horas pueden conservarse mediante una copia verificada en `attachments/quarantine/<operación>/...`, con registro de origen, destino, hash, tamaño, motivo y fecha. El original permanece. Los temporales recientes, nombres desconocidos y archivos sin referencia no se borran ni se reasignan. Un fallo posterior a copiar puede dejar una copia sin referencia; se reporta y se conserva, sin convertirla en confirmación. No hay limpieza automática.

## Pruebas y resultados

Entorno ejecutado: Windows, Python 3.14.7, SQLite 3.50.4, Node.js 24.21.0 y Chromium de Playwright en escritorio/móvil emulado. Se utilizaron bases y archivos sintéticos en directorios exclusivos de pruebas. No se abrió ni migró una base comercial durante la ejecución.

| Validación | Resultado |
|---|---|
| Backend completo: `../.venv/Scripts/python -m pytest -q` | 176 correctas; 1 omitida por falta de PostgreSQL real. |
| Ruff: `check .` y `format --check .` desde backend | Correctos. |
| Frontend: `npm test -- --maxWorkers=2` | 86 correctas. |
| `npm run build` | TypeScript y compilación correctos. |
| `npm run format:check` | Correcto. |
| SQLite: `npm run test:sqlite` | 32 correctas, incluidos pérdida de respuesta, actualización de consultas y reintentos sin doble edición. |
| Modo privado: `npm run test:online` | 22 correctas, con API real y base sintética. |
| IndexedDB histórico: `npm run test:local -- --workers=1` | 28 correctas. |
| Producción: `npm run test:production` | 2 correctas. |
| Acceso/navegación/accesibilidad: `npm run test:e2e -- --workers=1` | 20 correctas. |
| Lanzador | Dos casos con tiempo simulado: copia de 120 segundos sin interrupción y espera acotada de la interfaz. Incluidos en la suite backend. |

Los bloques sintéticos cubren fallos de copia y de escritura del comprobante, documentos confirmados faltantes, corrupción, restauración sin sobrescritura e identidad conservada. Los procesos que terminan abruptamente antes/después del commit verifican que edición, auditoría y comprobante aparecen juntos o no aparecen; los reintentos no incrementan otra vez la versión. También se prueban operaciones simultáneas, anulaciones duplicadas, claves reutilizadas con otro contenido, rechazo de capturas obsoletas y repetición idempotente de la misma captura.

El recorrido de navegador pierde deliberadamente una respuesta después del commit, recarga y repite la edición con la misma clave. Otro caso pierde la respuesta de edición de un cliente, actualiza su consulta tras vencer la caché y comprueba que el reintento conserva el cuerpo original y la versión no vuelve a incrementarse. Las validaciones del protocolo de dump PostgreSQL usan simulaciones de herramientas y fallos; no se contabilizan como un dump/restauración PostgreSQL real.

Incidencias resueltas durante los bloques: adaptación de pruebas al motivo obligatorio y al reintento idempotente de clientes; manejo de rutas largas al copiar documentos en Windows; conservación del foco inicial en Cancelar tras introducir el motivo; aislamiento de trazas del recorrido privado para evitar interferencia entre suites paralelas; conservación del envío original del cliente aunque se actualice su consulta; espera del lanzador suficiente para copias largas. Los fallos de ejecución intermedios se corrigieron o repitieron; solo se consideran aprobados los resultados finales indicados.

## Riesgos y limitaciones

- **PostgreSQL real pendiente.** No hay `TEST_DATABASE_URL` dedicada configurada; Docker Desktop falla al iniciar WSL y no están instalados `pg_dump`/`pg_restore`. Se generó SQL y se probaron reglas de negocio sobre bases sintéticas, pero no se certifica la migración, dump/restauración ni concurrencia del nuevo esquema sobre PostgreSQL real. El caso de integración permanece explícitamente omitido y el CI queda preparado sin haberse enviado/ejecutado remotamente.
- No hay respaldo externo ni cobertura ante pérdida del equipo/disco. Las pruebas de interrupción de proceso no equivalen a una prueba física de corte eléctrico o de hardware que no respete sincronización. Tampoco se certifica ejecución física en macOS, iPhone o Android.
- SQLite y los archivos no comparten una sola transacción. Estados pendientes, hashes, comprobantes y copias conservadas permiten detectar/reintentar, pero pueden quedar objetos sin referencia. Nunca se presentan como operación confirmada si falla la transacción.
- Las copias completas y la auditoría de valores requieren espacio. Se mantienen originales, copias y eventos sin purga automática. La captura de cambios recorre las tablas de la organización y serializa escritores; una cola grande puede producir auditoría voluminosa. Se priorizó integridad sobre rendimiento.
- Los diagnósticos no reparan datos financieros ni sustituyen una revisión humana. Un documento confirmado perdido/corrupto impide actualizar una instalación hasta recuperar un original válido. Las capturas cuya primera subida nunca terminó pueden seguir requiriendo reselección.
- La garantía de repetición exige conservar el identificador y cuerpo de la intención original. Las solicitudes que nunca llegaron al servidor y los formularios que no se conservaron en capturas no adquieren durabilidad por esta funcionalidad. Las sesiones locales siguen requiriendo reautorización tras reiniciar la API.
- La protección de solo inserción es una regla de base/aplicación; no cifra datos ni aísla frente a administradores o procesos maliciosos de la misma cuenta del sistema. La verificación de documentos no es antivirus.
- Las revisiones nuevas rechazan downgrade automático para impedir perder historial. La recuperación usa una copia verificada en un destino nuevo y un procedimiento revisado; no una reversión destructiva del esquema activo.

## Archivos y conservación de la fase 2

El inventario identifica lo nuevo/ampliado en esta etapa y los archivos pendientes de fase 2 que permanecen sin cambios. Se compararon hashes de las revisiones anteriores para comprobar su conservación.
<!-- INVENTORY -->

Inventario completo frente a `HEAD b03d5bf`: 93 archivos. Revisiones anteriores verificadas por hash: 10.

| Estado | Archivo |
|---|---|
| Fase 4: ampliado sobre fase 2 | [.github/workflows/ci.yml](../.github/workflows/ci.yml) |
| Fase 4: ampliado sobre fase 2 | [.gitignore](../.gitignore) |
| Fase 4: ampliado sobre fase 2 | [CHANGELOG.md](../CHANGELOG.md) |
| Fase 4: ampliado sobre fase 2 | [README.md](../README.md) |
| Fase 4: nuevo o modificado | [backend/app/api/business.py](../backend/app/api/business.py) |
| Fase 2: conservado sin cambios | [backend/app/api/dependencies.py](../backend/app/api/dependencies.py) |
| Fase 4: ampliado sobre fase 2 | [backend/app/api/files.py](../backend/app/api/files.py) |
| Fase 4: nuevo o modificado | [backend/app/api/payments.py](../backend/app/api/payments.py) |
| Fase 4: nuevo o modificado | [backend/app/main.py](../backend/app/main.py) |
| Fase 4: ampliado sobre fase 2 | [backend/app/modules/operations.py](../backend/app/modules/operations.py) |
| Fase 4: ampliado sobre fase 2 | [backend/app/modules/payments.py](../backend/app/modules/payments.py) |
| Fase 4: ampliado sobre fase 2 | [backend/app/modules/private_files.py](../backend/app/modules/private_files.py) |
| Fase 4: nuevo o modificado | [backend/app/modules/schemas.py](../backend/app/modules/schemas.py) |
| Fase 2: conservado sin cambios | [backend/app/persistence/base.py](../backend/app/persistence/base.py) |
| Fase 4: ampliado sobre fase 2 | [backend/app/persistence/models.py](../backend/app/persistence/models.py) |
| Fase 4: ampliado sobre fase 2 | [backend/migrations/env.py](../backend/migrations/env.py) |
| Fase 4: nuevo o modificado | [backend/tests/test_edit_delete.py](../backend/tests/test_edit_delete.py) |
| Fase 4: nuevo o modificado | [backend/tests/test_operations.py](../backend/tests/test_operations.py) |
| Fase 4: nuevo o modificado | [backend/tests/test_payments.py](../backend/tests/test_payments.py) |
| Fase 4: nuevo o modificado | [backend/tests/test_schema.py](../backend/tests/test_schema.py) |
| Fase 2: conservado sin cambios | [docs/05_database_model.md](../docs/05_database_model.md) |
| Fase 2: conservado sin cambios | [docs/07_offline_sync.md](../docs/07_offline_sync.md) |
| Fase 2: conservado sin cambios | [docs/08_security.md](../docs/08_security.md) |
| Fase 2: conservado sin cambios | [docs/15_local_workspace.md](../docs/15_local_workspace.md) |
| Fase 2: conservado sin cambios | [frontend/.env.example](../frontend/.env.example) |
| Fase 4: nuevo o modificado | [frontend/local-e2e/payment-flow.ts](../frontend/local-e2e/payment-flow.ts) |
| Fase 4: nuevo o modificado | [frontend/local-e2e/record-lifecycle.ts](../frontend/local-e2e/record-lifecycle.ts) |
| Fase 4: nuevo o modificado | [frontend/local-e2e/remission-flow.ts](../frontend/local-e2e/remission-flow.ts) |
| Fase 2: conservado sin cambios | [frontend/package.json](../frontend/package.json) |
| Fase 2: conservado sin cambios | [frontend/playwright.local.config.ts](../frontend/playwright.local.config.ts) |
| Fase 4: nuevo o modificado | [frontend/playwright.online.config.ts](../frontend/playwright.online.config.ts) |
| Fase 2: conservado sin cambios | [frontend/src/app/App.tsx](../frontend/src/app/App.tsx) |
| Fase 2: conservado sin cambios | [frontend/src/app/Layout.tsx](../frontend/src/app/Layout.tsx) |
| Fase 4: nuevo o modificado | [frontend/src/components/DeleteRecordButton.tsx](../frontend/src/components/DeleteRecordButton.tsx) |
| Fase 2: conservado sin cambios | [frontend/src/features/auth/AuthProvider.tsx](../frontend/src/features/auth/AuthProvider.tsx) |
| Fase 4: nuevo o modificado | [frontend/src/features/customers/CustomerPages.tsx](../frontend/src/features/customers/CustomerPages.tsx) |
| Fase 2: conservado sin cambios | [frontend/src/features/orders/OrderPages.tsx](../frontend/src/features/orders/OrderPages.tsx) |
| Fase 2: conservado sin cambios | [frontend/src/features/orders/pending-files.ts](../frontend/src/features/orders/pending-files.ts) |
| Fase 4: nuevo o modificado | [frontend/src/features/payments/PaymentDetailPage.tsx](../frontend/src/features/payments/PaymentDetailPage.tsx) |
| Fase 2: conservado sin cambios | [frontend/src/features/payments/PaymentFormPage.tsx](../frontend/src/features/payments/PaymentFormPage.tsx) |
| Fase 2: conservado sin cambios | [frontend/src/features/payments/payment-drafts.ts](../frontend/src/features/payments/payment-drafts.ts) |
| Fase 4: ampliado sobre fase 2 | [frontend/src/features/settings/SettingsPage.tsx](../frontend/src/features/settings/SettingsPage.tsx) |
| Fase 2: conservado sin cambios | [frontend/src/features/sync/SyncPage.tsx](../frontend/src/features/sync/SyncPage.tsx) |
| Fase 4: nuevo o modificado | [frontend/src/lib/api-error.ts](../frontend/src/lib/api-error.ts) |
| Fase 4: ampliado sobre fase 2 | [frontend/src/lib/business-api.ts](../frontend/src/lib/business-api.ts) |
| Fase 2: conservado sin cambios | [frontend/src/lib/env.ts](../frontend/src/lib/env.ts) |
| Fase 2: conservado sin cambios | [frontend/src/test/App.test.tsx](../frontend/src/test/App.test.tsx) |
| Fase 2: conservado sin cambios | [frontend/src/test/business-scope.test.ts](../frontend/src/test/business-scope.test.ts) |
| Fase 4: ampliado sobre fase 2 | [main.py](../main.py) |
| Fase 2: conservado sin cambios | [backend/alembic.local.ini](../backend/alembic.local.ini) |
| Fase 4: nuevo o modificado | [backend/app/api/history.py](../backend/app/api/history.py) |
| Fase 2: conservado sin cambios | [backend/app/local/__init__.py](../backend/app/local/__init__.py) |
| Fase 4: ampliado sobre fase 2 | [backend/app/local/application.py](../backend/app/local/application.py) |
| Fase 4: ampliado sobre fase 2 | [backend/app/local/cli.py](../backend/app/local/cli.py) |
| Fase 2: conservado sin cambios | [backend/app/local/database.py](../backend/app/local/database.py) |
| Fase 4: nuevo o modificado | [backend/app/local/diagnostics.py](../backend/app/local/diagnostics.py) |
| Fase 2: conservado sin cambios | [backend/app/local/files.py](../backend/app/local/files.py) |
| Fase 4: ampliado sobre fase 2 | [backend/app/local/models.py](../backend/app/local/models.py) |
| Fase 2: conservado sin cambios | [backend/app/local/paths.py](../backend/app/local/paths.py) |
| Fase 4: nuevo o modificado | [backend/app/local/preservation.py](../backend/app/local/preservation.py) |
| Fase 4: nuevo o modificado | [backend/app/local/reconciliation.py](../backend/app/local/reconciliation.py) |
| Fase 4: ampliado sobre fase 2 | [backend/app/local/routes.py](../backend/app/local/routes.py) |
| Fase 4: ampliado sobre fase 2 | [backend/app/local/runtime.py](../backend/app/local/runtime.py) |
| Fase 4: nuevo o modificado | [backend/app/modules/transactions.py](../backend/app/modules/transactions.py) |
| Fase 4: nuevo o modificado | [backend/app/persistence/preservation.py](../backend/app/persistence/preservation.py) |
| Fase 2: conservado sin cambios | [backend/local_migrations/env.py](../backend/local_migrations/env.py) |
| Fase 2: conservado sin cambios | [backend/local_migrations/versions/local_0001_initial.py](../backend/local_migrations/versions/local_0001_initial.py) |
| Fase 2: conservado sin cambios | [backend/local_migrations/versions/local_0002_blobs.py](../backend/local_migrations/versions/local_0002_blobs.py) |
| Fase 4: nuevo o modificado | [backend/local_migrations/versions/local_0003_audit_operations.py](../backend/local_migrations/versions/local_0003_audit_operations.py) |
| Fase 4: nuevo o modificado | [backend/local_migrations/versions/local_0004_document_metadata.py](../backend/local_migrations/versions/local_0004_document_metadata.py) |
| Fase 4: nuevo o modificado | [backend/migrations/versions/0009_audit_operations.py](../backend/migrations/versions/0009_audit_operations.py) |
| Fase 2: conservado sin cambios | [backend/tests/sqlite_browser_server.py](../backend/tests/sqlite_browser_server.py) |
| Fase 4: ampliado sobre fase 2 | [backend/tests/sqlite_crash_worker.py](../backend/tests/sqlite_crash_worker.py) |
| Fase 4: nuevo o modificado | [backend/tests/test_launcher.py](../backend/tests/test_launcher.py) |
| Fase 4: nuevo o modificado | [backend/tests/test_phase4_integrity.py](../backend/tests/test_phase4_integrity.py) |
| Fase 4: nuevo o modificado | [backend/tests/test_postgresql_preservation_guard.py](../backend/tests/test_postgresql_preservation_guard.py) |
| Fase 4: nuevo o modificado | [backend/tests/test_preservation.py](../backend/tests/test_preservation.py) |
| Fase 4: ampliado sobre fase 2 | [backend/tests/test_sqlite_local.py](../backend/tests/test_sqlite_local.py) |
| Fase 4: ampliado sobre fase 2 | [docs/22_sqlite_local.md](../docs/22_sqlite_local.md) |
| Fase 2: conservado sin cambios | [docs/23_sqlite_stage_b_report.md](../docs/23_sqlite_stage_b_report.md) |
| Fase 4: nuevo o modificado | [docs/24_phase4_integrity_report.md](../docs/24_phase4_integrity_report.md) |
| Fase 2: conservado sin cambios | [frontend/playwright.sqlite.config.ts](../frontend/playwright.sqlite.config.ts) |
| Fase 2: conservado sin cambios | [frontend/sqlite-e2e/00-legacy.spec.ts](../frontend/sqlite-e2e/00-legacy.spec.ts) |
| Fase 2: conservado sin cambios | [frontend/sqlite-e2e/fixtures.ts](../frontend/sqlite-e2e/fixtures.ts) |
| Fase 4: nuevo o modificado | [frontend/sqlite-e2e/integrity.spec.ts](../frontend/sqlite-e2e/integrity.spec.ts) |
| Fase 2: conservado sin cambios | [frontend/sqlite-e2e/operations.spec.ts](../frontend/sqlite-e2e/operations.spec.ts) |
| Fase 4: nuevo o modificado | [frontend/src/components/LocalDiagnostics.tsx](../frontend/src/components/LocalDiagnostics.tsx) |
| Fase 2: conservado sin cambios | [frontend/src/components/LocalStorageNotice.tsx](../frontend/src/components/LocalStorageNotice.tsx) |
| Fase 2: conservado sin cambios | [frontend/src/lib/legacy-storage.ts](../frontend/src/lib/legacy-storage.ts) |
| Fase 4: ampliado sobre fase 2 | [frontend/src/lib/local-api.ts](../frontend/src/lib/local-api.ts) |
| Fase 2: conservado sin cambios | [frontend/src/lib/sqlite-captures.ts](../frontend/src/lib/sqlite-captures.ts) |
| Fase 4: nuevo o modificado | [frontend/src/test/local-outcomes.test.ts](../frontend/src/test/local-outcomes.test.ts) |
| Fase 2: conservado sin cambios | [frontend/src/test/sqlite-captures.test.ts](../frontend/src/test/sqlite-captures.test.ts) |
