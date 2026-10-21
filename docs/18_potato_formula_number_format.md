# 18 · Ajuste de fórmula y comas de miles

**Histórico:** la última corrección distingue CANTIDAD TOTAL de MERMA editable. Estado vigente y migración 0006 en [19](19_editable_shrinkage.md).

Solicitud adicional: PESO TOTAL = PESO − MERMA ADICIONAL − MERMA y separadores de miles en todos los números, incluidos los campos durante captura.

MERMA se calcula automáticamente como suma de cantidades y se muestra junto a CANTIDAD TOTAL. Ejemplo: BRUTO 12,000; TARA 2,000; MERMA ADICIONAL 400; cantidades 100 y 700. PESO 10,000, MERMA 800, PESO TOTAL 8,800 y PESO UNITARIO NETO 11. Con precios 10 y 5: importes 11,000 y 38,500; total **$49,500.00 MXN**. Si ambas mermas exceden el peso, los resultados dependientes muestran Pendiente y se impide guardar. Igualdad permite peso e importe cero.

El JSON compartido actual es `potato-v2`. Python/TypeScript continúan usando aritmética racional exacta y la misma política de cuatro decimales de entrada/ocho de salida; solo cambia la fórmula. El contrato v1 se conserva para reconstruir pedidos históricos de la API.

Migración **0005_potato_formula**: añade versión del cálculo en detalles de papa, etiqueta registros anteriores v1 y usa v2 para nuevos/ediciones. Consultar un pedido anterior conserva sus importes; editar y guardar aplica la regla nueva. La interfaz avisa en pedidos anteriores. El espacio local conserva los registros calculados existentes sin reiniciar su base. Ejecutar `alembic upgrade head` desde backend al usar la API; modo local no requiere migración manual. Downgrade protege pedidos con cálculo nuevo.

`NumberInput` comparte formato por cadenas y posición de cursor: agrupa miles automáticamente al escribir, pegar, borrar y editar. Ejemplo: `1234567.8900` → `1,234,567.8900`. Conserva ceros decimales y el punto final mientras se escribe. Las comas representan miles; se usa punto decimal. Campos de peso, merma adicional, cantidades y precios de ambos productos usan el mismo componente. También se agrupan resultados, listas, tamaños de archivos y comparaciones. Fechas, nombres, códigos y UUID conservan su formato propio.

Los separadores son visuales: RHF, IndexedDB y API reciben las entradas canónicas sin comas. No se transforma dinero a float/Number para dar formato ni se redondean decimales. Al reabrir una edición se reconstruye la presentación agrupada desde el valor guardado.

Archivos principales: `frontend/src/components/NumberInput.tsx`, `frontend/src/lib/number-format.ts`, componentes de ambos productos, `domain.ts`, `potato-domain.ts`, comparaciones/listados; `backend/app/domain/potato-rules.json`, contrato histórico v1, motor Python, modelo/servicio y migración 0005. Vectores de paridad y pruebas de formulario actualizados; pruebas nuevas de cursor/pegado/borrado, precisión, mermas combinadas, conservación histórica y backfill PostgreSQL.

Verificación final: **189 pruebas aprobadas**: 91 backend (incluye PostgreSQL real y backfill/downgrade de migración), 54 Vitest, 12 recorridos locales, 10 contra API real, 20 de navegación/accesibilidad y 2 de build de producción/shell offline. Build TypeScript/Vite, Ruff y Prettier correctos. El PostgreSQL efímero de pruebas se detuvo; la interfaz local del usuario sigue en 127.0.0.1:5174.

Capturas revisadas: [pesaje con fórmula nueva](../.local/potato-v2-weighing.png) y [zanahoria con entradas agrupadas](../.local/formatted-carrot-form.png). Se tomaron con contextos aislados, sin modificar datos del perfil del usuario.

Se mantienen los límites de acceso offline/Supabase/dispositivos físicos del reporte anterior. Sin despliegue de producción.
