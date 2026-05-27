# Configuración y variables de entorno

## Variables de entorno (archivo ejemplo)
Revisa [backend/.env.example](backend/.env.example#L1-L20). Variables claves:

- `HOST` — host donde corre Strapi (por defecto `0.0.0.0`).
- `PORT` — puerto (por defecto `1337`).
- `APP_KEYS` — lista de claves para firmar sesiones.
- `API_TOKEN_SALT` — salt para tokens de API.
- `ADMIN_JWT_SECRET` — secreto para JWT del panel admin.
- `JWT_SECRET` — secreto JWT para autenticación de usuarios.
- `TRANSFER_TOKEN_SALT` — salt auxiliar (usado internamente).

Ejemplo mínimo de `.env` (no subir a VCS):

```env
HOST=0.0.0.0
PORT=1337
APP_KEYS="cambialas1,cambialas2"
API_TOKEN_SALT=...hidden...
ADMIN_JWT_SECRET=...hidden...
JWT_SECRET=...hidden...
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
- Asegúrate de definir `ADMIN_JWT_SECRET` y `APP_KEYS` en producción.
- Si usas provider S3 revisa la configuración en `config/plugins.ts` (o `backend/config/plugins.ts` si existe).

