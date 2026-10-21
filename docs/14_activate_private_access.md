# 14 · Activar el acceso privado para probar el guardado

El usuario confirmó que aún no tiene proyecto Supabase. Esta guía prepara el siguiente paso; no se creó una cuenta/proyecto externo ni se configuraron credenciales reales durante esta entrega.

## 1. Crear proyecto de pruebas

Crear un proyecto desde el dashboard de Supabase y obtener su URL y clave **publishable** pública. La [guía oficial de React](https://supabase.com/docs/guides/getting-started/quickstarts/reactjs) muestra dónde crear el proyecto y configurar esos dos valores. La interfaz AgroControl ya está construida: no ejecutar los ejemplos de tablas públicas ni sustituir sus archivos por el ejemplo de la guía.

En esta arquitectura Supabase provee identidad; PostgreSQL del backend guarda clientes, pedidos y metadatos. Los archivos van al disco/volumen privado del backend. No se necesita un bucket público.

## 2. Preparar acceso individual

Desactivar altas públicas en la configuración de Auth y crear/invitar usuarios desde un proceso administrativo de confianza. El formulario AgroControl utiliza correo y contraseña; el usuario invitado debe tener una contraseña establecida. Consultar la [configuración oficial de Auth](https://supabase.com/docs/guides/auth/general-configuration).

Usar claves de firma **ES256 o RS256** y verificar su publicación mediante JWKS. El backend actual rechaza HS256. Referencia: [claves de firma de Supabase](https://supabase.com/docs/guides/auth/signing-keys).

## 3. Configurar archivos locales

En `.env` de la raíz, conservar las variables existentes de base de datos y añadir los valores del proyecto:

```dotenv
AUTH_ISSUER=https://TU-PROYECTO.supabase.co/auth/v1
AUTH_JWKS_URL=https://TU-PROYECTO.supabase.co/auth/v1/.well-known/jwks.json
AUTH_AUDIENCE=authenticated
```

En `frontend/.env`:

```dotenv
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=CLAVE_PUBLICA_DEL_PROYECTO
VITE_ORGANIZATION_ID=UUID_DE_LA_EMPRESA_DE_PRUEBAS
VITE_API_URL=http://localhost:8000/api/v1
VITE_ENABLE_PREVIEW=true
```

No colocar `service_role`, contraseña PostgreSQL o claves secretas en variables `VITE_*`, archivos versionados ni mensajes de chat. No sobrescribir un `.env` ya configurado copiando el ejemplo encima.

## 4. Preparar PostgreSQL y membresía

Arrancar PostgreSQL y aplicar `alembic upgrade head` con los comandos de README. Crear organización y membresía en una conexión administrativa de confianza, usando el UUID real del usuario de Supabase y un UUID nuevo para la empresa. El README incluye la plantilla SQL parametrizada para `psql`.

Dar al primer usuario el rol `administrator`; copiar el UUID de esa organización a `VITE_ORGANIZATION_ID`. El navegador no puede conceder roles: la API comprueba la membresía activa en cada petición.

## 5. Encender y probar

Terminal API desde la raíz:

```powershell
cd D:\agrocontrol
.\.venv\Scripts\python.exe main.py
```

Otra terminal para la interfaz:

```powershell
cd D:\agrocontrol\frontend
npm.cmd run dev
```

Abrir la dirección que indique Vite y entrar por `/login`, con el usuario provisionado. Probar:

1. Crear un cliente desde Clientes.
2. Crear un pedido de Zanahoria y seleccionar ese cliente.
3. Cambiar fecha; capturar `1.25` hectáreas y `100.50` MXN por hectárea. Total exacto: `125.625` MXN.
4. Agregar descripción y adjuntar una foto, PDF o documento sintético.
5. Guardar, consultar detalle y descargar el archivo.
6. Recargar e iniciar sesión otra vez: comprobar que cliente/pedido siguen guardados.

Si hay archivos pendientes, reintentar en el detalle o `/sincronizacion`. Para probarlo con datos reales del negocio primero completar revisión de permisos, antivirus/retención, respaldos y pruebas físicas descritas en el reporte 13.
