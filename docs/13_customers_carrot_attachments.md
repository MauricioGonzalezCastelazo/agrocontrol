# 13 · Clientes, zanahoria y adjuntos privados

Entrega: 20 de octubre de 2026. El usuario confirmó precio por hectárea y MXN y pidió fecha capturable y adjuntos de cualquier extensión. Se implementa la segunda etapa y el subincremento de archivos solicitado explícitamente. No se implementa indiscriminadamente el resto de la tercera etapa ni se despliega a producción.

**Estado de uso:** el código de persistencia y el recorrido de la aplicación están probados en entornos aislados. El usuario aún no tiene proyecto Supabase: para guardar desde su navegador necesita crear/configurar dicho proyecto, PostgreSQL y una membresía real. La vista previa permite probar los campos/cálculos/selección de archivos, pero no guarda datos comerciales ni utiliza una sesión de prueba.

## 1. Archivos creados o modificados

- API: `backend/app/api/business.py`, `files.py`, `main.py`.
- Aplicación: `backend/app/modules/{schemas,operations,private_files}.py`, configuración y modelos SQLAlchemy.
- Migración adicional: `backend/migrations/versions/0002_carrot_orders_files.py`. Se preserva la revisión inicial.
- Infraestructura: `compose.yaml`, `.env.example`, `backend/Dockerfile`, workflow CI. Volumen privado para archivos, usuario API sin privilegios.
- Web: formularios/listados de clientes y pedidos, detalle, registro de productos, `domain.ts`, `FilePicker.tsx`, `pending-files.ts`, `business-api.ts`, `QueryState.tsx`, `useUnsavedCapture.ts`, proveedor de autenticación y estilos.
- Navegación, inicio y configuración actualizados al incremento actual.
- Pruebas: `backend/tests/test_operations.py`, ajustes a suites existentes y `browser_server.py`; `frontend/src/test/carrot.test.ts`, E2E existentes, `online-e2e/orders.spec.ts`, `playwright.online.config.ts`, scripts npm.
- README y documentos 02–11 actualizados; este reporte y guía de activación privada añadidos. Reporte 12 conservado como evidencia histórica.

No se cambiaron las credenciales locales ni se subieron datos reales. Secretos de contenedores de pruebas, bases temporales, blobs y capturas QA quedan fuera de Git. El servidor de identidad de pruebas vive únicamente en `tests/`, se habilita explícitamente, usa claves efímeras y localhost; no se importa ni se distribuye en la API de producción.

## 2. Decisiones técnicas

- Fecha de pedido en `DATE`, independiente de `created_at` UTC y del responsable de sesión. Migración de registros previos toma la fecha de America/Mexico_City.
- Zanahoria: `price_unit=hectare`, `currency=MXN`; hectáreas y precio hasta cuatro decimales. El producto se conserva con ocho decimales. `Decimal` con precisión suficiente en servidor y `decimal.js` con precisión 40 en cliente. No convertir importes a `Number` ni redondear silenciosamente a centavos.
- Cliente referenciado por UUID; no agregar requisitos fiscales/comerciales no solicitados. Validación estricta y campos desconocidos rechazados; total, autor y organización no se aceptan del cuerpo como autoridad.
- UUID estable + huella canónica de creación para reintentos idempotentes. Pedido, detalle, manifiestos y auditoría se guardan en una transacción. UUID igual y contenido distinto produce 409. Edición de cliente con versión esperada y compare-and-swap.
- Roles provisionales restrictivos: ambos crean/consultan clientes; administrador edita clientes; operador consulta pedidos/archivos propios; administrador consulta los de su organización. Clientes inactivos no aceptan nuevos pedidos.
- Cualquier extensión se trata como bytes opacos: almacenamiento privado con rutas construidas solo con UUID y descarga autenticada como `application/octet-stream`, `Content-Disposition: attachment`, `nosniff` y `no-store`. No ejecutar ni mostrar documentos arbitrarios en servidor. Verificar tamaño y SHA-256, no confiar en MIME del navegador.
- Dexie almacena únicamente pedidos en envío y blobs pendientes con claves por usuario/organización. Conservación transaccional antes del primer envío; no borrar al cerrar sesión. Lectura/reintentos desde la aplicación requieren sesión validada; esto no implementa el modo offline completo.

## 3. Funcionalidades implementadas

Clientes: alta, consulta, búsqueda, paginación y edición administrativa; estados de carga, validación, error, vacío y éxito.

Pedido de zanahoria: buscador de clientes activos, selector por UUID, producto, fecha editable, precio unitario por hectárea, cantidad de hectáreas, precio total automático en MXN, descripción escrita y adjuntos opcionales. El total se recalcula al guardar en backend. Papa permanece bloqueada sin campos ficticios.

Pedidos guardados: listado y búsqueda por cliente, filtro por producto, detalle con fecha del pedido y fecha de registro separadas, responsable, cálculo, descripción, archivos y estado completo/pendiente.

