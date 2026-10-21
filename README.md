# AgroControl

**Nuevo: remisiones, cobros y anticipos.** En Pedidos se captura la remisión y se consultan total, pagado y restante. En **Cobros** se registran pagos y saldo a favor por cliente, y se aplican a pedidos específicos. [Guía de uso y alcance](docs/20_remissions_payments.md).

Los pedidos pueden eliminarse cuando no tienen abonos vigentes, aunque conserven cobros anulados en su historial. Cobros separa **Vigentes** y **Anulados** y distingue anular el cobro completo de quitar su abono conservando el dinero a favor. [Uso de estas acciones](docs/21_clear_payments.md).

Plataforma para operaciones agrícolas. **Incremento actual: clientes, zanahoria por hectárea y papa por clasificación/pesaje, en MXN y con adjuntos.** Alta, edición y eliminación en el espacio local sin Supabase o mediante API privada. Incluye borradores offline durante sesión verificada vigente, reintento al recuperar conexión y comparación de conflictos. [Entrega de papa y límites](docs/17_potato_orders.md).

La interfaz usa React, TypeScript, Vite y Tailwind; la API FastAPI/Pydantic, SQLAlchemy/Alembic y PostgreSQL. Identidad mediante Supabase Auth con autorización independiente basada en membresías. No hay registro público, credenciales de demostración ni datos personales de ejemplo.

## Requisitos

- Node.js 24 LTS recomendado (mínimo 22.12), npm.
- Python 3.13 o 3.14; esta entrega se verifica localmente con 3.14.
- Docker Desktop con motor Linux activo y Compose v2 para el entorno completo.
- Un proyecto Supabase **de pruebas** configurado para firma JWT asimétrica si se desea validar login real. La base visual se puede revisar sin él.

## Usar clientes y pedidos ahora, sin Supabase

Desde `D:\agrocontrol` en PowerShell:

```powershell
python main.py
```

