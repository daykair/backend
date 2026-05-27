# Middlewares y políticas

## Middlewares globales (orden y notas)
Definidos en `backend/config/middlewares.ts` — orden de carga:

- `strapi::logger` — logging.
- `strapi::errors` — manejo centralizado de errores.
- `strapi::security` — encabezados de seguridad y CSP (configurada para permitir recursos en `market-assets.strapi.io` y algunos buckets S3).
- `strapi::cors` — CORS.
- `strapi::poweredBy` — cabecera personalizada (`Saodi Development`).
- `strapi::query` — parseo de querystrings.
- `strapi::body` — parseo de cuerpo de peticiones.
- `strapi::session` — soporte de sesiones.
- `strapi::favicon` — favicon.
- `strapi::public` — servir archivos estáticos.

Revisa [backend/config/middlewares.ts](backend/config/middlewares.ts#L1-L200) para ver el CSP y fuentes permitidas.

## Política global `is-admin` (backend/src/policies/is-admin.ts)
Comportamiento principal:
- Permite acceso inmediato si la petición usa autenticación por *API Token* (`strategy.name === 'api-token'`).
- Si no hay API Token, busca token JWT en `Authorization: Bearer <token>` o en cookie `strapi_jwt`.
- Verifica el JWT mediante el servicio `users-permissions` y obtiene `decoded.id`.
- Carga el usuario (`plugin::users-permissions.user`) con su `role` y compara contra `config.roles` (si se pasa) o contra `['admin', 'authenticated']` por defecto.
- Si el `user.role.type` coincide con un rol permitido, permite la petición y guarda `state.user`.
- Si falla verificación o no hay token, responde con `unauthorized` o `forbidden`.

Ruta del archivo: [backend/src/policies/is-admin.ts](backend/src/policies/is-admin.ts#L1-L200)

## Política `api::admin-role.is-admin` (API `admin-role`)
- Archivo: [backend/src/api/admin-role/policies/is-admin.ts](backend/src/api/admin-role/policies/is-admin.ts#L1-L50)
- Lógica: requiere que `state.user` exista y que su `role.type` sea exactamente `admin`.

## Recomendaciones
- Mantener seguras las variables `JWT_SECRET`, `ADMIN_JWT_SECRET` y `APP_KEYS` en entorno (no en repositorio).
- Revisar y probar las rutas administrativas (`*-admin`) con usuarios de rol `admin` y tokens de API para integraciones automáticas.

