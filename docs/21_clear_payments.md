# 21 · Cobros y eliminación de pedidos

Un pedido que tuvo cobros anulados puede eliminarse. El bloqueo ahora considera únicamente abonos vigentes de cobros vigentes; el historial por sí solo no bloquea la eliminación. El ajuste funciona con los registros ya existentes, tanto en el navegador como en la API privada.

## Cómo corregir un cobro

- **Anular cobro:** cancela el registro completo. Todos sus abonos dejan de contar y se elimina su saldo a favor disponible. El registro permanece en **Anulados**, con fecha, importe original y motivo.
- **Quitar abono de estos pedidos:** retira esa asignación a pedidos. El cobro sigue registrado como dinero recibido y el importe queda a favor del cliente para usarlo después.
- **Eliminar pedido:** se permite cuando no queda ningún abono vigente. Si tiene varios cobros, anular uno solo no basta mientras otro siga abonando el pedido.

La confirmación de eliminación muestra el bloqueo y un enlace **Ver cobros asociados** cuando hay abonos vigentes. Ese enlace abre la cuenta del cliente con los cobros filtrados por pedido. Al eliminar un pedido, sus referencias en el historial se muestran como **Pedido eliminado**, sin enlaces a una pantalla inaccesible.

## Interfaz

La sección principal muestra deuda pendiente y saldo a favor por cliente, con accesos a **Ver cuenta** y **Registrar cobro**. La cuenta añade **Registrar anticipo** y permite abonar directamente desde cada pedido.

El formulario comienza con la elección **Abono a pedidos** o **Anticipo / saldo a favor**. El registro habitual usa abonos a pedidos; los borradores anteriores conservan su modalidad original. Los anticipos siguen disponibles sin seleccionar un pedido.

La lista de cobros separa **Vigentes** y **Anulados** y permite filtrar por pedido. Un cobro anulado indica expresamente que no afecta los saldos. Las confirmaciones de anulación y retiro explican si el dinero deja de contar o permanece a favor del cliente.

La cuenta de un cliente dentro de Cobros conserva el indicador de sección **Cobros** y el título de la pestaña correspondiente.

## Integridad y alcance

La API comprueba los abonos vigentes dentro del bloqueo transaccional del pedido. El adaptador local realiza la misma comprobación dentro de la transacción IndexedDB. Se mantiene el control de versión y la autorización de organización/usuario. No se borran físicamente cobros, aplicaciones ni asignaciones, y un historial existente sigue protegiendo las referencias originales del pedido.

El estado `order_deleted` de cada asignación se deriva del pedido; no requiere migrar tablas ni modificar capturas anteriores. La anulación de un cobro distribuido entre varios pedidos sigue retirando todos sus abonos de forma atómica.

Las pruebas cubren anular y eliminar, retirar abono y conservar anticipo, múltiples cobros donde solo uno se anula, conservación de historial y referencias eliminadas, con recorridos móviles/escritorio y validación de accesibilidad.

Verificación: 132 casos de backend contando PostgreSQL, 79 de Vitest, 22 recorridos locales y 18 contra la API privada. Compilación TypeScript/Vite, Ruff y Prettier correctos. Revisión visual de cuenta, detalle y formulario en tamaños móvil/escritorio, usando contextos aislados y datos sintéticos.
