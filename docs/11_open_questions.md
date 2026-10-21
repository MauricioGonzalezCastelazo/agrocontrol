# 11 · Preguntas abiertas

Confirmado: zanahoria por hectárea; MXN; papa con cuatro clasificaciones, fecha, cliente, pesaje, descripción y archivos; edición y eliminación de clientes/pedidos.

## Confirmaciones comerciales de papa

1. ¿Se confirma **peso neto de clasificación × precio unitario** para su importe? Regla provisional según último documento; explicación anterior decía peso unitario × precio.
2. **Última corrección del usuario:** PESO TOTAL = PESO − MERMA ADICIONAL − CANTIDAD TOTAL. MERMA se llena con la suma, pero puede editarse y conservarse manual; no participa en esa fórmula. CANTIDAD TOTAL sigue automática como suma y denominador del promedio.
3. ¿Cuál es la unidad habitual de BRUTO/TARA y precio por peso? No se asume kg ni se convierten unidades; todos los pesos deben usar la misma unidad.
4. ¿Redondear dinero a centavos en notas? Actualmente ocho decimales, HALF_UP solo en salidas de papa. Confirmar cuatro decimales de entrada, máximos y precio cero.

## Acceso y operación

5. Crear/configurar Supabase de pruebas, empresa y membresías. Usuario confirmó que aún no tiene proyecto; integración externa real pendiente. No enviar secretos por chat.
6. Confirmar administradores gestionan clientes/pedidos de empresa y operadores sus pedidos; definir quién resuelve conflictos comerciales.
7. ¿Requiere autorización offline tras cerrar app? Actualmente solo sesión verificada hasta exp del token, sin plazo extra ni login en frío offline.
8. ¿Se comparten teléfonos? Definir recuperación/exportación de borradores antes de pérdida, cambio o borrado de navegador. Migración del espacio local a nube pendiente.
9. Definir retención, respaldo de BD/disco, antivirus/HEIC, alojamiento y restauración. Sin purga/restauración desde interfaz.
10. ¿Folio comercial o varias empresas en piloto? Definir catálogo offline y retención antes de ampliar sincronización.

Se registran como supuestos/ampliaciones; no impiden implementar y probar el flujo solicitado localmente.
