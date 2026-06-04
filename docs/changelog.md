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
- **Políticas de Acceso:** Ajustes en políticas como `is-admin.ts` para alinearse con los nuevos permisos.


## Cambios Recientes
- **API de Roles (admin-role) Extensión**: Se añadieron los endpoints `POST /api/admin-roles` y `DELETE /api/admin-roles/:id` en el controlador para permitir creación y eliminación de roles desde el frontend, incluyendo validaciones críticas de seguridad (protección de roles del sistema y validación de usuarios vinculados).

- **Eliminacion de Esquemas Payment y OrderItem**:
  - Se eliminaron los esquemas `payment` y `order-item` del backend.
  - Se eliminaron los lifecycles asociados a estos esquemas.
  - Se eliminaron las rutas asociadas a estos esquemas.

## Cambios en Proceso (No confirmados)
- **Gestión de Correos y Notificaciones**:
  - Integración del proveedor `@strapi/provider-email-nodemailer` y `nodemailer` para el envío de correos.
  - Envío automático de correo de bienvenida con credenciales al crear nuevos usuarios administradores.
- **Seguridad y Usuarios (Admin)**:
  - Ajustes en las políticas de acceso `global::is-admin` para requerir explícitamente el rol `admin` (`{ roles: ['admin'] }`) en las rutas de `admin-role` y `admin-user`.
  - Validaciones de duplicidad (`$or` query en `updateUser`) para email y username.
  - Listado de usuarios administradores ordenado de forma descendente por fecha de creación y filtrado para excluir a los clientes (`role: { type: { $ne: 'customer' } }`), separando limpiamente el acceso interno de los compradores.