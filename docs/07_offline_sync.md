# 07 · Trabajo sin conexión y sincronización

## Implementado

Modo local de desarrollo: clientes, ambos productos y archivos en el navegador, sin cuenta ni servidor. Acceso privado: autenticación online; durante la misma sesión verificada vigente permite usar registros consultados y capturar pedidos sin red. El modo local no envía sus datos a la API privada.

El build de producción precachea únicamente shell: HTML, scripts, CSS, fuentes e icono. Nunca API, tokens, JWKS, solicitudes autorizadas o archivos privados. El Service Worker no fuerza activación durante captura ni modifica IndexedDB; cambia caché al activarse nueva versión. Sin manifiesto de instalación PWA en esta entrega.

## Autorización y almacenamiento

- Tokens y autorización verificada solo en memoria. Plazo offline hasta exp del token verificado por la API; no se concede autorización adicional de 24 horas.
- Caché Dexie de registros consultados por organización/usuario/rol. Se usa sin red o ante fallo de transporte; nunca oculta 401/403/404/410. No descarga todo el catálogo.
- Sin autorización vigente se bloquea lectura privada. Cerrar sesión limpia memoria y bloquea caché, sin borrar capturas/blobs. Recargar app privada exige volver a ingresar con internet.
- Servidor revalida identidad/membresía por envío. Revocaciones no se conocen instantáneamente sin red. IndexedDB no es cifrado ni respaldo; importan perfil y dirección del navegador.

## Captura y envío

1. Captura y archivos en transacción Dexie con organización, usuario, UUID estable, create/update, decimales y versión base. Sin red muestra captura pendiente, sin afirmar guardado en servidor.
2. Borrador nunca intentado se abre en `/borradores/:id`, modifica y guarda sin red. Cálculos locales. Intento de respuesta incierta conserva cuerpo/UUID hasta confirmar estado.
3. Se marca el intento antes de transmitir. UUID/huella de creación y versión/huella de edición permiten reintentos idempotentes. No regenerar identificadores por respuesta perdida.
4. Pedido antes de blobs. Cada archivo sale de cola al confirmar subida; falta de algún archivo mantiene Archivos pendientes. Retirados no se vuelven a subir; 410 confirmado descarta operación del registro eliminado.
5. Reintento manual en Sincronización o automático al evento online con app abierta, sesión vigente y sin formulario activo. Guardar o usar reintento después. No se promete ejecución con iOS cerrado ni Background Sync.
6. Coordinador en memoria por pestaña. UUID/CAS/idempotencia protegen frente a otras pestañas; Web Locks, backoff y cursores pendientes.

## Conflictos

409 conserva captura/archivos. Comparar versiones exige versión real con conexión y muestra datos/archivos frente al servidor. Conservar versión del servidor descarta explícitamente la captura y sus archivos nuevos, conservando los actuales del servidor. Usar mis cambios pide confirmación y envía con versión revisada; una nueva modificación concurrente puede causar otro 409. Sin fusión ni sobrescritura silenciosa.

Formularios avisan al abandonar cambios sin guardar. Tras logout, recuperar borradores exige misma cuenta autenticada. La migración Dexie conserva tablas previas y outbox.

## Fotos y documentos

Lista/límites compartidos en attachment-policy.json, validados en cliente/API. Preview solo JPEG/PNG/WEBP; HEIC/HEIF se conserva descargable, sin prometer decodificación incompatible. Sin compresión, reescalado ni eliminación EXIF. La API no ejecuta los documentos. Antivirus, firmas de contenido y límites de píxeles pendientes.

## Límites pendientes

Reapertura privada en frío sin red, alta privada de clientes offline, manifiesto PWA, almacenamiento persistente, catálogo por cursor/tombstones, retención local, exportación de respaldo, coordinador entre pestañas y pruebas de actualización con outbox ocupada. Cuota agotada, datos desalojados y teléfono perdido requieren recuperación. Safari/iOS y Android físicos pendientes.

## Cobros y saldo a favor

En el modo local los movimientos se guardan sin red con la aplicación abierta. En el modo privado se conserva la captura por usuario/organización y se reintenta con UUID fijo; los saldos cambian al confirmar el servidor. Cuentas y detalles financieros privados requieren conexión. La cola de cobros aparece en Sincronización. [Recuperación de respuestas y corrección de capturas](20_remissions_payments.md).
