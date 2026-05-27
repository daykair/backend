# Documentación del backend (Strapi)

Resumen breve
- **Stack**: Strapi (versión definida en `backend/package.json`), Node.js 18+.
- **Propósito**: API y administración para la tienda (productos, pedidos, inventario, compras, finanzas).

Quickstart (desde la raíz del proyecto)
```bash
cd backend
# con pnpm (recomendado, existe pnpm-lock.yaml)
pnpm install
pnpm run develop

# o con npm
npm install
npm run develop
```

Notas de ejecución
- El frontend administrativo de `admin` usa la variable `PUBLIC_STRAPI_URL` y el helper `fetchAPI` que pone el prefijo `/api` en todas las llamadas. Por tanto, las rutas definidas en `src/api/**/routes` se exponen bajo `/api{ruta}`.

Archivos importantes
- Configuración del servidor: [backend/config/server.ts](backend/config/server.ts#L1-L20)
- Middlewares globales: [backend/config/middlewares.ts](backend/config/middlewares.ts#L1-L200)
- Configuración del API (limites, paginado): [backend/config/api.ts](backend/config/api.ts#L1-L50)
- Variables de entorno ejemplo: [backend/.env.example](backend/.env.example#L1-L20)
- Script de bootstrap / migraciones: [backend/src/index.ts](backend/src/index.ts#L1-L200)
- Políticas globales: [backend/src/policies/is-admin.ts](backend/src/policies/is-admin.ts#L1-L200)
- APIs (content-types, controladores, servicios): carpeta [backend/src/api](backend/src/api)

Contenido de esta carpeta de docs
- `endpoints.md` — listado de endpoints (rutas personalizadas y convención CRUD de Strapi).
- `models.md` — resumen de los content-types y atributos principales.
- `middlewares_and_policies.md` — descripción de middlewares y políticas (próximo).
- `config.md` — variables de entorno y configuración (próximo).

Limitaciones y recomendaciones
- Esta documentación se generó analizando el código estático del repositorio. No ejecuté el servidor; si hay rutas registradas dinámicamente por plugins o runtime, podrían no aparecer aquí.
- ¿Quieres que genere una especificación OpenAPI/Swagger automática basada en estas rutas? Puedo intentarlo, pero la exactitud dependerá de que todas las rutas y payloads estén declarados estáticamente.

Siguiente paso: `endpoints.md` con listado completo de rutas y `models.md` con esquemas de los content-types.