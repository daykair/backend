# Endpoints del backend

Prefijo base: `/api` (el helper `fetchAPI` del panel administrativo concatena `STRAPI_URL + /api + path`).

## Rutas personalizadas (definidas en `src/api/**/routes/*.ts`)

### Autenticación y Sesiones
- **POST** `/auth/local-cookie`: Inicia sesión, valida credenciales y setea `strapi_jwt` y `refresh_token` como cookies HttpOnly.
- **POST** `/auth/refresh`: Valida el `refresh_token` actual, lo rota por uno nuevo y emite un nuevo `strapi_jwt`.
- **POST** `/auth/logout`: Revoca el `refresh_token` actual y limpia las cookies.
- **GET** `/sessions`: Lista todas las sesiones activas (refresh tokens) del usuario actual (con IP y User-Agent).
- **POST** `/sessions/:id/revoke`: Permite al usuario revocar una sesión específica (o cualquiera si es admin).

### Productos (admin)
- **GET** `/products-admin` — `api::product.product.findAdmin` (Puebla inventario y variantes. Policy: `global::is-admin`).
- **GET** `/products-admin/:id` — `api::product.product.findOneAdmin`
- **POST** `/products-admin/save-full` — `api::product.product.saveFull` (Guarda producto y variantes en una operación transaccional).
- **POST** `/products-admin/validate-stock` — Validación rápida de existencias antes del checkout.

### Pedidos y Proceso de Compra
- **GET** `/orders-admin` — `api::order.order.findAdmin` (Listado con relaciones expandidas: `orderItems`, `payments`, `customer`, etc.).
- **POST** `/orders-admin/process-full` — `api::order.order.processOrderFull` (Procesa el pedido completo, actualiza estados y ajusta inventario en una sola transacción segura).

### Gastos (admin)
- **GET** `/expenses-admin` — `api::expense.expense.findAdmin`
- **POST** `/expenses-admin` — `api::expense.expense.createAdmin`
- **PUT** `/expenses-admin/:id` — `api::expense.expense.updateAdmin`
- **DELETE** `/expenses-admin/:id` — `api::expense.expense.deleteAdmin`

### Órdenes de compra a Proveedores
- **GET** `/purchase-orders-admin` — `api::purchase-order.purchase-order.findAdmin`
- **POST** `/purchase-orders-admin/process-full` — Procesa orden de compra y ajusta el inventario simultáneamente.

### Configuración (Tasa de cambio)
- **POST** `/exchange-rate/sync` — Fuerza la sincronización con el BCV.
- **GET** `/exchange-rates` — Obtiene la tasa de cambio actual.

### Usuarios Administrativos (admin-user)
- **GET** `/admin-users` — Lista de usuarios.
- **POST** `/admin-users` — Crea un usuario administrativo y envía credenciales por correo.
- **PUT** `/admin-users/:id` — Actualiza usuario.
- **DELETE** `/admin-users/:id` — Elimina usuario.

### Roles y Permisos
- **GET** `/admin-roles` — Lista de roles.
- **GET** `/admin-roles/permissions-tree` — Árbol estructurado de permisos disponibles en el sistema.
- **GET** `/admin-roles/:id` — Detalle de rol con sus permisos asociados.
- **POST** `/admin-roles` — Crea un nuevo rol.
- **PUT** `/admin-roles/:id` — Edita permisos y nombre del rol.
- **DELETE** `/admin-roles/:id` — Elimina rol.

## Rutas CRUD Automáticas (Content-types)

Generadas por el `createCoreRouter` de Strapi. La mayoría requieren token de autorización (Authorization Bearer), inyectado internamente por el middleware `cookie-to-bearer` a partir de la cookie HttpOnly.

Ejemplos (reemplazar `{plural}` por el `pluralName`):
- **GET** `/api/{plural}` — Listar (acepta `populate`, `filters`, `sort`, `pagination`).
- **GET** `/api/{plural}/{id}` — Obtener por id.
- **POST** `/api/{plural}` — Crear (payload: `{ "data": { ... } }`).
- **PUT** `/api/{plural}/{id}` — Actualizar.
- **DELETE** `/api/{plural}/{id}` — Eliminar.

**Listado de Plurales Disponibles:**
- `products`, `orders`, `categories`, `colors`
- `warehouses`, `warehouse-stocks`, `inventory-movements`
- `purchase-orders`, `suppliers`, `expenses`, `cash-registers`, `exchange-rates`