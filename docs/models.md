# Modelos (content-types) — resumen

A continuación se listan los content-types principales y sus atributos más relevantes. Usa estos esquemas para construir payloads y comprender relaciones entre entidades.

---

## Product (`product`) — plural: `products`
- **slug**: `uid`
- **productCode**: `string` (unique)
- **title**: `string`
- **description**: `text`
- **isActive**: `boolean`
- **isFeaturedNew**: `boolean`
- **productImage**: `media[]`
- **colors**: `relation oneToMany` → `api::color.color`
- **categories**: `relation manyToMany` → `api::category.category`
- **price**: `decimal` (required)
- **discount**: `decimal` (default 0)
- **isDiscounted**: `boolean`
- **wholesalePrice**: `decimal` (required)
- **costPrice**: `decimal` (private)
- **hasVariants**: `boolean` (default true)

---

## Category (`category`) — plural: `categories`
- **name**: `string`
- **slug**: `uid`
- **image**: `media`
- **isDiscounted**: `boolean`
- **Discount**: `decimal`
- **products**: `relation manyToMany` → `api::product.product`

---

## Color (`color`) — plural: `colors` (variant de producto)
- **name**: `string`
- **stock**: `integer`
- **product**: `relation manyToOne` → `api::product.product`
- **images**: `media[]`
- **code**: `string` (maxLength 6)
- **isDiscounted**: `boolean`
- **discount**: `decimal`
- **colorImage**: `media`
- **inventory_movements**: `relation oneToMany` → `api::inventory-movement.inventory-movement`
- **warehouse_stocks**: `relation oneToMany` → `api::warehouse-stock.warehouse-stock`

---

## Warehouse (`warehouse`) — plural: `warehouses`
- **name**: `string` (required)
- **code**: `string` (unique, required)
- **address**: `text`
- **isActive**: `boolean` (default true)
- **warehouse_stocks**: `relation oneToMany` → `api::warehouse-stock.warehouse-stock`

---

## Warehouse Stock (`warehouse-stock`) — plural: `warehouse-stocks`
- **stock**: `integer` (default 0)
- **warehouse**: `relation manyToOne` → `api::warehouse.warehouse`
- **color**: `relation manyToOne` → `api::color.color`
- Descripción: stock detallado por variante (color) y por almacén.

---

## Inventory Movement (`inventory-movement`) — plural: `inventory-movements`
- **color**: `relation manyToOne` → `api::color.color`
- **quantity**: `integer`
- **type**: `enumeration` (`IN` | `OUT`)
- **reason**: `string`
- **date**: `datetime` (required)
- **performedBy**: `relation manyToOne` → `plugin::users-permissions.user`
- **exchangeRate**: `decimal`
- **product**: `relation manyToOne` → `api::product.product`
- **items**: `json`
- **order**: `relation oneToOne` → `api::order.order`
- **warehouse**: `relation manyToOne` → `api::warehouse.warehouse`

---

## Order (`order`) — plural: `orders`
- **slug**: `uid`
- **adress** / **city** / **email** / **phone**: datos cliente (varios pueden ser `private`)
- **deliveryMethod**, **method**, **option**, **orderStatus**, **orderType**
- **orderPlaced**: `datetime`
- **orderTotal**: `decimal`
- **amountPaid**: `decimal`
- **performedBy**: `relation manyToOne` → `plugin::users-permissions.user`
- **customer**: `relation manyToOne` → `plugin::users-permissions.user`
- **exchangeRate**, **shippingCost**: `decimal`
- **dispatchWarehouse**: `relation manyToOne` → `api::warehouse.warehouse`
- **orderItems**: `relation oneToMany` → `api::order-item.order-item`
- **payments**: `relation oneToMany` → `api::payment.payment`

---

## Order Item (`order-item`) — plural: `order-items`
- **productName**: `string`
- **colorName**: `string`
- **quantity**: `integer`
- **unitPrice**: `decimal`
- **unitCost**: `decimal`
- **order**: `relation manyToOne` → `api::order.order`
- **product**: `relation manyToOne` → `api::product.product`
- **color**: `relation manyToOne` → `api::color.color`

---

## Payment (`payment`) — plural: `payments`
- **amount**: `decimal`
- **method**: `string`
- **reference**: `string`
- **status**: `string`
- **order**: `relation manyToOne` → `api::order.order`

---

## Expense (`expense`) — plural: `expenses`
- **title**: `string` (required)
- **amount**: `decimal` (required)
- **date**: `date` (required)
- **category**: `string` (required)
- **reference**: `string`
- **performedBy**: `relation manyToOne` → `plugin::users-permissions.user`
- **exchangeRate**: `decimal`

---

## Purchase Order (`purchase-order`) — plural: `purchase-orders`
- **supplier**: `relation manyToOne` → `api::supplier.supplier`
- **status**: `enumeration` (`pending` | `received` | `cancelled`)
- **paymentStatus**: `enumeration` (`pending` | `partial` | `paid`)
- **amountPaid**, **totalCost**: `decimal`
- **date**, **expectedArrivalDate**: `datetime` / `date`
- **reference**: `string`
- **items**: `json` (estructura interna con líneas de compra)
- **payments**: `json`

---

## Cash Register (`cash-register`) — plural: `cash-registers`
- **date**: `date` (required)
- **totalIncome**, **totalExpenses**, **expectedBalance**, **actualBalance**, **difference**: `decimal`
- **notes**: `text`

---

## Supplier (`supplier`) — plural: `suppliers`
- **companyName**: `string` (required)
- **contactName**, **email**, **phone**, **address**, **notes**
- **purchase_orders**: `relation oneToMany` → `api::purchase-order.purchase-order`

---

## Exchange Rate (`exchange-rate`) — singleType: `exchange-rates`
- **rate**: `decimal` (required)
- **rateDate**: `string`
- **source**: `string`

---

Referencia: los archivos `schema.json` están en `backend/src/api/<resource>/content-types/<resource>/schema.json`.

Si quieres, puedo generar un archivo por content-type con el JSON completo (o convertirlos a tablas más legibles para documentación técnica).