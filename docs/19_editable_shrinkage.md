# 19 · MERMA automática editable

PESO TOTAL = PESO − MERMA ADICIONAL − CANTIDAD TOTAL. La suma de las clasificaciones permanece automática y sirve también como denominador del peso unitario. MERMA es un campo independiente: toma esa suma hasta que se edita, permite borrarse sin reponer inmediatamente el número y conserva lo escrito aunque cambien las cantidades. Usar cantidad total restablece el modo automático.

Ejemplo: peso 10,000, merma adicional 400, cantidad total 800 → peso total 8,800. MERMA inicia en 800; escribir 50, 0 o 1,234.50 no altera ese peso ni el total monetario. Se conserva el precio por peso y toda la precisión/formato anterior.

MERMA manual debe ser no negativa, con hasta cuatro decimales y máximo 9999999999.9999. Si se borra temporalmente puede escribirse otro valor; para guardar debe completarse o volver a automático. No se impone que MERMA manual más merma adicional estén dentro del peso: esa validación utiliza CANTIDAD TOTAL.

Persistencia: `shrinkage_override` null/omitido significa automático; cadena decimal, incluido cero, significa manual. La API responde también `shrinkage` efectivo. La migración **0006_editable_shrinkage** agrega columna NUMERIC(14,4) nullable y check no negativo; no reescribe importes ni duplica la suma en base de datos. Su downgrade rechaza perder valores manuales. Aplicar `alembic upgrade head` desde backend al usar API. El modo local conserva IndexedDB sin reiniciarla y no requiere comando manual.

La fórmula v2 ya utilizaba CANTIDAD TOTAL, por lo que no cambia su versión ni sus importes. Histórico v1 sigue su contrato anterior. La presentación y mensajes ahora distinguen ambos campos. El nuevo null se excluye de huellas idempotentes para conservar reintentos de cuerpos anteriores. Edición, outbox, reanudación offline y comparación de conflictos incluyen el valor manual.

Archivos principales: `PotatoFields.tsx`, `potato-domain.ts`, `OrderPages.tsx`, `ConflictResolution.tsx`; motor Python, esquemas, modelo, operaciones y migración 0006. Pruebas nuevas de automático/manual/cero, edición/persistencia, mermas inválidas, huellas históricas y protección de downgrade PostgreSQL; recorridos móviles/escritorio incluyen borrar, cambiar cantidades, restablecer automático y recuperar borradores offline.

La carga inicial de edición espera su primera consulta actualizada antes de fijar la captura; evita congelar nombres, versiones o MERMA anteriores presentes en caché. No se refresca la captura por reconexión mientras se edita: el servidor continúa comprobando expected_version al guardar.

Validación: **205 pruebas aprobadas** (101 backend con PostgreSQL, 60 unitarias frontend, 12 recorridos locales, 10 contra API real, 20 de navegación/accesibilidad y 2 de producción/shell). TypeScript/Vite, Ruff y Prettier correctos. Se volvieron a comprobar edición/eliminación y papa local tras corregir la carga de la versión inicial. PostgreSQL efímero detenido; la interfaz del usuario continúa en 127.0.0.1:5174.

[Captura revisada de MERMA manual y PESO TOTAL independiente](../.local/editable-shrinkage.png), tomada con contexto de navegador aislado. Sin despliegue ni cambios en los datos del perfil real del usuario.