Archivos: selección múltiple, cámara cuando el navegador lo permite, vista previa JPEG/PNG/WebP y eliminación antes de guardar. PDF, Office, HEIC, archivos comprimidos y otras extensiones se admiten como binarios. Límites iniciales: **25 MiB por archivo, 20 archivos y 100 MiB por pedido**, sin archivos vacíos; el servidor permite configurar límites. No hay compresión destructiva ni conversión de documentos.

Recuperación: una respuesta perdida de creación se reintenta con el mismo pedido. Un archivo solo pasa a ready después de guardarse y verificarse. Si falla uno, el pedido conserva «Archivos pendientes». Tras recargar y reautenticarse se reintentan los blobs desde el detalle o Envíos pendientes. Si la copia local desaparece, se puede seleccionar el original validado por hash/tamaño. Avisos al intentar descartar capturas sin guardar mediante enlaces internos o recarga.

## 4. Pruebas ejecutadas

| Suite / comprobación | Resultado final |
|---|---|
| Backend con PostgreSQL 17 real habilitado | **55 aprobadas**, sin omitidas |
| Frontend Vitest | **18 aprobadas** |
| Playwright de navegación/vista previa y accesibilidad | **20 aprobadas**, escritorio y móvil Chromium |
| Recorridos online contra la API y persistencia reales del arnés | **4 aprobadas**, escritorio y móvil |
| Protección del build compilado | **1 aprobada** |
| TypeScript y build Vite | Correctos |
| Ruff / formato Python, Prettier | Correctos |
| SQL de migraciones y configuración Compose | Correctos |

Total: **98 pruebas aprobadas**. Las 4 online usan la API real, archivos privados y una base SQLite temporal; sustituyen únicamente la identidad externa por un arnés aislado. La suite PostgreSQL usa un contenedor temporal PostgreSQL 17.11 (`pgvector/pgvector:pg17` ya disponible, sin utilizar la extensión vector).

Cobertura relevante: cálculo decimal mínimo/máximo, punto/coma en interfaz, precio inválido/float/notación exponencial, fecha inválida, campos desconocidos y total manipulable rechazados; altas/consulta/edición, cliente inactivo, conflicto de versión y acceso horizontal; creación repetida sin duplicados/eventos extra; upgrade/metadata/downgrade PostgreSQL, conservación exacta de un importe de 32 dígitos; checksum incorrecto, descarga privada forzada, subida repetida y adjunto incompleto. Los recorridos online simulan subida fallida y recarga con blobs retenidos y una respuesta de creación perdida después del commit.

Se revisó visualmente el formulario en escritorio y a 390 px, con cálculo y sin desbordamiento horizontal. Las pruebas emuladas no certifican teléfonos físicos. CI se actualizó, pero no se ejecutó en GitHub.

## 5. Riesgos y pendientes

- Crear/configurar un proyecto Supabase y usuarios reales de prueba, desactivar registro público, comprobar claves asimétricas y provisionar empresa/membresía. Login contra proveedor externo aún pendiente; no hay fallback de autenticación en producción.
- El motor PostgreSQL y las migraciones están verificados por separado; el build/arranque completo de Compose sigue pendiente por la descarga lenta de imágenes registrada en etapa 1. Su configuración incluye ahora volumen privado para archivos.
- No hay Service Worker, instalación PWA, catálogos offline, permiso de lectura/captura sin red, pull de cambios ni sincronización automática. El botón actual recupera envíos con conexión y sesión válida.
- El navegador puede desalojar Dexie y una pérdida de dispositivo puede destruir pendientes locales. Confirmar estado en servidor antes de borrar almacenamiento. Hay que respaldar PostgreSQL **y** el volumen privado de archivos.
- Los archivos no tienen análisis antivirus. Antes del uso comercial se necesita acordar esa política y retención. Las fotos conservan el original; compresión y legibilidad, HEIC/cámara y persistencia en iPhone/Android físicos siguen pendientes de validación.
- Las sesiones continúan en memoria: recargar requiere iniciar sesión otra vez. Los envíos pendientes permanecen aislados hasta que regrese la misma cuenta.
- La resolución editable de capturas locales rechazadas permanentemente y la coordinación avanzada entre pestañas quedan para el módulo completo de sincronización. No se borran pendientes ante errores.

## 6. Preguntas de negocio abiertas

Confirmados: hectáreas, precio por hectárea, MXN, fecha capturable y cualquier extensión de adjunto. Pendientes: redondeo comercial/presentación de importes, precio cero y límites numéricos habituales, matriz definitiva de permisos, reglas para corrección/cancelación de pedidos, folios, retención/antivirus de archivos y autorización offline. Ver documento 11.

## 7. Próximo incremento

Primero activar acceso privado real siguiendo [14_activate_private_access.md](14_activate_private_access.md), verificar un usuario autorizado y el recorrido cliente → pedido → consulta/descarga en un dispositivo real. Después abordar el resto de la etapa 3: PWA, preparación offline, permisos locales con expiración, coordinación y sincronización automática con pruebas de desconexión/conflictos. No desplegar todavía a producción.
