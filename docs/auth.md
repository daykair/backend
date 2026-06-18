# Autenticación y autorización

## Login y JWT (Cookies HttpOnly)

El proyecto usa un flujo de autenticación personalizado con cookies HttpOnly en lugar del login estándar de Strapi.

### Endpoint de login
- **POST `/api/auth/local-cookie`** (controlador custom en `api/auth/controllers/auth.ts`).
  - Payload: `{ "identifier": "email|username", "password": "..." }`.
  - Respuesta: `{ user }` (sin password). **No devuelve JWT en el body**.
  - Setea dos cookies HttpOnly en el response via `Set-Cookie`:
    - `strapi_jwt`: Access token JWT de corta duración (15 minutos).
    - `refresh_token`: Token opaco aleatorio (30 días).
  - Ambas cookies con flags: `HttpOnly`, `Secure` (en prod), `SameSite=Strict`, `Path=/`.

### Refresh de tokens
- **POST `/api/auth/refresh`** (sin autenticación requerida).
  - Lee el `refresh_token` de las cookies.
  - Verifica el hash contra la tabla `refresh-token` en la DB.
  - Si es válido: emite nuevo access JWT + nuevo refresh token (**rotación**), revoca el anterior.
  - Si el token ya fue revocado: **detecta reutilización** (posible robo) → revoca TODOS los tokens del usuario.
  - Si está expirado: revoca y retorna 401.

### Logout
- **POST `/api/auth/logout`** (sin autenticación requerida).
  - Revoca el refresh token en la DB.
  - Limpia ambas cookies (`strapi_jwt`, `refresh_token`).

## API Tokens
- Strapi soporta API tokens (para integraciones backend-to-backend). La política `is-admin` permite acceso inmediato si la `strategy` de autenticación es `api-token`. Esto es correcto porque Strapi ya valida los scopes del token (read-only, full-access, custom) en su propia capa de autenticación antes de que la política se ejecute.

## Middleware `cookie-to-bearer`
- Archivo: `backend/src/middlewares/cookie-to-bearer.ts`.
- Se ejecuta como **primer middleware** en la cadena.
- Extrae el JWT de la cookie `strapi_jwt` y lo inyecta como `Authorization: Bearer <token>` para que el plugin `users-permissions` funcione transparentemente con cookies HttpOnly.

## Políticas usadas en este proyecto
- `backend/src/policies/is-admin.ts` — verifica JWT o API token, carga `state.user` y usa una **lista negra** de roles prohibidos (`public`, `client`, `cliente`, `customer`, `authenticated`). Los roles personalizados pasan automáticamente.
- `backend/src/api/admin-role/policies/is-admin.ts` — estricta: requiere `role.type === 'admin'`.

## Gestión de sesiones (refresh tokens)
- Content-type `refresh-token` con campos: `tokenHash`, `user`, `expiresAt`, `revoked`, `revokedAt`, `replacedBy`, `ip`, `userAgent`, `deviceName`.
- Endpoints en `api/refresh-token/controllers/refresh-token.ts`:
  - `GET /api/sessions` — lista sesiones activas del usuario autenticado.
  - `DELETE /api/sessions/:id` — revoca una sesión (propia o ajena si es admin).

## Flujo común en el panel admin
1. El frontend hace `POST /api/proxy/auth/local-cookie` (vía proxy Astro para evitar CORS).
2. El backend valida credenciales y setea cookies HttpOnly.
3. Las llamadas posteriores usan `fetchAPI(path)` con `credentials: 'include'` para enviar cookies.
4. El middleware `cookie-to-bearer` convierte la cookie en header `Authorization`.
5. Si el access token expira (401), `fetchAPI` intenta el refresh automáticamente.
6. Rutas administrativas (por ejemplo `/api/products-admin`) exigen la política `is-admin`.

## Recomendaciones de seguridad
- Rotar `APP_KEYS`, `JWT_SECRET`, `ADMIN_JWT_SECRET` en producción.
- Limitar permisos por rol y revisar las acciones habilitadas en `users-permissions`.
- Usar HTTPS y configurar CORS correctamente (revisar `config/middlewares.ts`).
- Limpiar periódicamente los refresh tokens expirados (el servicio `deleteExpired()` está disponible pero no está programado automáticamente).
