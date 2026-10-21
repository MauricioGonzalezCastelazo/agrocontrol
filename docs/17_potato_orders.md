# 17 · Pedidos de papa — entrega del 20 de octubre de 2026

**Reporte histórico:** el ajuste posterior cambia PESO TOTAL para descontar MERMA y añade comas de miles en todos los campos numéricos. La fórmula vigente y la migración 0005 están en [18](18_potato_formula_number_format.md). Los ejemplos v1 y la evidencia de esta entrega se conservan a continuación como historial.

## Resultado

Papa se puede crear, consultar, modificar y eliminar desde los mismos flujos de zanahoria. El selector Producto muestra ambos formularios y permite cambiar de producto al editar, conservando cliente, fecha, descripción, UUID y archivos. Se mantiene el buscador integrado en Nombre del cliente, el directorio y sus permisos. No se reinicia IndexedDB ni se modifican los registros existentes por una migración automática del navegador.

Para probar sin Supabase: `python main.py` desde la raíz, abrir **http://127.0.0.1:5174/** en el mismo perfil y entrar en Pedidos → Nuevo pedido → Papa. Crear primero un cliente si no existe. La información de ese modo permanece únicamente en ese navegador, sin copia en servidor ni migración a la nube.

## Formulario y cálculos

Información general arriba: cliente, producto, fecha editable y descripción. Cuatro tarjetas: **1RA · Papa bonita**, **2DA · Papa bien**, **3RA · Papa regular**, **4TA · Papa pequeña**. Cada tarjeta contiene Cantidad y Precio unitario, más Peso unitario neto, Peso neto e Importe de solo lectura. Dos columnas en escritorio y una en móvil. Pesaje debajo con BRUTO, TARA, MERMA ADICIONAL y resultados automáticos. Total MXN en formulario y resumen lateral; adjuntos antes de guardar. Sin botón Calcular.

```text
PESO = BRUTO − TARA
CANTIDAD TOTAL = suma de cantidades
PESO TOTAL = PESO − MERMA ADICIONAL
PESO UNITARIO NETO = PESO TOTAL / CANTIDAD TOTAL
Peso neto de línea = cantidad de línea × PESO UNITARIO NETO
Importe de línea = peso neto de línea × precio unitario de línea
Total = suma de importes
```

Ejemplo verificado: bruto 12000, tara 2000, merma adicional 400; 100 de 1RA a 10 y 700 de 3RA a 5. Cantidad total 800, peso 10000, peso total 9600, peso unitario neto 12. Pesos por clasificación 1200/0/8400/0; importes 12000/0/42000/0; **total $54,000.00 MXN**. Cambiar merma a 200 produce $55,125.00; a cero, $56,250.00.

Clasificaciones sin uso equivalen a cero; cantidad positiva requiere precio explícito. Se rechazan negativos, tara ≥ bruto, bruto cero, merma superior al peso, cantidades todas cero y entradas fuera de escala/rango. Las salidas dependientes de datos faltantes muestran Pendiente; el PESO puede calcularse antes de introducir precios. No se divide entre cero.

**Dos reglas comerciales pendientes de confirmar:**

1. Se usa **peso neto de clasificación × precio unitario**, conforme al documento final, aunque el mensaje previo decía peso unitario × precio. Es un supuesto provisional registrado, sin pedir al usuario una nueva autorización para implementar.
2. La suma de cantidades se llama **CANTIDAD TOTAL**, no merma, y no se resta del peso. Solo MERMA ADICIONAL resta peso. El código es 4TA; 4RA se interpreta como errata.

No se fija kg ni una unidad comercial de Cantidad. Todos los pesos de un pedido deben usar la misma unidad y el precio se interpreta por esa unidad de peso. La unidad real y el redondeo comercial a centavos siguen pendientes de confirmación.

## Motor compartido y precisión

`backend/app/domain/potato-rules.json` contiene códigos, fórmulas declarativas, límites y escalas. Python (`Fraction`) y TypeScript (fracciones con `BigInt`) interpretan el mismo contrato; `potato-fixtures.json` aporta vectores comunes. No se utilizan floats financieros ni se redondea el promedio antes de distribuir pesos/importes.

