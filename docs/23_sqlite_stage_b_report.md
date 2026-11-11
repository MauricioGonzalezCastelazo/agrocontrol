# Informe de verificación y cierre de la etapa B: SQLite local

Fecha: 21 de octubre de 2026. Rama: `feature/sqlite-local`.

Resultado: implementación local terminada, 328 pruebas automáticas correctas y 1 omitida. Build, formato y análisis estático correctos. La ejecución contra PostgreSQL real queda pendiente por la indisponibilidad del entorno, detallada en las limitaciones.

## Alcance y estado

Se retomaron los archivos que quedaron guardados después del cierre de Visual Studio Code. La implementación de la persistencia SQLite ya estaba avanzada; se revisó el código y se corrigieron los problemas encontrados durante las pruebas. Los cambios permanecen en el árbol de trabajo de la rama solicitada, sin commit, push ni merge realizados en esta revisión.

Esta entrega corresponde exclusivamente a la etapa B de persistencia local (denominada fase 2 en `22_sqlite_local.md`). No ejecuta migración histórica ni implementa las fases 3 a 12 del nuevo roadmap. Las etapas numeradas del documento histórico `10_roadmap.md` corresponden a incrementos anteriores de AgroControl.

## Implementación verificada

| Condición autorizada | Resultado |
|---|---|
| SQLite como persistencia principal local | Clientes, pedidos, detalles de zanahoria y papa, cobros, aplicaciones, auditoría y capturas pendientes pasan por FastAPI local y SQLite en disco. Los adjuntos se conservan en la carpeta persistente de documentos. |
| Integridad, decimales y durabilidad | Migraciones Alembic separadas; claves foráneas activas; escritura con `BEGIN IMMEDIATE`; journal DELETE; `synchronous=EXTRA`; `fullfsync` donde se admita; entradas con enteros escalados; importes con texto decimal canónico; cálculos con Decimal/Fraction; auditoría e historial conservados. |
| Conservar IndexedDB | Las cuatro bases históricas permanecen. La detección consulta bases existentes en modo de lectura, sin cambio de versión. La interfaz avisa de la migración pendiente. No se importaron datos históricos. |
| Compatibilidad privada | Se conserva el arranque `python main.py --api`, la autenticación privada y la historia de migraciones PostgreSQL. Los tipos numéricos compilan a NUMERIC en ese motor. La prueba con PostgreSQL real tiene la limitación descrita abajo. |
| Rama independiente | Trabajo en `feature/sqlite-local`; sin push, merge ni operaciones destructivas de Git. |
| Interrupciones, duplicados y concurrencia | Pruebas con bases temporales migradas, terminación abrupta de procesos antes/después del commit, fallos de adjuntos, reinicios, reintentos por UUID y solicitudes simultáneas. |
| Respaldo externo | La interfaz identifica el guardado como local y el respaldo externo como pendiente. No se implementó SharePoint ni se afirma protección externa. |

## Correcciones completadas durante esta revisión

1. Se aisló el estado temporal de cada transacción de capturas. Antes, una acción concurrente de la misma pestaña podía unirse accidentalmente a otra transacción y resolverse antes de su commit. Ahora cada callback recibe sus propias tablas; las acciones externas esperan su propia confirmación y las lecturas externas solo ven datos confirmados. Las pruebas verifican tanto rollback como fallo de commit y recuperación posterior.
2. Se permitió abrir una captura cuyo documento preparado falta o falla su comprobación. Se conserva su manifiesto y se solicita seleccionar nuevamente el original o retirarlo explícitamente. Los errores de comunicación siguen presentándose al usuario.
3. Se bloqueó temporalmente el envío de un nuevo abono mientras se consultan los saldos de sus pedidos. Los recorridos detectaron que un guardado inmediato podía validar una aplicación vacía antes de cargar el saldo, aunque la pantalla se actualizara después. La prueba específica retrasa esa consulta, comprueba el bloqueo y verifica abono y saldo a favor al liberarla.
4. Se ampliaron las pruebas de terminación abrupta para interrumpir un cobro justo después de insertar su aplicación a un pedido. Tras reiniciar se comprueba atomicidad de cobro/aplicación/asignación, integridad, saldo del pedido, crédito y un único evento de creación después de los reintentos.
5. Se incluyó `sqlite-e2e` en el control de formato y se normalizaron sus archivos. Se amplió a 120 segundos el límite de arranque del proceso sintético de interrupción para tolerar el inicio de Python y las migraciones en Windows bajo carga.

