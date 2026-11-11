# Fase 2 · Persistencia local con SQLite

Esta fase sustituye el motor de guardado local por React → FastAPI local → SQLite. Los documentos se guardan en disco y sus metadatos en SQLite. Los modelos de negocio, contratos y fórmulas se comparten con el modo privado PostgreSQL. No se implementan Tauri, instaladores, Excel, SharePoint ni la migración de registros históricos.

## Iniciar

Requisitos: Python 3.13/3.14, Node.js 22.12 o superior y las dependencias instaladas. Desde la raíz:

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -c backend/requirements.lock -e 'backend[dev]'
cd frontend
npm ci
cd ..
python main.py
```

En macOS usar `.venv/bin/python` en lugar de `.venv/Scripts/python`. El lanzador elige automáticamente el intérprete de `.venv`, inicia ambos procesos y abre el navegador con una autorización temporal. Al recargar, la sesión local continúa mientras siga vigente y la API no se haya reiniciado. Después de reiniciar la API debe abrirse el enlace del nuevo arranque. No hay cuentas o login de Supabase en este modo.

La interfaz conserva `http://127.0.0.1:5174/` y la API escucha exclusivamente en `127.0.0.1:8000`. Si hay un servidor anterior en cualquiera de esos puertos, detenerlo primero con Ctrl+C. El lanzador no lo termina automáticamente ni cambia de puerto: cambiar el origen impediría detectar la información histórica del navegador.

`python main.py --api` sigue iniciando la API privada PostgreSQL/Supabase. Compose conserva su configuración privada. La base SQLite no se consulta desde ese modo.

## Ubicación de los datos

| Sistema | Directorio predeterminado |
|---|---|
| Windows | `%LOCALAPPDATA%\AgroControl` |
| macOS | `~/Library/Application Support/AgroControl` |
| Linux, desarrollo | `$XDG_DATA_HOME/agrocontrol` o `~/.local/share/agrocontrol` |

Dentro del directorio: `agrocontrol.sqlite3`, sus archivos auxiliares de journal y `attachments/`. Los documentos confirmados usan `attachments/<organización UUID>/<pedido UUID>/<adjunto UUID>`. Los documentos de capturas pendientes usan `attachments/staged/<adjunto UUID>`. El nombre original permanece como metadato y nunca construye la ruta física.

`AGROCONTROL_DATA_DIR` permite seleccionar explícitamente otra ruta absoluta, por ejemplo para una base de desarrollo independiente. Nunca apuntarla a los datos de una empresa para ejecutar pruebas. No colocar la base activa en una carpeta compartida o sincronizada. No sustituir la base ni borrar sus archivos auxiliares mientras la API está abierta.

## Migraciones e identidad

SQLite tiene una historia Alembic específica: `backend/alembic.local.ini` y `backend/local_migrations`. La inicialización aplica `local_0001` (esquema de negocio equivalente a PostgreSQL 0008 y cola local) y `local_0002` (documentos de capturas). El DDL inicial está congelado en la migración; no se crea el esquema mediante `create_all()` ni se omiten migraciones con `stamp`.

La historia privada `backend/migrations` permanece intacta. Los tipos SQLAlchemy siguen compilando a `NUMERIC` en PostgreSQL. SQLite utiliza enteros escalados por 10,000 para entradas de hasta cuatro decimales y texto decimal canónico para importes de hasta 32 dígitos y ocho decimales. Los totales y saldos se calculan con `Decimal`, sin `SUM` de importes a través de flotantes. La API conserva sus cadenas decimales originales.

La etapa B de la fase 4 agrega las revisiones `local_0003` y `local_0004`, así como `0009_audit_operations` en PostgreSQL, sin alterar las revisiones previas. Una actualización de SQLite existente verifica integridad y documentos confirmados y conserva una copia consistente con adjuntos antes de ejecutar el DDL. Se detiene si falla la verificación o la copia. [Procedimiento, restauración en carpeta nueva, diagnósticos y limitaciones](24_phase4_integrity_report.md).

