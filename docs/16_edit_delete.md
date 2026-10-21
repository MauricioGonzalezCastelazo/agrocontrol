# Edición y eliminación de clientes y pedidos

## Resultado

El directorio de clientes permite editar y eliminar; el detalle de pedidos ofrece edición y eliminación. La edición del pedido carga los valores existentes, permite cambiar cliente, fecha, hectáreas, precio y descripción, recalcula el total MXN y permite agregar o retirar adjuntos. Los archivos solo se retiran al confirmar el guardado. La creación y el responsable originales se conservan.

Toda eliminación utiliza un diálogo con Cancelar como primera opción y mantiene el error visible si falla. Los clientes eliminados salen del directorio y del selector; sus pedidos conservan la relación y el nombre. Los pedidos eliminados desaparecen de listados y bloquean los adjuntos. Se usa eliminación lógica para preservar trazabilidad: no hay purga definitiva ni restauración mediante la interfaz.

## Persistencia, autorización y conflictos

La migración `0003_edit_delete` añade `deleted_at` a clientes, pedidos y adjuntos y `last_update_hash` a pedidos. La API necesita `alembic upgrade head` antes de usar el nuevo código. No se modifica la autenticación. Administradores editan/eliminan clientes; operadores gestionan sus propios pedidos y administradores los de su organización.

PATCH y DELETE usan versiones para rechazar capturas desactualizadas con 409. La actualización de importes, detalles, manifiestos y auditoría es transaccional; una validación fallida revierte todo. El hash de la última edición permite recuperar una respuesta perdida. La confirmación de archivos se serializa con cambios/eliminaciones del pedido para impedir que un archivo retirado vuelva a estar disponible. La elección de otro cliente verifica que siga activo y no eliminado bajo bloqueo de fila; se permite conservar el cliente original de un pedido histórico.

El espacio local usa los mismos contratos con transacciones Dexie. Los nuevos campos de almacenamiento son opcionales: no se borra ni reinicia IndexedDB y se mantienen los registros anteriores. La cola conserva operaciones de creación y edición, mantiene compatibilidad con capturas anteriores y limpia adjuntos retirados o pedidos cuya eliminación confirma el servidor. Una referencia a un cliente eliminado genera conflicto y conserva la captura; no se confunde con la eliminación del pedido.

Si otra pestaña cambió un pedido, se debe volver al detalle, revisar los datos y abrir nuevamente la edición. La interfaz no fusiona cambios ni sobrescribe versiones nuevas de forma automática. La conexión y migración de datos locales a Supabase siguen pendientes.

## Archivos principales

- API: `app/api/business.py`, esquemas y operaciones, modelos y migración 0003; CORS permite DELETE.
- Archivos privados: comprobación de eliminaciones y confirmación serializada con la escritura del pedido.
- Interfaz: `DeleteRecordButton`, directorio de clientes, formulario/detalle de pedidos y ruta `/pedidos/:id/editar`.
- Almacenamiento: adaptador local, errores con estado HTTP y cola con soporte de PATCH e idempotencia.
- Pruebas: `backend/tests/test_edit_delete.py`, migración PostgreSQL y recorrido de edición/eliminación compartido por suites locales y con API.

## Verificación

La suite de backend verifica cálculo exacto, cambio de cliente, preservación de historial, auditoría, límites de rol y organización, conflictos de versión, eliminación idempotente, rechazo de resurrección y reemplazo transaccional de adjuntos. Se comprueban también upgrade, metadatos y downgrade en PostgreSQL dedicado y vacío.

El recorrido de navegador verifica edición, total y adjuntos nuevos, cliente inactivo original, cancelación y confirmación de ambas eliminaciones, accesibilidad del diálogo, historial y ancho móvil. La suite con API interrumpe la respuesta de una edición aceptada y confirma su recuperación sin duplicados.

Resultados: 62 pruebas de backend, incluyendo PostgreSQL; 18 unitarias de frontend; 6 de navegador local; 6 con API real; 20 de vista previa/accesibilidad y 1 de aislamiento de producción. **113 pruebas aprobadas, sin omitidas.** TypeScript/Vite, Ruff y Prettier aprobados. Revisión visual de detalle y confirmación de eliminación en escritorio y móvil emulado. El contenedor PostgreSQL de pruebas se retiró después de verificar la migración.

## Pendientes

No hay purga definitiva, restauración desde interfaz, fusión visual de conflictos ni sincronización automática entre dispositivos. El guardado local sigue ligado al mismo origen y perfil del navegador; no constituye respaldo en la nube. No se desplegó a producción ni se enviaron datos a servicios externos.
