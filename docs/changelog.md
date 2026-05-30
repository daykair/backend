# Registro de Cambios (Changelog) - Backend

## Último Commit
**Mensaje:** `feat: Refactorización de permisos granulares, auth por cookies y migración relacional de órdenes`

### Cambios Principales:
- **Flujo de Autenticación Personalizado:** Implementación de nuevos controladores y rutas para gestionar la autenticación y los tokens de refresco de forma avanzada (`api/auth`, `api/refresh-token`).
- **Middleware `cookie-to-bearer`:** Se agregó un middleware específico que intercepta peticiones entrantes, extrae el token JWT de las cookies y lo inyecta como `Authorization: Bearer`, facilitando la transición a auth basada en cookies sin romper los esquemas de Strapi.
- **API de Roles (admin-role):** Nuevos endpoints (`api/admin-role`) para exponer y administrar la configuración de los roles de los usuarios desde el panel frontend.
- **Refactorización de Órdenes:**
  - El esquema de `order` (`schema.json`) fue actualizado para reflejar su nueva naturaleza relacional.
  - La lógica de negocio compleja fue extraída de los *lifecycles* y movida a un servicio centralizado (`api/order/services/order.ts`) haciendo el código más mantenible.
  - Se introdujeron esquemas para ítems de orden (`order-item`) y pagos (`payment`).
- **Políticas de Acceso:** Ajustes en políticas como `is-admin.ts` para alinearse con los nuevos permisos.

## Cambios en Proceso (No confirmados)
- No hay cambios en progreso registrados en el backend. El estado del repositorio se encuentra limpio y alineado con la última versión de la rama.
