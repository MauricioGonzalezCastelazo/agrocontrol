# 03 · Reglas de negocio

Cliente por UUID, nunca por nombre. Cada pedido pertenece a su organización y a un creador autorizado. Fecha editable independiente de creación y modificación. Moneda MXN, confirmada por el usuario.

La remisión es un entero positivo único por empresa y producto entre pedidos vigentes. Un pedido eliminado libera su número, incluso si se eliminó antes del ajuste, y conserva su UUID e historial de cobros. Reutilizar una remisión crea un pedido distinto, sin trasladarle abonos del anterior. La misma remisión puede existir en zanahoria y papa.

## Zanahoria

Total = hectáreas × precio unitario por hectárea. Hectáreas positivas, precio no negativo, cuatro decimales de entrada y ocho en el producto exacto. Se conserva el cálculo y el almacenamiento existente.

## Papa

| Código fijo | Descripción |
|---|---|
| 1RA | Papa bonita |
| 2DA | Papa bien |
| 3RA | Papa regular |
| 4TA | Papa pequeña |

Cada clasificación captura **Cantidad** y **Precio unitario**. No se impone caja o tonelada. Cantidad/precio vacíos en una clasificación sin uso equivalen a cero; cantidad positiva requiere precio explícito. Precio cero permitido por ahora. Se rechazan negativos, exponentes, no finitos y más de cuatro decimales.

```text
PESO = BRUTO − TARA
CANTIDAD TOTAL = suma de cantidades de las cuatro clasificaciones
MERMA por defecto = CANTIDAD TOTAL; puede capturarse otro valor
PESO TOTAL = PESO − MERMA ADICIONAL − CANTIDAD TOTAL
PESO UNITARIO NETO = PESO TOTAL / CANTIDAD TOTAL
Peso neto de clasificación = cantidad de clasificación × PESO UNITARIO NETO
Importe de clasificación = peso neto de clasificación × precio unitario
Total del pedido = suma de importes de las clasificaciones
```

BRUTO > TARA ≥ 0; cantidad total > 0; CANTIDAD TOTAL + MERMA ADICIONAL ≤ PESO. Merma adicional no negativa y vacía equivale a cero. MERMA manual admite cero y valores no negativos con hasta cuatro decimales; no participa en esta restricción ni en los importes. Borrarla permite escribir otro valor sin reponer automáticamente la suma; para guardar debe completarse o volver al modo automático. Falta de datos o dependencia inválida muestra Pendiente; salidas independientes siguen disponibles. No dividir entre cero ni sustituir una división pendiente por cero.

**Última actualización del usuario:** PESO TOTAL descuenta CANTIDAD TOTAL, independientemente de MERMA. MERMA sigue automáticamente la suma hasta editarla; conserva el valor manual ante cambios de cantidades y al reabrir. Usar cantidad total restablece el modo automático. La fórmula `potato-v2` ya utilizaba la suma y conserva sus importes. Pedidos históricos `potato-v1` conservan su cálculo hasta guardar una edición.

**Supuesto comercial pendiente:** el importe usa **peso neto de clasificación × precio**, según el documento final, aunque una explicación previa decía peso unitario × precio. No se fija kg: todos los pesos usan la misma unidad y el precio se interpreta por esa unidad. El código correcto es 4TA; 4RA se interpreta como errata.

## Precisión y autoridad

`backend/app/domain/potato-rules.json` es el contrato común de fórmulas, códigos, escalas y límites. Python lo interpreta con Fraction; TypeScript con fracciones BigInt. Sin redondeos intermedios ni float/Number financiero. La razón exacta alimenta cada clasificación, aunque su salida visible esté redondeada.

Entradas: cuatro decimales; cantidades/pesos hasta 9999999999.9999, precios hasta 99999999999999.9999. Salidas: ocho decimales con HALF_UP. Total monetario = suma de importes de línea redondeados a ocho decimales. La suma de pesos puede diferir del PESO TOTAL hasta 0.00000002 por representación; se prueba esta tolerancia. MXN se presenta con mínimo dos y hasta ocho decimales; redondeo comercial a centavos pendiente.

La API recalcula desde entradas tipadas. Rechaza totales, actor, moneda u organización aportados como autoridad. Total, detalles, cuatro líneas, manifiestos y auditoría se guardan en una transacción. No se persisten copias editables de cada peso derivado. Se conserva la versión del cálculo para reconstruir pedidos históricos coherentes con su total.

Presentación: comas de miles en entradas mientras se escribe y en resultados/listados/detalles; punto decimal. Se conservan punto final y ceros decimales durante captura. Separadores solo visuales: RHF y API guardan cadenas decimales canónicas sin comas; nunca convertir importes a Number para dar formato. No se agrupan fechas, UUID ni nombres/códigos.

## Edición, eliminación y archivos

Editar ambos productos, incluso cambiar producto, conserva UUID, creador y creación. Cambios registran actor/fecha e incrementan versión. expected_version impide sobrescrituras; reintento idéntico no duplica operaciones. Conflicto permite comparar y elegir servidor o captura local sobre una versión revisada explícitamente.

Eliminación lógica con confirmación: clientes retirados salen del selector y conservan pedidos históricos; pedidos eliminados y sus archivos dejan de estar accesibles. Sin purga/restauración en interfaz. Administradores gestionan clientes/pedidos de empresa; operadores crean clientes y gestionan pedidos propios. Nuevos pedidos requieren cliente activo; cliente histórico puede permanecer al editar otros campos.

Adjuntos nuevos: JPG/JPEG, PNG, WEBP, HEIC/HEIF, PDF, XLSX, XLS, DOCX, DOC, TXT, CSV, ODT, ODS; 25 MiB cada uno, 20 archivos y 100 MiB por pedido. No vacíos. Lista explícita en cliente/API; no ejecutables, HTML/SVG, macros ni comprimidos. Binarios privados, tamaño/hash verificados, descarga forzada. Archivos antiguos confirmados conservan descarga. No se declara antivirus ni validación de contenido documental.

## Remisiones y cuentas de clientes

Los pedidos nuevos requieren remisión entera única por producto y empresa. Los cobros reciben dinero por cliente y lo aplican a pedidos específicos, con abonos parciales, anticipos y saldo a favor. El crédito sin aplicar no reduce por sí solo la deuda de pedidos. Las correcciones conservan historial y motivo. Solo los abonos vigentes bloquean la eliminación del pedido; al anularlos o retirarlos todos, se permite eliminarlo. El historial conserva las referencias originales de cliente/producto/remisión. [Reglas y ejemplo](20_remissions_payments.md), [eliminación y cobros](21_clear_payments.md).