La instalación crea una organización y una membresía local con UUID estables. No crea clientes, pedidos ni cobros de ejemplo. Todas las operaciones comerciales pasan por las validaciones, permisos, control de versiones y auditoría existentes.

Para aplicar solo las migraciones, desde `backend`:

```powershell
../.venv/Scripts/python -m app.local.cli migrate
```

En macOS usar `../.venv/bin/python`. El comando usa el directorio persistente configurado. Una revisión desconocida o un fallo de integridad detiene el arranque; no se reinicia ni se reemplaza la base para ocultar el problema.

## Transacciones y durabilidad

Cada conexión habilita `foreign_keys=ON`, espera de bloqueo de 15 segundos, `synchronous=EXTRA` y `fullfsync=ON` donde el sistema lo soporte. La base se inicia en `journal_mode=DELETE`.

El entorno auditado incluye SQLite 3.50.4. Esa versión está afectada por el problema WAL-reset documentado por SQLite; no se habilita WAL en esta entrega. Antes de habilitarlo habrá que verificar una versión corregida, usar `synchronous=FULL` y ejecutar de nuevo las pruebas de concurrencia e interrupción. Referencias: [WAL](https://www.sqlite.org/wal.html), [sincronización](https://www.sqlite.org/pragma.html#pragma_synchronous).

Las escrituras reservan `BEGIN IMMEDIATE` antes de leer saldos o versiones. Esto reemplaza, para SQLite, la protección que proporcionan los bloqueos por fila de PostgreSQL. Si otra escritura no termina a tiempo, se devuelve un error temporal: no se confirma un guardado ni se ignora el bloqueo. Una excepción revierte la transacción y cierra su sesión.

Los UUID y las huellas de las solicitudes conservan los reintentos idempotentes. Los cobros y sus aplicaciones siguen siendo atómicos. Las remisiones se reservan solo entre pedidos vigentes del mismo producto y organización. La auditoría impide UPDATE/DELETE en SQLite, y las tablas de clientes, pedidos y cobros impiden eliminaciones físicas; las acciones normales conservan la eliminación lógica.

## Capturas y documentos pendientes

Las nuevas capturas pendientes de pedidos y cobros se conservan en `local_capture_store`, con una revisión que evita sobrescribir cambios simultáneos de otras pestañas. Es una cola de recuperación; las operaciones confirmadas permanecen en las tablas normalizadas de negocio. La cola admite hasta 8 MiB de metadatos y 10,000 registros por colección; los archivos binarios no se incluyen en ese JSON.

Antes de subir documentos se confirma la captura y su manifiesto. Los documentos se escriben en archivos provisionales dentro del directorio persistente, se comprueban tamaño, SHA-256 y tipo permitido, se sincronizan a disco y después se reemplazan atómicamente. Finalmente se confirma su estado en SQLite. La descarga local vuelve a comprobar hash y tamaño.

SQLite y los archivos físicos no comparten una transacción única. Por eso se conservan estados pendientes y los originales preparados. Si el proceso se interrumpe tras escribir el archivo pero antes de confirmar sus metadatos, el reintento reconoce el contenido y completa la confirmación. Si la captura se recupera sin alguno de sus originales, la interfaz exige volver a seleccionarlo o retirarlo explícitamente; no elimina silenciosamente su referencia al guardar.

Retirar adjuntos o descartar una captura no purga sus documentos físicos. Tras un cierre abrupto pueden quedar archivos provisionales u objetos preparados sin referencia activa. No se implementa limpieza automática: se prioriza la conservación para una revisión posterior. Los archivos siguen siendo documentos opacos; no se ejecutan ni se declara protección antivirus.

Sin internet, la API de este mismo equipo continúa funcionando. Si la API no está disponible, la interfaz muestra el error y conserva el formulario abierto. Solo una respuesta confirmada permite afirmar que se guardó; una captura que nunca llegó a SQLite no puede recuperarse al cerrar la pestaña.

## Autorización local y límites

La API comprueba dirección del cliente, Host, Origin exacto, cookie de sesión y cabecera CSRF. CORS permite únicamente el origen de la interfaz configurada. Un proceso que solo conoce el puerto no puede consultar los registros sin autorización. Los endpoints comerciales conservan además la organización verificada del servidor.

El lanzador entrega una credencial aleatoria mediante el fragmento del enlace de arranque; React lo consume una sola vez y lo retira de la dirección. No se imprime ni se incluye en variables públicas VITE. El enlace vence a los diez minutos. La sesión usa cookie HttpOnly/SameSite=Strict y una credencial CSRF en memoria, vence a las doce horas y queda invalidada al reiniciar la API. Los registros de acceso HTTP están deshabilitados en el servidor local.

Esto no es aislamiento frente a malware, administradores del sistema, extensiones maliciosas o procesos que controlan la misma cuenta del sistema operativo. SQLite no cifra los datos por sí mismo. La carpeta personal del usuario y los permisos del sistema son parte de la protección. Este modo no habilita acceso desde otro equipo o teléfono; el recorrido móvil automatizado verifica la presentación en pantalla pequeña.

## Conservación de IndexedDB y preparación de la fase 3

El motor histórico y Dexie permanecen en el repositorio. El nuevo modo no los utiliza como destino ni ejecuta sus actualizaciones. Un lector separado enumera únicamente las bases existentes y abre transacciones `readonly`, sin solicitar un cambio de versión. Si no puede comprobarlas, lo comunica.

Cuando encuentra información anterior muestra “Migración pendiente”, incluso si ya existen operaciones nuevas en SQLite. La detección examina el mismo navegador, perfil y origen; no puede encontrar otras instalaciones o perfiles. No se mezclan bases ni se envían automáticamente sus cobros o borradores a SQLite.

Las regresiones del motor anterior se ejecutan con `VITE_LEGACY_LOCAL_TESTS=true` en perfiles sintéticos aislados. Ese indicador nunca lo activa el lanzador normal y no es un fallback ante fallos de SQLite.

La fase 3 deberá inventariar las cuatro bases Dexie, conservar UUID y fechas, resolver la identidad histórica de organización/usuario y comparar cantidades, importes, remisiones vigentes/históricas, anulaciones, aplicaciones, pendientes y hashes de archivos. Antes de mover datos deberá existir un procedimiento revisado de conservación y verificación. Esta entrega no realiza esa transferencia.

## Estados de conservación

- **Guardado local:** SQLite confirmó la operación; sus documentos pueden seguir pendientes individualmente.
- **Pendiente de respaldo externo:** estado de esta fase para la información local.
- **Protegido mediante respaldos externos verificados:** no se muestra ni se afirma en esta entrega.

La durabilidad de SQLite no reemplaza un respaldo externo ni permite garantizar conservación ante pérdida del equipo o fallo del almacenamiento. La futura integración SharePoint deberá incluir una instantánea consistente de SQLite, documentos, manifiestos y comprobación de restauración. No basta con copiar un archivo SQLite abierto.

## Verificación

Desde `backend`: `../.venv/Scripts/python -m pytest -q`, `ruff check .` y `ruff format --check .` mediante el mismo intérprete. Las pruebas nuevas usan bases migradas en disco y directorios exclusivamente sintéticos; incluyen procesos que terminan abruptamente antes/después del commit, fallos de documentos y solicitudes concurrentes.

Desde `frontend`: `npm run test`, `npm run build`, `npm run test:sqlite`, `npm run test:local`, `npm run test:online`, `npm run test:production` y `npm run format:check`. La suite SQLite inicia un arnés separado, sin endpoints de prueba en la aplicación normal.

Para PostgreSQL, `TEST_DATABASE_URL` debe señalar una base dedicada, vacía y con nombre terminado en `_test`. La prueba verifica migraciones, restricciones y concurrencia; nunca debe apuntar a una empresa. La ejecución física en macOS y teléfonos se reporta separadamente y no se infiere de pruebas Windows o emulación.

El [informe de verificación de la etapa B](23_sqlite_stage_b_report.md) registra los archivos, resultados ejecutados, correcciones y limitaciones de esta entrega.
