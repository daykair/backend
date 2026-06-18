# Configuración y variables de entorno

## Variables de entorno (archivo ejemplo)
Revisa [backend/.env.example](backend/.env.example#L1-L20). Variables claves:

### Servidor y seguridad
- `HOST` — host donde corre Strapi (por defecto `0.0.0.0`).
- `PORT` — puerto (por defecto `1337`).
- `APP_KEYS` — lista de claves para firmar sesiones (separadas por coma).
- `API_TOKEN_SALT` — salt para tokens de API.
- `ADMIN_JWT_SECRET` — secreto para JWT del panel admin nativo de Strapi.
- `JWT_SECRET` — secreto JWT para autenticación de usuarios (`users-permissions`).
- `TRANSFER_TOKEN_SALT` — salt auxiliar (usado internamente por Strapi).

### Base de datos
Configuradas en [backend/config/database.ts](backend/config/database.ts). Soporta SQLite, PostgreSQL y MySQL.

- `DATABASE_CLIENT` — motor de DB: `sqlite` (default), `postgres`, `mysql`.
- `DATABASE_URL` — URL de conexión completa (solo PostgreSQL, alternativa a host/port/name).
- `DATABASE_HOST` — host de la DB (default: `localhost`).
- `DATABASE_PORT` — puerto de la DB (default: `5432` para postgres, `3306` para mysql).
- `DATABASE_NAME` — nombre de la base de datos (default: `strapi`).
- `DATABASE_USERNAME` — usuario de la DB (default: `strapi`).
- `DATABASE_PASSWORD` — contraseña de la DB (default: `strapi`).
- `DATABASE_SSL` — habilitar SSL (`true`/`false`, default: `false`).
- `DATABASE_SSL_CA` — ruta al certificado CA para SSL.
- `DATABASE_SSL_REJECT_UNAUTHORIZED` — verificar certificado SSL (`true`/`false`).
- `DATABASE_SCHEMA` — schema de PostgreSQL (default: `public`).
- `DATABASE_POOL_MIN` — mínimo de conexiones en el pool (default: `2`).
- `DATABASE_POOL_MAX` — máximo de conexiones en el pool (default: `10`).
- `DATABASE_CONNECTION_TIMEOUT` — timeout de conexión en ms (default: `60000`).
- `DATABASE_FILENAME` — ruta del archivo SQLite (default: `.tmp/data.db`).

### Almacenamiento de archivos (S3 / Backblaze B2)
Configuradas en [backend/config/plugins.ts](backend/config/plugins.ts). Usa el provider `@strapi/provider-upload-aws-s3` con Backblaze B2.

- `B2_KEY_ID` — Access Key ID de Backblaze B2.
- `B2_APP_KEY` — Application Key de Backblaze B2.
- `B2_REGION` — Región del bucket (ej: `us-east-005`).
- `B2_ENDPOINT` — Endpoint S3-compatible (ej: `https://s3.us-east-005.backblazeb2.com`).
- `B2_BUCKET_NAME` — Nombre del bucket para almacenar archivos subidos.

### Email (SMTP / Nodemailer)
Configuradas en [backend/config/plugins.ts](backend/config/plugins.ts). Usa el provider `@strapi/provider-email-nodemailer`.

- `SMTP_HOST` — servidor SMTP (default: `smtp.gmail.com`).
- `SMTP_PORT` — puerto SMTP (default: `465`).
- `SMTP_USERNAME` — usuario/email para autenticación SMTP.
- `SMTP_PASSWORD` — contraseña o app password para SMTP.
- `SMTP_DEFAULT_FROM` — dirección remitente por defecto.
- `SMTP_DEFAULT_REPLY_TO` — dirección de respuesta por defecto.

### Ejemplo mínimo de `.env` (no subir a VCS)

```env
HOST=0.0.0.0
PORT=1337
APP_KEYS="clave1,clave2"
API_TOKEN_SALT=...
ADMIN_JWT_SECRET=...
JWT_SECRET=...
TRANSFER_TOKEN_SALT=...

# Database (PostgreSQL)
DATABASE_CLIENT=postgres
DATABASE_URL=postgres://user:pass@host:5432/dbname
DATABASE_SSL=true
DATABASE_SSL_CA=certs/ca-certificate.crt

# Storage (Backblaze B2)
B2_KEY_ID=...
B2_APP_KEY=...
B2_REGION=us-east-005
B2_ENDPOINT=https://s3.us-east-005.backblazeb2.com
B2_BUCKET_NAME=mi-bucket

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USERNAME=info@midominio.com
SMTP_PASSWORD=mi-app-password
SMTP_DEFAULT_FROM=info@midominio.com
SMTP_DEFAULT_REPLY_TO=soporte@midominio.com
```

## Config de servidor
- Archivo: [backend/config/server.ts](backend/config/server.ts#L1-L20)
  - `host`, `port`, `app.keys` (lee `APP_KEYS` como array).

## Config del API
- Archivo: [backend/config/api.ts](backend/config/api.ts#L1-L40)
  - `rest.defaultLimit` (25), `maxLimit` (100), `withCount: true`.

## Scripts útiles (package.json)
- `pnpm run develop` — iniciar en modo desarrollo (auto-reload).
- `pnpm run start` — iniciar en modo producción.
- `pnpm run build` — construir panel admin.

Archivo: [backend/package.json](backend/package.json#L1-L60)

## Notas de despliegue
- Asegúrate de definir `ADMIN_JWT_SECRET`, `JWT_SECRET` y `APP_KEYS` con valores únicos en producción.
- Configura las variables de Backblaze B2 para el almacenamiento de imágenes.
- Configura las variables SMTP para el envío de correos (bienvenida, recuperación de contraseña).
- Si usas PostgreSQL con SSL, coloca el certificado CA en la carpeta `certs/` y configura `DATABASE_SSL_CA`.