## Resultados de pruebas

Entorno: Windows, Python 3.14.7, SQLite 3.50.4, Node.js 24.21.0 y Chromium de Playwright. Todas las pruebas de datos usan registros sintéticos y directorios temporales o exclusivos de pruebas; no apuntan al directorio comercial de la instalación.

| Directorio | Comando | Resultado final |
|---|---|---|
| `backend` | `../.venv/Scripts/python -m pytest -q` | 151 correctas, 1 omitida por falta de PostgreSQL dedicado. |
| `backend` | `../.venv/Scripts/python -m ruff check .` | Correcto. |
| `backend` | `../.venv/Scripts/python -m ruff format --check .` | 60 archivos correctos. |
| Raíz | `.venv/Scripts/python -m ruff check main.py` y `ruff format --check main.py` con el mismo intérprete | Correcto. |
| `frontend` | `npm test -- --maxWorkers=2` | 81 correctas en 8 archivos. |
| `frontend` | `npm run build` | TypeScript y build correctos; advertencia de tamaño de paquete. |
| `frontend` | `npm run format:check` | Correcto; incluye `sqlite-e2e`. |
| `frontend` | `npm run test:sqlite` | 24 correctas en escritorio y móvil emulado. |
| `frontend` | `npm run test:production` | 2 correctas: rutas privadas y shell sin conexión. |
| `frontend` | `npm run test:e2e -- --workers=1` | 20 correctas: acceso, navegación, formularios y accesibilidad. |
| `frontend` | `npm run test:online` | 22 correctas: API privada, edición, adjuntos, conflictos, cobros, anticipos y saldos. El arnés usa una base sintética; no equivale a probar PostgreSQL real. |
| `frontend` | `npm run test:local -- --workers=1` | 28 correctas: regresiones del motor IndexedDB anterior en perfiles sintéticos de escritorio/móvil, incluidos funcionamiento sin conexión, decimales, historial y cobros. |
| Raíz | `git diff --check` | Correcto. |

Incidencias durante la verificación: el primer recorrido detectó el envío prematuro de abonos antes de cargar saldos, y se corrigió con una prueba de consulta retrasada. Un primer proceso sintético excedió el límite de 30 segundos al arrancar bajo carga; se amplió su límite de arranque y se repitió la suite completa del backend con éxito. Una ejecución de Vitest agotó el tiempo de inicio de sus workers mientras había varias suites de navegador activas; se repitió con dos workers y pasaron sus 81 pruebas. Una espera de navegación de cinco segundos también se agotó en el primer recorrido privado bajo carga; la repetición completa pasó sus 22 pruebas. También se normalizó el formato de los nuevos recorridos SQLite. Ninguna ejecución fallida se contabiliza como validación aprobada.

Comprobación financiera concreta después de una interrupción/reinicio: de un pedido de `1000.00000000`, un cobro de `500.12345678` aplica `300.12345678`, deja `200.00000000` a favor y un saldo del pedido de `699.87654322`. El cierre previo al commit deja cero cobros/aplicaciones/asignaciones; el cierre posterior conserva uno de cada uno. Dos reintentos conservan un único cobro y un único evento de auditoría de creación.

## Limitaciones y riesgos

