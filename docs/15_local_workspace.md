# Corrección: botones bloqueados y guardado local

## Problema y resultado

El usuario estaba abriendo `/vista-previa`, que deshabilitaba altas y guardado de manera deliberada. Aún no dispone de un proyecto Supabase, por lo que tampoco podía entrar al espacio privado. Quitar simplemente los atributos `disabled` habría dejado las peticiones sin autenticación y sin persistencia.

Se añadió un espacio local de desarrollo con persistencia real en IndexedDB, independiente de la API privada. Permite crear, editar, buscar y consultar clientes; registrar pedidos de zanahoria con fecha editable, MXN, cálculo decimal exacto, descripción y adjuntos; descargar los archivos guardados y recuperar capturas incompletas. Los registros sobreviven a recargas y cierres de pestaña.

## Puesta en marcha

Ejecutar `python main.py` desde la raíz y abrir `http://127.0.0.1:5174/`. El puerto es fijo para conservar el mismo origen del almacenamiento. Si ya está ocupado, el lanzador lo comunica sin abrir otro puerto. Los enlaces `/vista-previa/...` redirigen al formulario funcional cuando está activo el espacio local. Para iniciar la API privada se usa ahora `python main.py --api`.

## Decisiones y archivos

- `frontend/src/lib/local-workspace.ts`: adaptador de operaciones con Dexie; tablas separadas para clientes, pedidos y blobs, validación de entradas, cálculo mediante la regla decimal compartida, idempotencia por UUID/contenido y control de versión en edición. La confirmación de cada archivo y su estado se guardan en una sola transacción después de verificar hash y tamaño.
- `frontend/src/lib/env.ts`, `local-identity.ts`, `business-api.ts` y `features/auth/AuthProvider.tsx`: activación explícita únicamente en desarrollo, host loopback y sin configuración completa de Supabase. Identificadores locales sirven de namespace y no son credenciales. No se solicita token ni se llama a la API en este modo. El adaptador local se excluye de la compilación de producción.
- Rutas, layout, inicio, detalle de pedido, sincronización y configuración: acceso a formularios funcionales y mensajes precisos de guardado en navegador. No se anuncia sesión verificada o guardado en servidor para los registros locales.
- `main.py`, `.env.example`, README y CI: arranque simple, opción separada para la API y ejecución de la suite local.
- `frontend/local-e2e/workspace.spec.ts` y `playwright.local.config.ts`: pruebas completas en Chromium de escritorio y móvil emulado.

La base `agrocontrol-local-workspace` contiene los registros confirmados. `agrocontrol-pending-attachments` conserva capturas y archivos pendientes bajo identificadores locales propios; no se transfieren automáticamente a una cuenta de Supabase posterior. La identidad y autorización del backend no se modificaron.

## Verificación

La suite local comprueba altas reales desde formularios, total de 1.25 × 100.50 = 125.625 MXN, fecha y descripción, PDF/foto, descarga con los mismos bytes, recarga y cierre/reapertura de pestaña, ausencia de llamadas privadas, accesibilidad y ancho móvil. También verifica precisión máxima, reintentos sin duplicados, conflictos de contenido y versión, cliente inactivo, fecha imposible y rechazo de archivo incorrecto antes de confirmar su guardado.

Resultados de esta corrección: 4 pruebas locales, 4 pruebas con API real, 20 de vista previa/accesibilidad, 1 de aislamiento del build y 18 unitarias de frontend aprobadas. Backend: 54 aprobadas y 1 omitida por no disponer de PostgreSQL de pruebas en ejecución. Total: 101 aprobadas y 1 omitida. Build TypeScript/Vite, Prettier y Ruff del lanzador aprobados. Se comprobó también el arranque real mediante `main.py` y la exclusión del adaptador local del build de producción.

## Límites y siguiente paso

El almacenamiento pertenece al perfil y origen del navegador. No es un respaldo ni un acceso individual protegido; borrar datos del navegador elimina clientes, pedidos y archivos locales. No hay sincronización automática ni transferencia de estos registros a la nube. Para compartir datos entre equipos, el siguiente paso sigue siendo conectar PostgreSQL y Supabase según `14_activate_private_access.md`, y diseñar una migración explícita. No se desplegó a producción.
