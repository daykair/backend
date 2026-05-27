# Autenticación y autorización

## Login y JWT
- Login estándar: POST `/api/auth/local` (plugin `users-permissions`).
  - Payload: `{ "identifier": "email|username", "password": "..." }`.
  - Respuesta: `{ jwt, user }`.
- Incluir `Authorization: Bearer <jwt>` en peticiones protegidas.

## API Tokens
- Strapi soporta API tokens (para integraciones backend-to-backend). La política `is-admin` permite acceso automático si la `strategy` de autenticación es `api-token`.

## Políticas usadas en este proyecto
- `backend/src/policies/is-admin.ts` — verifica JWT o API token, carga `state.user` y comprueba roles permitidos.
- `backend/src/api/admin-role/policies/is-admin.ts` — estricta: requiere `role.type === 'admin'`.

## Flujo común en el panel admin (ejemplo)
1. El frontend administrativo hace `POST /api/auth/local` y guarda el `jwt` en cookie `strapi_jwt` o en memoria.
2. Las llamadas posteriores usan `fetchAPI(path)` que añade `Authorization` si existe cookie.
3. Rutas administrativas (por ejemplo `/api/products-admin`) suelen exigir la política `is-admin`.

## Recomendaciones de seguridad
- Rotar `APP_KEYS`, `JWT_SECRET`, `ADMIN_JWT_SECRET` en producción.
- Limitar permisos por rol y revisar las acciones que quedan habilitadas por defecto en `users-permissions`.
- Usar HTTPS y configurar CORS correctamente (revisar `config/middlewares.ts`).