- No hay respaldo externo, SharePoint ni procedimiento de restauración implementado en esta etapa. Perder el equipo o su almacenamiento puede causar pérdida de información.
- SQLite y los adjuntos físicos no forman una sola transacción. Los estados pendientes, hashes y originales preparados permiten detectar y reintentar interrupciones. Pueden quedar archivos provisionales u objetos sin referencia; no se purgan automáticamente.
- Las pruebas terminan procesos e inyectan fallos de escritura/red. No certifican cortes eléctricos físicos, controladores de disco defectuosos, errores del dispositivo ni cumplimiento real de las órdenes de sincronización por el hardware.
- SQLite serializa escritores y espera hasta 15 segundos por bloqueos. Un bloqueo prolongado produce un error temporal; el guardado debe reintentarse. Las capturas de distintas pestañas usan revisión y pueden requerir reabrir/reintentar ante un conflicto.
- El modo local necesita la API de este equipo activa. Un formulario que nunca recibió confirmación de SQLite no tiene recuperación garantizada al cerrar su pestaña. Las sesiones locales deben autorizarse nuevamente después de reiniciar la API.
- El arranque sigue requiriendo el repositorio, Python, Node.js y sus dependencias. No se implementaron instaladores ni un servicio de inicio automático.
- No se migraron registros históricos. La detección de IndexedDB solo alcanza el mismo origen, perfil y navegador; una base nueva de SQLite no significa que se haya perdido la información anterior.
- La validación de documentos comprueba límites, hash, tamaño y determinadas firmas de formato. No es un análisis antivirus ni una certificación de que el documento sea inocuo.
- PostgreSQL real: no hay `TEST_DATABASE_URL` configurada y Docker Desktop falla al iniciar su motor WSL. La prueba dedicada queda omitida; las regresiones de la API privada y la generación SQL no sustituyen esa ejecución. El flujo CI conserva el trabajo con PostgreSQL 17 dedicado, pero no se ha ejecutado remotamente porque no se realizó push.
- La ejecución corresponde a Windows y Chromium con tamaños de escritorio/móvil. No certifica una instalación física en macOS ni teléfonos iOS/Android. Los trabajos CI para Windows/macOS quedan preparados, sin afirmar que se hayan ejecutado.
- El build de producción advierte de un paquete JavaScript de más de 500 kB. Es una observación de tamaño; no se amplió esta etapa para optimizar los paquetes.

## Archivos del cambio

El inventario siguiente incluye la implementación recuperada y las correcciones de esta revisión.
<!-- FILE_INVENTORY -->

Total: 59 archivos nuevos o modificados frente a `HEAD b03d5bf`.