Entradas de cuatro decimales; pesos/cantidades hasta 9999999999.9999, precios hasta 99999999999999.9999. Salidas de ocho decimales, HALF_UP al final. Total monetario como suma de importes de línea redondeados; tolerancia de suma de pesos de 0.00000002 por representación de cuatro líneas. Los valores mostrados del promedio no se reutilizan como entrada de cálculo. El servidor vuelve a calcular desde valores tipados y no acepta totales proporcionados por el cliente.

Zanahoria conserva su producto exacto de hectáreas × precio y sus contratos de entrada. MXN se muestra con mínimo dos y hasta ocho decimales, sin adoptar un redondeo comercial nuevo.

## Persistencia, API y migración

Aplicar desde backend con la base configurada y respaldada:

```powershell
..\.venv\Scripts\alembic upgrade head
```

La revisión **0004_potato**, posterior a 0003_edit_delete, amplía productos admitidos y crea:

- `order_potato_details`: pedido/organización, bruto, tara y merma adicional NUMERIC(14,4), con checks y referencia compuesta.
- `order_potato_lines`: PK pedido/código, organización, cantidad NUMERIC(14,4), precio NUMERIC(18,4), cuatro códigos fijos y no negativos.
- `orders.updated_by`: actor verificado de última modificación, junto a updated_at/version existentes.

No se guardan copias editables de pesos derivados. `orders.total_amount` conserva NUMERIC(32,8) y se escribe atómicamente con detalles, líneas, manifiestos y auditoría. Edición puede convertir producto; elimina detalles del anterior dentro de la misma transacción. UUID, creador y creación permanecen. El downgrade se niega si hay pedidos de papa, incluidos eliminados, para evitar pérdida de datos.

POST/PATCH `/api/v1/orders` conserva rutas y cabeceras privadas; `product_type` elige un detalle tipado. La respuesta papa trae `potato` con entradas/resultados/líneas y campos planos de zanahoria null. Añade updated_at/updated_by. GET, filtro, DELETE lógico, autorización y descarga reutilizan el flujo existente. Detalle contractual en [06](06_api_specification.md).

Los contratos JSON se incluyen en el paquete Python. Docker web utiliza contexto raíz y copia esos contratos para que la importación Vite funcione; Compose no arranca migraciones concurrentes dentro de workers. No se desplegó ni se migró una base comercial.

## Adjuntos

Lista compartida: JPG/JPEG, PNG, WEBP, HEIC/HEIF, PDF, XLSX, XLS, DOCX, DOC, TXT, CSV, ODT y ODS. Límites: 25 MiB por archivo, 20 archivos y 100 MiB por pedido, sin vacíos. Se valida en cliente/API. Ejecutables, HTML/SVG, macros y comprimidos quedan fuera de la lista. Archivos históricos ya confirmados conservan descarga.

Selección múltiple con nombre, extensión, tamaño y estado; vista previa de JPEG/PNG/WEBP; retiro antes de guardar o al editar. HEIC/HEIF se conserva original, sin prometer preview o conversión donde no sea compatible. La API verifica hash/tamaño y sirve descarga privada forzada; no interpreta documentos. No hay antivirus, escaneo de firmas documentales, compresión ni eliminación de EXIF.

## Offline, sincronización y conflictos

La captura y los blobs se conservan transaccionalmente antes de enviar. Sin internet se guardan borradores editables con UUID y versión base. Intentos inciertos conservan cuerpo e identificadores; reintentar no duplica pedidos. Los adjuntos permanecen pendientes hasta confirmar todos los bytes. Retirarlos también limpia sus referencias de cola. Ni logout ni actualización de shell borran capturas.

En modo privado solo se consultan datos previamente autorizados, por organización/usuario/rol, durante la sesión verificada hasta exp del token. Tokens/permiso permanecen en memoria; recargar o reabrir en frío requiere login con internet. No hay autorización de 24 horas inventada. Caché no sustituye un rechazo HTTP y no sirve para comparar conflictos. Cambiar/vencer sesión bloquea lectura y respuestas en vuelo no se guardan bajo otra identidad.

Con app abierta, el retorno de conexión inicia reintento; se difiere mientras haya formulario activo y se retoma al salir. Existe botón manual. No se promete ejecución con iOS cerrado. El Service Worker de producción cachea únicamente el shell público, sin API ni archivos. La instalación mediante manifiesto PWA está pendiente.

409 conserva captura/archivos y ofrece comparar servidor/local. Elegir servidor descarta explícitamente la captura; elegir cambios locales requiere confirmación y CAS contra la versión revisada. Una nueva modificación concurrente vuelve a producir conflicto. Formularios avisan al abandonar cambios sin guardar. No hay fusión automática.

