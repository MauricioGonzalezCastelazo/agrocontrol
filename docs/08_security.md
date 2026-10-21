# 08 · Seguridad

Actualización vigente: zanahoria y papa comparten autorización por organización/membresía. Responsable y modificador provienen de la sesión en backend. Extensiones nuevas limitadas por lista explícita; descarga autenticada forzada como binario (`attachment`, `nosniff`, `no-store`). Nombres independientes de rutas físicas, hash/tamaño verificados. No se ejecutan documentos ni se declara antivirus. Caché offline por usuario/organización/rol, solo durante sesión verificada hasta exp del token. Logout bloquea lectura y conserva pendientes. [Alcance offline](07_offline_sync.md).

## Base implementada

- Identidad mediante Supabase Auth, sin registro público ni contraseñas locales. Frontend recibe solo clave pública/publishable; jamás `service_role`, contraseña de BD o clave de firma.
- Backend verifica firma con JWKS del emisor configurado, lista fija RS256/ES256, issuer, audience, exp, iat y sub UUID. Rechaza HS256 y no confía en la cabecera del JWT para seleccionar URL o algoritmos. HTTPS obligatorio para URLs de identidad.
- JWKS en caché por 5 minutos; la indisponibilidad del proveedor responde 503. No hay fallback para decodificar sin verificar.
- Rol y acceso salen de `memberships`, consultados en cada petición privada. `X-Organization-ID` es selección, nunca prueba de autorización. Una membresía ajena o inactiva produce 403. Registros ajenos a la política del usuario se responden como 404.
- `administrator` y `operator` son roles iniciales. Ambos crean clientes/pedidos y consultan el directorio. Solo administrador edita clientes; operador lee sus propios pedidos y administrador los de la organización. Esta política restrictiva es provisional hasta confirmación empresarial.
- Referencias compuestas de base evitan relaciones comerciales entre organizaciones. Los futuros repositorios deben además filtrar todas las lecturas y escrituras.
- Errores SQL no revelan conexión, consulta, tokens o datos. API no registra cuerpos ni credenciales; logs de acceso Uvicorn desactivados por defecto. Los cambios de clientes, pedidos y adjuntos registran auditoría estructurada transaccional.
- Tokens y permiso verificado solo en memoria; Query Cache se limpia al cerrar sesión. Caché Dexie de registros previamente autorizados, separada por organización/usuario/rol; respuestas que llegan tras cambiar/vencer sesión no se guardan en otra cuenta. No hay fallback ante rechazo HTTP ni lectura de caché sin permiso vigente. Service Worker precachea únicamente shell público. Borradores/blobs conservados por organización/usuario; no se eliminan al salir.
- Puertos Compose limitados a localhost, volúmenes persistentes separados para PostgreSQL y adjuntos privados, API como usuario sin privilegios. Los archivos no están bajo un servidor estático y se descargan únicamente tras autorizar el pedido.

## Matriz mínima provisional

| Capacidad | Administrador | Operador | Estado |
|---|---|---|---|
| Consultar sesión propia | Sí | Sí | Implementado |
| Leer/crear clientes en su organización | Sí | Sí | Implementado |
| Editar clientes | Sí | No | Implementado, política provisional |
| Crear/consultar pedidos propios | Sí | Sí | Implementado |
| Ver pedidos y adjuntos de otro operador de la misma organización | Sí | No | Implementado, política provisional |
| Modificar/eliminar pedidos guardados | Organización | Propios | Implementado con versión y eliminación lógica |
| Administrar membresías | Propuesto | No | Sin endpoints actuales |

## Antes de operación comercial

Configurar Supabase de pruebas, claves de firma asimétricas y registro público desactivado. Provisionar usuarios con administrador del proveedor y membresías por un proceso de confianza. No aceptar roles del cliente, email o `user_metadata`.

Configurar TLS/HTTPS, CSP ajustada a dominios reales de API/Supabase, HSTS en terminación TLS, rate limiting de login/API en gateway, auditoría de acciones privilegiadas, copias de BD y restauración ensayada, usuario DB restringido, gestión/rotación de secretos y análisis de dependencias en cada actualización. Esta configuración local no es un despliegue endurecido de producción.

Definir política de visibilidad entre usuarios antes de exponer pedidos. Revisar amenazas offline (dispositivo compartido/perdido, XSS, reloj manipulado, revocación tardía, eliminación del navegador). No afirmar que IndexedDB cifrado con clave accesible a la misma app proteja contra XSS.

No incluir archivos personales, credenciales ni notas de clientes en logs, reportes de errores o telemetría. Auditoría retendrá solo identificadores, acción, actor y fecha; definir acceso, retención y exportación después.
