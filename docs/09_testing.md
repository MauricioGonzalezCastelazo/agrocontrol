# 09 · Estrategia y evidencia de pruebas

La evidencia vigente está en [19_editable_shrinkage.md](19_editable_shrinkage.md); reportes 12–18 conservan entregas anteriores. Un contrato diseñado o una prueba omitida no equivale a funcionalidad validada.

## Primera etapa

- Backend: liveness/readiness, endpoint de sesión, falta de credenciales, JWT inválido/expirado/emisor o audiencia incorrectos, algoritmos no permitidos, organización ajena, miembro inactivo y límites de administrador. Los tokens de pruebas se firman con claves efímeras generadas en el proceso; no son credenciales reales.
- Esquema: migración explícita, generación SQL PostgreSQL, upgrade/downgrade y comparación con modelos. Las pruebas unitarias usan SQLite solo donde no se depende de semántica PostgreSQL. Integración PostgreSQL separada, habilitada con `TEST_DATABASE_URL`, sobre base de pruebas dedicada y vacía.
- Web: TypeScript y build; pruebas de guardas y formularios; recorridos Playwright de login, rutas, selección de producto, navegación móvil y ausencia de desbordamiento horizontal. Axe automatiza parte de la accesibilidad, no toda.
- Infraestructura: `docker compose --env-file .env.example config --quiet`. El arranque y migración real de Compose requieren motor Docker activo.

## Comandos

```powershell
cd backend
..\.venv\Scripts\python -m pytest -q
..\.venv\Scripts\python -m ruff check .
..\.venv\Scripts\python -m ruff format --check .
..\.venv\Scripts\alembic upgrade head --sql
cd ../frontend
npm ci
npm run test
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:production
npm run test:online
npm run test:local
npm run format:check
```

Integración PostgreSQL: configurar `TEST_DATABASE_URL` para una base **dedicada vacía** con nombre terminado en `_test`. La suite crea y elimina el esquema de esa base con Alembic; nunca apuntarla a datos comerciales. CI prepara una base efímera y ejecuta estas pruebas.

## Segunda etapa, cobertura actual

Cálculo exacto (incluido máximo de precisión), límites/formatos, campos desconocidos, fecha editable, transacción y auditoría, cliente inactivo, búsqueda/filtros, autorización horizontal y conflictos de versión. Pruebas de adjuntos: hash/tamaño, subida fallida/reintento, descarga binaria privada y estado pendiente si falta un archivo. `test:online` recorre clientes/pedidos contra la API en una base temporal con proveedor de identidad aislado, sin sustituir las operaciones de negocio; verifica recarga/reautenticación con blobs persistidos y respuesta de creación perdida sin duplicados. Supabase externo, revisión comercial y dispositivos físicos siguen pendientes.

## Papa y offline, cobertura añadida

MERMA editable: automático/manual/cero, validación independiente de PESO TOTAL, persistencia/edición y regreso a automático. Pruebas de huellas anteriores, migración 0006 y downgrade protegido con valores manuales. Navegador: borrar sin reponer el automático, cambiar cantidades sin sobrescribir lo capturado, restablecer, reabrir, recuperar borrador offline y conservar MERMA al resolver conflicto. La edición espera una consulta actualizada antes de fijar su versión inicial.

Ajuste posterior: descuento de MERMA y MERMA ADICIONAL, rechazo de suma mayor al peso e igualdad con peso cero; contratos históricos y migración 0005 con backfill v1/edición v2. Formato numérico por cadenas, precisión grande, ceros decimales y cursor; Playwright escribe carácter por carácter, pega cantidades agrupadas, borra junto a comas, inserta en medio y guarda/reabre valores canónicos en ambos productos y tamaños de pantalla.

Vectores compartidos Python/TypeScript con cuatro clasificaciones, solo una, decimales, razón periódica, máximos y merma igual al peso; invariantes de suma, tolerancia de peso y ausencia de redondeo intermedio. Cantidades cero, precio faltante, negativos, pesos inválidos y resultados pendientes. Recalcular al modificar cantidad/precio/bruto/tara/merma. API crea, edita idempotente, detecta versión obsoleta y cambia de producto.

PostgreSQL real: cuatro migraciones, comparación de metadata, persistencia exacta de máximos de ambos productos y guardia de downgrade ante pedidos de papa. Navegador escritorio/Pixel 7: papa con múltiples documentos, rechazo de ejecutable, retiro/reemplazo de adjuntos, edición, recarga, accesibilidad/anchura y guardado local offline. API real: borrador offline editable, sincronización al volver red, conflicto provocado por otra versión y resolución explícita. Caché privada requiere permiso verificado vigente; pruebas de vencimiento exacto, bloqueo al salir y claves por empresa/usuario/rol. Producción: shell offline y rutas privadas bloqueadas sin sesión.

## Cobertura aún pendiente

Concurrencia entre pestañas, cuotas/desalojo de almacenamiento, revocación externa durante desconexión, cambio de cuenta con solicitudes en vuelo y actualización SW/Dexie con outbox ocupada. La idempotencia ante respuesta perdida y archivos pendientes conserva los recorridos de zanahoria existentes. Falta integración Supabase real y dispositivos físicos.

## Pruebas manuales obligatorias antes de piloto

- iPhone físico/Safari instalado a inicio y Android físico: instalación, cámara/HEIC, teclado decimal, safe areas, reapertura sin red y persistencia real.
- Lector de pantalla y teclado: formularios, cambios de ruta, estados asíncronos y avisos.
- Proyecto Supabase de prueba: acceso provisionado, renovación, revocación, logout y caída JWKS.
- Revisión de negocio de unidad de precio, moneda, redondeo y permisos entre operadores.

## Verificación de remisiones y cobros

`tests/test_payments.py` verifica unicidad, históricos, importes, anticipo, reparto, anulaciones, permisos y protección de pedidos. La prueba PostgreSQL de migraciones verifica también recepciones concurrentes e idempotencia sobre una base vacía dedicada. Vitest cubre decimales y validación. Playwright prueba cuentas/cobros en local y API, accesibilidad, modo local sin red y respuesta perdida. [Entrega de cobros](20_remissions_payments.md).