## Archivos principales de esta entrega

| Área | Archivos |
|---|---|
| Reglas y cálculo | `backend/app/domain/{__init__.py,potato-rules.json,potato-fixtures.json,potato.py}`; `frontend/src/features/orders/potato-domain.ts` |
| Contrato de archivos | `backend/app/domain/{attachment-policy.json,attachments.py}`; `frontend/src/lib/attachment-policy.ts` |
| Persistencia/API | `backend/app/persistence/models.py`; `backend/app/modules/{schemas.py,operations.py,private_files.py}`; `backend/app/api/files.py`; `backend/migrations/versions/0004_potato.py`; `backend/pyproject.toml` |
| Formulario/detalle | `frontend/src/features/orders/{PotatoFields.tsx,OrderPages.tsx,products.tsx,FilePicker.tsx,ConflictResolution.tsx,pending-files.ts}` |
| Adaptadores y sesión | `frontend/src/lib/{business-api.ts,local-workspace.ts,private-cache.ts,session-scope.ts}`; `frontend/src/features/auth/AuthProvider.tsx` |
| App y estilo | `frontend/src/app/{App.tsx,Layout.tsx}`; `frontend/src/main.tsx`; `frontend/src/styles.css`; páginas de inicio, configuración y sincronización |
| Shell/build | `frontend/service-worker.js`; `frontend/vite.config.ts`; `frontend/{Dockerfile,package.json,package-lock.json,tsconfig.json}`; `compose.yaml`; `.dockerignore`; `.gitignore` |
| Pruebas | `backend/tests/{test_potato.py,test_schema.py,test_operations.py}`; `frontend/src/test/{potato.test.ts,session-scope.test.ts,App.test.tsx}`; `frontend/local-e2e/{potato-flow.ts,potato.spec.ts}`; `frontend/online-e2e/potato.spec.ts`; `frontend/production-e2e/access.spec.ts`; `frontend/playwright.local.config.ts`; ajuste de expectativa en `frontend/e2e/workspace.spec.ts` |
| Documentación | `README.md`, `CHANGELOG.md`, documentos 02–09 y 11; este reporte |

## Evidencia y límites

**172 pruebas aprobadas**, sin omitidas en la ejecución con PostgreSQL dedicado:

| Verificación | Resultado |
|---|---|
| Backend pytest, incluido PostgreSQL 17 | 88 aprobadas |
| Vitest: zanahoria, papa y autorización local | 42 aprobadas |
| Playwright contra API real, escritorio/móvil | 10 aprobadas |
| Playwright modo local, escritorio/móvil | 10 aprobadas |
| Playwright navegación/vista previa/accesibilidad | 20 aprobadas |
| Playwright build de producción y shell offline | 2 aprobadas |
| TypeScript y build Vite | Correctos |
| Ruff y formato Python; Prettier | Correctos |
| Docker Compose, validación de configuración | Correcta; no se construyó toda la pila Docker |
| Wheel Python | Construido; tres JSON compartidos incluidos |

Las pruebas PostgreSQL crearon/migraron/revirtieron una base vacía efímera, comprobando equivalencia de metadata y persistencia exacta. El contenedor de prueba se detuvo al terminar. El servidor local de interfaz del usuario sigue en 127.0.0.1:5174. Las suites finales de API y local pasaron completas; no se ocultaron conflictos ni fallos con mocks de operaciones de negocio. Solo el transporte de identidad externa se sustituye por el arnés aislado.

Capturas locales con contextos de navegador aislados y datos sintéticos: [formulario escritorio](../.local/potato-form-desktop.png), [formulario móvil](../.local/potato-form-mobile.png), [detalle escritorio](../.local/potato-detail-desktop.png), [detalle móvil](../.local/potato-detail-mobile.png). No se agregaron clientes de prueba al perfil real del usuario.

Pendiente: confirmaciones comerciales indicadas; proyecto Supabase externo; login en frío offline; alta privada de clientes offline; migración del espacio local a nube; respaldo/exportación; manifiesto PWA; catálogo por cursor; Web Locks entre pestañas; pruebas de cuota/desalojo y actualización con outbox ocupada; Safari/iPhone y Android físicos. El navegador no sustituye un respaldo. No se desplegó a producción.
