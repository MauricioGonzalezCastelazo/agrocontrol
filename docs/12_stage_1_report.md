# 12 · Entrega de primera etapa

Fecha: 20 de octubre de 2026. Alcance: documentación, arquitectura, infraestructura y base visual. La base está implementada y verificada con las salvedades indicadas abajo. **El MVP operativo, el CRUD comercial y el funcionamiento offline todavía no están terminados.** No se desplegó a producción.

## 1. Archivos creados o modificados

| Ruta | Entrega |
|---|---|
| `main.py` | Reemplaza el saludo inicial por un lanzador local de Uvicorn |
| `README.md`, `.env.example`, `.gitignore`, `.editorconfig` | Instalación, configuración, exclusión de secretos y convenciones |
| `compose.yaml` | PostgreSQL 17, migración previa, API y frontend compilado, puertos en localhost |
| `.github/workflows/ci.yml` | Verificaciones web y backend con PostgreSQL efímero; preparado, aún no ejecutado en GitHub |
| `backend/pyproject.toml`, `requirements.lock`, `Dockerfile`, `.dockerignore` | Dependencias y contenedor de API |
| `backend/app/core/` | Configuración por entorno |
| `backend/app/auth/` | Contrato de identidad y validación asimétrica Supabase/JWKS |
| `backend/app/api/` | Sesión, health checks y dependencias de autorización |
| `backend/app/persistence/` | Sesiones SQLAlchemy y modelos de organización, membresía, cliente, pedido, detalle y auditoría |
| `backend/migrations/`, `alembic.ini` | Revisión explícita `0001_initial`, upgrade y downgrade |
| `backend/tests/` | Seguridad de JWT, sesión, organización, restricciones y migración PostgreSQL |
| `frontend/package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts` | Dependencias, TypeScript estricto y build |
| `frontend/Dockerfile`, `nginx.conf`, `.dockerignore`, `.env.example` | Build y servidor SPA local |
| `frontend/src/app/`, `src/main.tsx` | Rutas, layout responsive, guardas, carga diferida y recuperación de errores |
| `frontend/src/components/`, `src/styles.css` | Componentes y tokens del design system |
| `frontend/src/features/` | Bases visuales de auth, inicio, clientes, pedidos, sincronización y configuración |
| `frontend/src/lib/` | Configuración pública y llamada autorizada de sesión |
| `frontend/src/test/`, `e2e/`, `production-e2e/`, configuraciones Playwright | Pruebas de interfaz, accesibilidad, móvil y build compilado |
| `frontend/public/` | Marca SVG y licencias de fuentes servidas localmente |
| `docs/01_*.md` a `docs/11_*.md` | Todos los documentos iniciales solicitados |
| Este documento | Decisiones, evidencia, límites y próximo incremento |

Se prepararon `.env` y `frontend/.env` locales excluidos de Git, con contraseña de desarrollo generada y sin credenciales Supabase reales. `.venv`, dependencias, builds, capturas y reportes temporales están excluidos del repositorio. No se crearon commits ni se publicó código remoto.

## 2. Decisiones técnicas

- Monolito modular FastAPI + SQLAlchemy + PostgreSQL, API `/api/v1` y frontend React/TypeScript/Vite/Tailwind.
- Identidad intercambiable; Supabase inicial con firma RS256/ES256. Permisos derivados de membresía activa en base, no de datos proporcionados por navegador.
- UUID, organización, versión y timestamps desde el esquema inicial; referencias compuestas para cliente/pedido/responsable. Decimales exactos en campos numéricos, detalle de producto separado del total.
- Registro de componentes por producto; papa visible y bloqueada. No inventar sus campos ni fijar unidad de precio o moneda.
- Vista previa exclusivamente de desarrollo; sin usuario ficticio, sin datos operativos y sin bypass de API. Sesión y caché en memoria, hasta revisar política offline.
- Fuentes locales, carga por pantalla, navegación inferior móvil, foco accesible, estados vacíos y contraste verificado automáticamente.

## 3. Funcionalidades implementadas

Base visual navegable para login, inicio, clientes, nuevo/editar cliente, pedidos, nuevo pedido, detalle, sincronización, configuración y destino desconocido. Formulario de producto con selector zanahoria/papa; papa presenta su preparación y no acepta guardado. Búsquedas y formularios comerciales señalan explícitamente que aún están inactivos.

API ejecutable con liveness, readiness del esquema y consulta privada de sesión. Migración inicial con restricciones de organización y de producto. Los clientes, pedidos y auditoría tienen esquema preparado, sin endpoints de escritura de negocio todavía.

