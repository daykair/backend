# Endpoints del backend

Prefijo base: `/api` (el helper `fetchAPI` del panel administrativo concatena `STRAPI_URL + /api + path`).

Rutas personalizadas (definidas en `src/api/**/routes/*.ts`)

- **Productos (admin)**
  - GET  `/api/products-admin` — `api::product.product.findAdmin` (config: `auth: false`, policy: `global::is-admin`).
  - GET  `/api/products-admin/:id` — `api::product.product.findOneAdmin` (config: `auth: false`, policy: `global::is-admin`).
  - POST `/api/products-admin/save-full` — `api::product.product.saveFull` (guarda producto y variantes en una operación transaccional).

- **Pedidos (admin / proceso)**
  - GET  `/api/orders-admin` — `api::order.order.findAdmin` (listado con `orderItems`, `payments`, `performedBy`, `dispatchWarehouse`, `customer` poblados).
  - POST `/api/orders-admin/process-full` — `api::order.order.processOrderFull` (valida payload y delega a `order` service para procesar pedido y ajustes de stock).

- **Tasa de cambio**
  - POST `/api/exchange-rate/sync` — `api::exchange-rate.exchange-rate.sync` (forzar sincronización BCV).
  - GET  `/api/exchange-rates` — CRUD core (`createCoreRouter`) con `find` expuesto sin autenticación según `routes/exchange-rate.ts`.

- **Gastos (admin)**
  - GET  `/api/expenses-admin` — `api::expense.expense.findAdmin` (policy: `global::is-admin` con rol `admin`).
  - POST `/api/expenses-admin` — `api::expense.expense.createAdmin` (policy: `global::is-admin`).
  - PUT  `/api/expenses-admin/:id` — `api::expense.expense.updateAdmin` (policy: `global::is-admin`).
  - DELETE `/api/expenses-admin/:id` — `api::expense.expense.deleteAdmin` (policy: `global::is-admin`).

- **Órdenes de compra**
  - GET  `/api/purchase-orders-admin` — `api::purchase-order.purchase-order.findAdmin` (lista con `supplier` poblado).
  - POST `/api/purchase-orders-admin/process-full` — `api::purchase-order.purchase-order.processPurchaseOrderFull` (procesa orden de compra y ajustes de inventario dentro de una transacción).

- **Roles administrativos**
  - GET  `/api/admin-roles` — `admin-role.getRoles` (policy: `api::admin-role.is-admin`).
  - GET  `/api/admin-roles/permissions-tree` — `admin-role.getPermissionsTree` (lista acciones/permissions disponibles).
  - GET  `/api/admin-roles/:id` — `admin-role.getRole` (detalle de rol).
  - PUT  `/api/admin-roles/:id` — `admin-role.updateRole` (actualiza nombre/descripcion/permissions).

- **Caja (cash-register)**
  - GET  `/api/cash-registers` — listar cierres.
  - GET  `/api/cash-registers/:id` — detalle.
  - POST `/api/cash-registers` — crear cierre.
  - PUT  `/api/cash-registers/:id` — actualizar.
  - DELETE `/api/cash-registers/:id` — eliminar.
  - Nota: estas rutas están expuestas en el router custom; revisar controles de acceso en la política global o el frontend que llama estos endpoints.

Rutas CRUD automáticas (content-types)

Los content-types definidos con `factories.createCoreRouter(...)` exponen rutas REST convencionales bajo `/api/{plural}`. Ejemplos (reemplazar `{plural}` por el `pluralName` del content-type):

- GET  `/api/{plural}` — listar (acepta `populate`, `filters`, `sort`, `pagination`).
- GET  `/api/{plural}/{id}` — obtener por id.
- POST `/api/{plural}` — crear (payload: `{ "data": { ... } }`).
- PUT  `/api/{plural}/{id}` — actualizar (payload: `{ "data": { ... } }`).
- DELETE `/api/{plural}/{id}` — eliminar.

Content-types principales y su plural (usar para construir las rutas CRUD):
- `product` → `products`
- `order` → `orders`
- `category` → `categories`
- `color` → `colors`
- `warehouse` → `warehouses`
- `warehouse-stock` → `warehouse-stocks`
- `inventory-movement` → `inventory-movements`
- `order-item` → `order-items`
- `purchase-order` → `purchase-orders`
- `payment` → `payments`
- `expense` → `expenses`
- `cash-register` → `cash-registers`
- `supplier` → `suppliers`
- `exchange-rate` → `exchange-rates`

Autenticación y ejemplo de uso

- Login (plugin `users-permissions`):
  - POST `/api/auth/local` con `{ identifier, password }` → respuesta con `{ jwt }`.
  - Incluir header `Authorization: Bearer <jwt>` en peticiones protegidas.

Ejemplo cURL (login + petición protegida):

```bash
# Login
curl -s -X POST "http://localhost:1337/api/auth/local" \
  -H "Content-Type: application/json" \
  -d '{"identifier":"usuario@example.com","password":"tu-pass"}'

# Supongamos que obtuviste el token JWT en $JWT
curl -s -X GET "http://localhost:1337/api/orders-admin" \
  -H "Authorization: Bearer $JWT"
```

Limitaciones
- Las rutas expuestas dependen de las políticas y de la configuración de usuario/plugin. Revisa `backend/src/policies/is-admin.ts` para la lógica de autorización usada en rutas administrativas.
- Para endpoints con payloads complejos (por ejemplo `processOrderFull` o `saveFull`) revisa los controladores y servicios para conocer la estructura exacta del `data` esperado.

Referencias rápidas
- Carpetas: [backend/src/api](backend/src/api)
- Políticas: [backend/src/policies/is-admin.ts](backend/src/policies/is-admin.ts#L1-L200)
- Ejemplo de llamadas desde panel admin: [admin/src/lib/api.ts](admin/src/lib/api.ts#L1-L200)