| Estado | Archivo |
|---|---|
| Modificado | [.github/workflows/ci.yml](../.github/workflows/ci.yml) |
| Modificado | [.gitignore](../.gitignore) |
| Modificado | [CHANGELOG.md](../CHANGELOG.md) |
| Modificado | [README.md](../README.md) |
| Modificado | [backend/app/api/dependencies.py](../backend/app/api/dependencies.py) |
| Modificado | [backend/app/api/files.py](../backend/app/api/files.py) |
| Modificado | [backend/app/modules/operations.py](../backend/app/modules/operations.py) |
| Modificado | [backend/app/modules/payments.py](../backend/app/modules/payments.py) |
| Modificado | [backend/app/modules/private_files.py](../backend/app/modules/private_files.py) |
| Modificado | [backend/app/persistence/base.py](../backend/app/persistence/base.py) |
| Modificado | [backend/app/persistence/models.py](../backend/app/persistence/models.py) |
| Modificado | [docs/05_database_model.md](../docs/05_database_model.md) |
| Modificado | [docs/07_offline_sync.md](../docs/07_offline_sync.md) |
| Modificado | [docs/08_security.md](../docs/08_security.md) |
| Modificado | [docs/15_local_workspace.md](../docs/15_local_workspace.md) |
| Modificado | [frontend/.env.example](../frontend/.env.example) |
| Modificado | [frontend/package.json](../frontend/package.json) |
| Modificado | [frontend/playwright.local.config.ts](../frontend/playwright.local.config.ts) |
| Modificado | [frontend/src/app/App.tsx](../frontend/src/app/App.tsx) |
| Modificado | [frontend/src/app/Layout.tsx](../frontend/src/app/Layout.tsx) |
| Modificado | [frontend/src/features/auth/AuthProvider.tsx](../frontend/src/features/auth/AuthProvider.tsx) |
| Modificado | [frontend/src/features/orders/OrderPages.tsx](../frontend/src/features/orders/OrderPages.tsx) |
| Modificado | [frontend/src/features/orders/pending-files.ts](../frontend/src/features/orders/pending-files.ts) |
| Modificado | [frontend/src/features/payments/PaymentFormPage.tsx](../frontend/src/features/payments/PaymentFormPage.tsx) |
| Modificado | [frontend/src/features/payments/payment-drafts.ts](../frontend/src/features/payments/payment-drafts.ts) |
| Modificado | [frontend/src/features/settings/SettingsPage.tsx](../frontend/src/features/settings/SettingsPage.tsx) |
| Modificado | [frontend/src/features/sync/SyncPage.tsx](../frontend/src/features/sync/SyncPage.tsx) |
| Modificado | [frontend/src/lib/business-api.ts](../frontend/src/lib/business-api.ts) |
| Modificado | [frontend/src/lib/env.ts](../frontend/src/lib/env.ts) |
| Modificado | [frontend/src/test/App.test.tsx](../frontend/src/test/App.test.tsx) |
| Modificado | [frontend/src/test/business-scope.test.ts](../frontend/src/test/business-scope.test.ts) |
| Modificado | [main.py](../main.py) |
| Nuevo | [backend/alembic.local.ini](../backend/alembic.local.ini) |
| Nuevo | [backend/app/local/__init__.py](../backend/app/local/__init__.py) |
| Nuevo | [backend/app/local/application.py](../backend/app/local/application.py) |
| Nuevo | [backend/app/local/cli.py](../backend/app/local/cli.py) |
| Nuevo | [backend/app/local/database.py](../backend/app/local/database.py) |
| Nuevo | [backend/app/local/files.py](../backend/app/local/files.py) |
| Nuevo | [backend/app/local/models.py](../backend/app/local/models.py) |
| Nuevo | [backend/app/local/paths.py](../backend/app/local/paths.py) |
| Nuevo | [backend/app/local/routes.py](../backend/app/local/routes.py) |
| Nuevo | [backend/app/local/runtime.py](../backend/app/local/runtime.py) |
| Nuevo | [backend/local_migrations/env.py](../backend/local_migrations/env.py) |
| Nuevo | [backend/local_migrations/versions/local_0001_initial.py](../backend/local_migrations/versions/local_0001_initial.py) |
| Nuevo | [backend/local_migrations/versions/local_0002_blobs.py](../backend/local_migrations/versions/local_0002_blobs.py) |
| Nuevo | [backend/tests/sqlite_browser_server.py](../backend/tests/sqlite_browser_server.py) |
| Nuevo | [backend/tests/sqlite_crash_worker.py](../backend/tests/sqlite_crash_worker.py) |
| Nuevo | [backend/tests/test_sqlite_local.py](../backend/tests/test_sqlite_local.py) |
| Nuevo | [docs/22_sqlite_local.md](../docs/22_sqlite_local.md) |
| Nuevo | [docs/23_sqlite_stage_b_report.md](../docs/23_sqlite_stage_b_report.md) |
| Nuevo | [frontend/playwright.sqlite.config.ts](../frontend/playwright.sqlite.config.ts) |
| Nuevo | [frontend/sqlite-e2e/00-legacy.spec.ts](../frontend/sqlite-e2e/00-legacy.spec.ts) |
| Nuevo | [frontend/sqlite-e2e/fixtures.ts](../frontend/sqlite-e2e/fixtures.ts) |
| Nuevo | [frontend/sqlite-e2e/operations.spec.ts](../frontend/sqlite-e2e/operations.spec.ts) |
| Nuevo | [frontend/src/components/LocalStorageNotice.tsx](../frontend/src/components/LocalStorageNotice.tsx) |
| Nuevo | [frontend/src/lib/legacy-storage.ts](../frontend/src/lib/legacy-storage.ts) |
| Nuevo | [frontend/src/lib/local-api.ts](../frontend/src/lib/local-api.ts) |
| Nuevo | [frontend/src/lib/sqlite-captures.ts](../frontend/src/lib/sqlite-captures.ts) |
| Nuevo | [frontend/src/test/sqlite-captures.test.ts](../frontend/src/test/sqlite-captures.test.ts) |