Documentación del protocolo de sincronización, idempotencia, conflictos, fotos privadas, autorización offline y preservación de pendientes. Estas capacidades están diseñadas, no implementadas en etapa 1.

## 4. Pruebas ejecutadas y resultados

| Verificación | Resultado final |
|---|---|
| Backend `pytest -q` con PostgreSQL real | **25 aprobadas**, sin omitidas ni advertencias |
| JWT | Firma válida; rechazo de firma ajena, HS256, emisor/audiencia incorrectos, vencimiento, iat futuro, sub inválido y exp ausente |
| Autorización | Requiere identidad; organización ajena/inactiva denegada; rol de navegador no concede acceso administrador |
| Migración PostgreSQL | SQL generado, upgrade, comparación de modelos, restricciones entre organizaciones y papa, downgrade y limpieza |
| Frontend Vitest | **4 aprobadas**: guarda privada, preview sin datos, papa bloqueada y sincronización explícitamente pendiente |
| Playwright | **18 aprobadas** entre escritorio y móvil Chromium: navegación, rutas, formularios bloqueados, ausencia de desbordamiento y Axe WCAG A/AA en seis pantallas |
| Build compilado | **1 aprobada**: rutas privadas redirigen al login y la vista previa no se habilita |
| TypeScript / Vite | Build correcto, carga dividida en chunks; sin advertencia final de tamaño |
| Ruff y formato Python | Correctos, incluidos `main.py`, backend y migraciones |
| Prettier | Todos los archivos comprobados cumplen formato |
| Compose | Configuración válida tanto con `.env.example` como con configuración local |
| Inspección visual adicional | Inicio, login y pedido revisados; inicio y formularios sin desbordamiento a 320, 375, 390 y 768 px; foco de ruta sin desplazamiento involuntario |
| Exclusiones Git | `.env`, `frontend/.env`, secretos temporales, `.venv`, dependencias y build correctamente ignorados |

Entorno: Windows, Python 3.14.7, Node 24.21.0. PostgreSQL **17.11** en contenedor temporal independiente, usando la imagen ya disponible `pgvector/pgvector:pg17`; no se instaló ni utilizó la extensión vector. Se creó una base vacía exclusiva `agrocontrol_test`. Las pruebas no accedieron a información de otras aplicaciones.

Durante la revisión se corrigieron una incompatibilidad de dependencias, separación de suites unitarias/E2E, carga asíncrona en pruebas, contraste y desplazamiento de foco. Los resultados de la tabla corresponden a las ejecuciones finales posteriores a esas correcciones.

## 5. Riesgos y validaciones pendientes

- **Compose completo pendiente:** se inició Docker Desktop y se intentó `docker compose up --build -d`, pero la descarga de la imagen PostgreSQL avanzó demasiado lentamente. Se detuvo esa descarga. No se declara validado el build/arranque de todos los contenedores; sí la configuración Compose, el build web y las migraciones contra PostgreSQL real por separado.
- Supabase real pendiente: hacen falta proyecto de pruebas, claves públicas, firma asimétrica, usuarios invitados y membresías. La validación criptográfica y la autorización están probadas localmente; no se ha completado un login contra un proveedor externo.
- iPhone/Safari y Android físicos, cámara y persistencia offline: pendientes. Emulación Chromium no sustituye esas pruebas.
- CRUD, cálculos comerciales, auditoría transaccional, fotografías y sincronización deben implementarse y probarse en sus etapas. No hay Service Worker registrado ni datos privados guardados en Dexie.
- La política offline propuesta de 24 horas todavía necesita aprobación empresarial. La unidad de precio, moneda y matriz de permisos no se convierten en supuestos ocultos.

## 6. Preguntas de negocio sin resolver

Prioritarias: unidad comercial del precio de zanahoria; moneda, escala y redondeo; precio cero y límites; permisos de edición y visibilidad entre operadores; tratamiento de clientes inactivos/correcciones; reglas de papa. Antes de offline: plazo autorizado, dispositivos compartidos, recuperación, formatos y retención de fotos. Lista completa en [11_open_questions.md](11_open_questions.md).

## 7. Próximo incremento sugerido

Etapa 2: confirmar reglas numéricas y permisos, conectar clientes y zanahoria mediante servicios transaccionales, validaciones cliente/servidor, cálculo exacto, consultas y pruebas PostgreSQL. Mantener papa bloqueada. Completar el smoke test de Compose con conectividad suficiente y el login de un proyecto Supabase de pruebas antes del piloto.

No se inició indiscriminadamente la segunda ni la tercera etapa.