Abrir siempre [http://127.0.0.1:5174/](http://127.0.0.1:5174/). Si falta instalar dependencias, ejecutar una vez `npm ci` desde `frontend`. No hace falta arrancar la API, Docker o PostgreSQL para este modo.

1. Entrar en **Clientes → Nuevo cliente**, capturar el nombre y guardar.
2. Entrar en **Pedidos → Nuevo pedido**, seleccionar cliente, producto, remisión y fecha. Zanahoria: hectáreas y precio por hectárea. Papa: cantidad/precio de las clasificaciones utilizadas, BRUTO, TARA y MERMA ADICIONAL. El total se calcula automáticamente en MXN.
3. Agregar descripción y archivos si se desea y guardar el pedido. Volver a abrirlo o recargar para consultar lo guardado y descargar los adjuntos.
4. Entrar en **Cobros → Registrar cobro**, seleccionar cliente, monto, fecha y descripción. Aplicar a pedidos o conservar como anticipo. Desde un cobro se puede aplicar su saldo disponible más adelante.

La franja **«Modo local · Guardado habilitado»** confirma este modo. Clientes, pedidos y archivos se conservan en IndexedDB del navegador, incluso tras recargar o cerrar la pestaña. Usar el mismo perfil, dirección y puerto: `localhost` y `127.0.0.1` tienen almacenes diferentes. Borrar los datos del navegador elimina estos registros. Este modo no tiene cuentas individuales, copia en servidor ni sincronización con otros equipos; su migración a la nube queda pendiente.

`main.py` activa `VITE_ENABLE_LOCAL_WORKSPACE=true` para su servidor de desarrollo. También se puede poner esa variable en `frontend/.env` al usar Vite directamente. Solo funciona en desarrollo, en loopback y sin configuración completa de Supabase; el build de producción siempre conserva el acceso privado. Los enlaces antiguos `/vista-previa/...` abren la pantalla funcional correspondiente cuando el modo local está activo. La API privada no recibe identidades ni peticiones de este espacio local.

## Revisar la base visual sin credenciales

Desde `D:\agrocontrol` en PowerShell:

```powershell
Copy-Item frontend/.env.example frontend/.env
cd frontend
npm ci
npm run dev
```

Abrir [http://localhost:5173/login](http://localhost:5173/login) y elegir «Explorar la base visual», o [http://localhost:5173/vista-previa](http://localhost:5173/vista-previa).

La vista previa exige `VITE_ENABLE_PREVIEW=true`, `VITE_ENABLE_LOCAL_WORKSPACE=false` y modo desarrollo. Permite cambiar la fecha, capturar hectáreas/precio, ver el total MXN y seleccionar/quitar archivos. No llama endpoints privados ni guarda datos. En builds de producción queda deshabilitada. Para crear y guardar operaciones sin Supabase, usar el espacio local anterior.

## Entorno completo con Docker Compose

```powershell
Copy-Item .env.example .env
# Editar .env: sustituir POSTGRES_PASSWORD y el mismo valor en DATABASE_URL.
docker compose config --quiet
docker compose up --build
```

Usar contraseña local alfanumérica o codificar correctamente caracteres reservados en la URL PostgreSQL. `.env` está excluido de Git. No usar este archivo como configuración de producción.

Servicios: PostgreSQL `localhost:5432`, API [localhost:8000](http://localhost:8000), OpenAPI [localhost:8000/docs](http://localhost:8000/docs), interfaz compilada [localhost:8080](http://localhost:8080). Todos los puertos se publican solo en loopback. El servicio `migrate` espera a PostgreSQL y aplica Alembic antes del inicio de la API. `docker compose down` conserva el volumen de datos; no añadir `-v` si se quiere conservarlo.

La interfaz compilada muestra login sin vista previa. Para revisar diseño sin Supabase utilizar Vite en desarrollo. Las variables `VITE_*` se incorporan al compilar: cambiar `.env` requiere reconstruir `web`. Compose está preparado para desarrollo local, sin TLS ni despliegue de producción.

## API local sin contenedor

Desde la raíz, después de configurar `.env` y una base PostgreSQL disponible:

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -c backend/requirements.lock -e 'backend[dev]'
cd backend
../.venv/Scripts/alembic upgrade head
cd ..
.venv/Scripts/python main.py --api
```

En Linux/macOS usar `.venv/bin/python` y `.venv/bin/alembic`. `main.py --api` inicia únicamente la API privada; `main.py` sin argumentos inicia la interfaz local. La API está en `backend/app/main.py`. Se puede consultar `/health/live` sin base; `/health/ready` requiere esquema migrado. No se crea ninguna tabla automáticamente al arrancar.

## Conectar identidad privada

En el proyecto Supabase de pruebas: desactivar altas públicas, provisionar usuarios por invitación/administración y activar claves de firma asimétricas (ES256 o RS256). No se admite HS256 ni se distribuye la clave secreta de firma.

Configurar en `.env` de raíz y, para Vite, los valores públicos en `frontend/.env`:

```dotenv
AUTH_ISSUER=https://TU-PROYECTO.supabase.co/auth/v1
AUTH_JWKS_URL=https://TU-PROYECTO.supabase.co/auth/v1/.well-known/jwks.json
AUTH_AUDIENCE=authenticated
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=CLAVE_PUBLICA_DEL_PROYECTO
VITE_ORGANIZATION_ID=UUID_DE_LA_EMPRESA_DE_PRUEBAS
```

Crear organización y membresía únicamente mediante conexión administrativa de confianza a PostgreSQL. Plantilla SQL parametrizada; sustituir los identificadores por UUID nuevos y por el `sub` real del usuario invitado, sin reutilizar cuentas comerciales:

```sql
BEGIN;
INSERT INTO organizations (id, name) VALUES (:'organization_id', :'organization_name');
INSERT INTO memberships (organization_id, user_id, role)
VALUES (:'organization_id', :'supabase_user_id', 'administrator');
COMMIT;
```

Esta plantilla usa parámetros `psql`; no es un endpoint de alta pública. Ambos roles iniciales son `administrator` y `operator`. El navegador selecciona organización; la API verifica membresía activa y obtiene el rol de su propia base en cada petición. No confiar en metadatos editables por el usuario. Las sesiones se conservan solo en memoria en etapa 1; recargar exige volver a ingresar.

La integración real necesita credenciales y conectividad al proyecto de pruebas. Las pruebas locales utilizan claves efímeras y sustituyen el transporte de claves, sin llamar servicios de identidad reales.

## Verificación

```powershell
cd backend
../.venv/Scripts/python -m pytest -q
../.venv/Scripts/python -m ruff check .
../.venv/Scripts/python -m ruff format --check .
../.venv/Scripts/alembic upgrade head --sql
cd ../frontend
npm run test
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:production
npm run test:online
npm run test:local
npm run format:check
cd ..
docker compose --env-file .env.example config --quiet
```

Prueba PostgreSQL opcional local: definir `TEST_DATABASE_URL` hacia una base dedicada **vacía** cuyo nombre termine en `_test`; la suite realiza upgrade/downgrade y limpia ese esquema. Nunca usar una base con datos. CI utiliza PostgreSQL efímero y configura esa variable.

`test:online` ejecuta la interfaz contra la API real en una base SQLite temporal y privada; únicamente sustituye el proveedor externo de identidad por claves efímeras del arnés de pruebas. No habilita acceso de prueba en la aplicación ni utiliza datos comerciales. Requiere dependencias Python instaladas. La suite PostgreSQL verifica además las migraciones y la persistencia exacta de importes grandes y adjuntos.

Consultar el [ajuste de guardado local](docs/15_local_workspace.md) y el [reporte de clientes, zanahoria y adjuntos](docs/13_customers_carrot_attachments.md). Chromium móvil emulado no certifica iPhone/Android físicos. [Reporte histórico de etapa 1](docs/12_stage_1_report.md).

## Rutas y documentación

Rutas privadas: `/`, `/clientes`, `/clientes/nuevo`, `/clientes/:id/editar`, `/pedidos`, `/pedidos/nuevo`, `/pedidos/:id`, `/pedidos/:id/editar`, `/sincronizacion`, `/configuracion`. En desarrollo la vista previa replica esas rutas bajo `/vista-previa`.

- [Problema](docs/01_problem_statement.md), [requisitos](docs/02_requirements.md) y [reglas](docs/03_business_rules.md).
- [Arquitectura y design system](docs/04_architecture.md), [base de datos](docs/05_database_model.md), [API](docs/06_api_specification.md).
- [Offline y sincronización](docs/07_offline_sync.md), [seguridad](docs/08_security.md), [pruebas](docs/09_testing.md).
- [Roadmap](docs/10_roadmap.md), [preguntas abiertas](docs/11_open_questions.md), [reporte de entrega](docs/12_stage_1_report.md).

## Pedidos de zanahoria y archivos

Campos: cliente del directorio (con búsqueda dentro del desplegable «Nombre del cliente»), producto, fecha editable, precio MXN por hectárea, cantidad de hectáreas, total automático, descripción y adjuntos opcionales. El selector permite elegir con clic o flechas y Enter; Escape cierra la búsqueda conservando la selección. La fecha del pedido se guarda como fecha civil; `created_at` conserva cuándo se capturó. Se admiten cuatro decimales en entradas y se conservan ocho en el producto exacto, sin redondeo silencioso a centavos.

Adjuntos nuevos: JPG/JPEG, PNG, WEBP, HEIC/HEIF, PDF, XLSX, XLS, DOCX, DOC, TXT, CSV, ODT y ODS. Lista explícita compartida por cliente y API, sin ejecutables ni macros. Descarga binaria privada forzada, sin ejecución de documentos. Límites: 25 MiB por archivo, 20 archivos y 100 MiB por pedido; no vacíos. Se verifica hash/tamaño. Vista previa JPEG/PNG/WEBP; HEIC se conserva como original. No hay antivirus ni compresión automática.

Disco privado local: `PRIVATE_FILES_PATH`, por defecto `.local/private-files` desde la raíz. En Compose se usa el volumen `private_files`; debe respaldarse junto con PostgreSQL. Nunca apuntar a `frontend/public` ni servirlo como directorio estático.

Antes de enviar se conservan captura/archivos en Dexie por usuario/organización. Sin conexión y con sesión verificada vigente se puede crear y editar borradores; los clientes deben haberse consultado previamente. Una respuesta perdida se reintenta con el mismo UUID. «Archivos pendientes» permanece hasta confirmar todos los blobs. Reintento en `/sincronizacion` o al volver la conexión con app abierta y fuera de un formulario activo. Reiniciar sesión privada requiere internet; el shell offline de producción no persiste tokens ni cachea API. [Alcance offline](docs/07_offline_sync.md). El navegador puede perder datos: confirmar guardado en servidor antes de borrarlo o cambiar de dispositivo.

Clientes: en el directorio aparecen **Editar** y **Eliminar cliente** para administradores. Pedidos: abrir el detalle y elegir **Editar pedido** o **Eliminar pedido**; los operadores gestionan sus propios pedidos y los administradores los de su organización. La edición permite cambiar cliente, fecha, hectáreas, precio y descripción, y agregar o retirar archivos. El total se recalcula al guardar. Se conservan fecha de creación y responsable originales.

Toda eliminación pide confirmación. Se usa eliminación lógica: los clientes eliminados dejan de aparecer en el directorio y selector, pero sus pedidos conservan el nombre y se pueden consultar. Los pedidos eliminados desaparecen de listados y sus archivos no se pueden descargar. Los registros y archivos físicos se conservan para trazabilidad; no hay purga definitiva ni restauración desde la interfaz. Los clientes inactivos o eliminados no aceptan pedidos nuevos, pero pueden permanecer en sus pedidos históricos al editar otros campos.

Las ediciones y eliminaciones comprueban versión. Un conflicto de pedido permite comparar capturas y elegir explícitamente servidor o cambios locales. No hay fusión automática. Una respuesta perdida se reintenta sin duplicar cambios/archivos; un pedido eliminado no se recrea desde la cola. Al eliminarlo se libera su remisión para reutilizarla en el mismo producto, conservando las referencias de cobros del pedido anterior. Migración vigente: `0008_reusable_remissions`; aplicar `alembic upgrade head` desde `backend`. Conserva pedidos históricos, MERMA manual y cobros; cambia la unicidad de remisión a pedidos vigentes. El espacio local migra automáticamente a versión 3 al recargar y conserva sus datos sin reiniciarse. [Cobros y anticipos](docs/20_remissions_payments.md).

Papa: 1RA/2DA/3RA/4TA, PESO = BRUTO − TARA, **PESO TOTAL = PESO − MERMA ADICIONAL − CANTIDAD TOTAL** y PESO UNITARIO NETO = PESO TOTAL / CANTIDAD TOTAL. CANTIDAD TOTAL suma las clasificaciones. MERMA se llena con esa suma, pero permite borrar y escribir otro valor; al modificarla permanece manual hasta elegir Usar cantidad total. MERMA manual se guarda y no interviene en PESO TOTAL. CANTIDAD TOTAL más MERMA ADICIONAL no pueden superar PESO. Cada peso neto = cantidad × peso unitario; importe provisional = peso neto × precio. No se asume kg. Confirmaciones comerciales restantes en [preguntas abiertas](docs/11_open_questions.md).

Todos los campos numéricos de ambos formularios separan miles con comas mientras escribes: `1234567.8900` se muestra `1,234,567.8900`. Usa punto para decimales. También se agrupan pesos/cantidades de resultados, listas y detalle; los valores guardados/API siguen siendo decimales sin separadores.

Las fórmulas y límites de papa proceden del mismo JSON interpretado por TypeScript y Python con aritmética racional exacta; cuatro decimales de entrada y ocho de salida HALF_UP, sin redondeo intermedio. Docker web se construye desde la raíz para incluir ese contrato compartido.

Pendiente: Supabase externo, reapertura privada en frío offline, manifiesto PWA, respaldo/exportación y pruebas físicas de teléfonos. No se desplegó a producción.
