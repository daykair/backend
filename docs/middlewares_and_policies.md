# Middlewares y políticas

## Middlewares globales (orden y notas)
Definidos en [backend/config/middlewares.ts](backend/config/middlewares.ts#L1-L56) — orden de carga:

1. **`global::cookie-to-bearer`** — Middleware personalizado (ver sección abajo). Intercepta peticiones y extrae el JWT de la cookie `strapi_jwt` para inyectarlo como `Authorization: Bearer`. Se ejecuta **primero** para que el resto del pipeline de Strapi vea la autenticación correctamente.
2. `strapi::cors` — CORS (con orígenes configurados para admin y front).
3. `strapi::logger` — logging.
4. `strapi::errors` — manejo centralizado de errores.
5. `strapi::security` — encabezados de seguridad y CSP (configurada para permitir recursos en `market-assets.strapi.io` y buckets S3 de Backblaze B2).
6. `strapi::poweredBy` — cabecera personalizada (`Saodi Development`).
7. `strapi::query` — parseo de querystrings.
8. `strapi::body` — parseo de cuerpo de peticiones.
9. `strapi::session` — soporte de sesiones.
10. `strapi::favicon` — favicon.
11. `strapi::public` — servir archivos estáticos.

## Middleware `cookie-to-bearer` (backend/src/middlewares/cookie-to-bearer.ts)

Middleware crítico para el flujo de autenticación por cookies HttpOnly.

**Propósito**: El plugin `users-permissions` de Strapi espera el JWT en el header `Authorization: Bearer <token>`. Como la arquitectura del proyecto usa cookies HttpOnly (seteadas por el controlador de auth), este middleware **extrae el JWT de la cookie y lo inyecta como header** antes de que Strapi procese la autenticación.

**Comportamiento**:
1. Si la petición ya tiene header `Authorization` → no hace nada (pasa al siguiente middleware).
2. Si no hay `Authorization`, intenta obtener el token de `ctx.cookies.get('strapi_jwt')`.
3. Como fallback, parsea manualmente la cabecera `Cookie` con regex por si `ctx.cookies.get` falla.
4. Si encuentra un token, lo inyecta como `ctx.request.header.authorization = 'Bearer <token>'`.

**Posición**: Se ejecuta **primero** en la cadena de middlewares para que toda autenticación posterior (incluyendo policies como `is-admin`) funcione transparentemente.

Archivo: [backend/src/middlewares/cookie-to-bearer.ts](backend/src/middlewares/cookie-to-bearer.ts#L1-L23)

## Política global `is-admin` (backend/src/policies/is-admin.ts)
Comportamiento principal:
- **API Tokens**: Permite acceso inmediato si la petición usa autenticación por *API Token* (`strategy.name === 'api-token'`). Esto es correcto porque Strapi ya valida los scopes del token (read-only, full-access, custom) en su capa de autenticación *antes* de que la política se ejecute. Si la petición llega hasta aquí, el token ya fue autorizado para esa acción específica.
- **JWT (usuarios)**: Si no hay API Token, busca token JWT en `Authorization: Bearer <token>` o en cookie `strapi_jwt` (con fallback de parseo manual).
- Verifica el JWT mediante el servicio `users-permissions` y obtiene `decoded.id`.
- Carga el usuario (`plugin::users-permissions.user`) con su `role`.
- **Lógica de acceso (lista negra)**: en lugar de verificar contra roles permitidos, usa una lista de roles **prohibidos** (`public`, `client`, `cliente`, `customer`, `authenticated`). Cualquier rol que NO esté en esta lista tiene acceso. Esto permite que roles personalizados (ej. "Vendedor", "Cajero") pasen la política automáticamente.
- Si la ruta define `config.roles` explícitamente, se usa esa lista como whitelist en lugar de la lista negra.
- Si el rol del usuario es permitido, guarda `state.user` y permite la petición.
- Si falla verificación o no hay token, responde con `PolicyError`.

Archivo: [backend/src/policies/is-admin.ts](backend/src/policies/is-admin.ts#L1-L80)

## Política `api::admin-role.is-admin` (API `admin-role`)
- Archivo: [backend/src/api/admin-role/policies/is-admin.ts](backend/src/api/admin-role/policies/is-admin.ts#L1-L50)
- Lógica: requiere que `state.user` exista y que su `role.type` sea exactamente `admin`.

## Recomendaciones
- Mantener seguras las variables `JWT_SECRET`, `ADMIN_JWT_SECRET` y `APP_KEYS` en entorno (no en repositorio).
- Revisar y probar las rutas administrativas (`*-admin`) con usuarios de rol `admin` y tokens de API para integraciones automáticas.

