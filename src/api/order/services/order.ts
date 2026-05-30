import { factories } from '@strapi/strapi';

const ORDER_FIELDS = [
  'slug',
  'adress',
  'city',
  'deliveryMethod',
  'email',
  'method',
  'option',
  'phone',
  'orderStatus',
  'orderPlaced',
  'orderTotal',
  'clientName',
  'paymentReference',
  'orderType',
  'amountPaid',
  'performedBy',
  'customer',
  'exchangeRate',
  'shippingCost',
  'dispatchWarehouse',
];

function normalizeIdentifier(value: any) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'object') {
    if (value.id !== undefined) return value.id;
    if (value.documentId !== undefined) return value.documentId;
    if (value._id !== undefined) return value._id;
  }

  return value;
}

function isNumericIdentifier(value: any) {
  return typeof value === 'number' || (typeof value === 'string' && /^[0-9]+$/.test(value.toString()));
}

function buildWhere(value: any) {
  const normalized = normalizeIdentifier(value);
  if (normalized === null) return {};
  return isNumericIdentifier(normalized)
    ? { id: Number(normalized) }
    : { documentId: String(normalized) };
}

function buildOrFilters(values: any[]) {
  const or: any[] = [];
  for (const raw of values) {
    const normalized = normalizeIdentifier(raw);
    if (normalized === null) continue;
    if (isNumericIdentifier(normalized)) {
      or.push({ id: Number(normalized) });
    } else {
      or.push({ documentId: String(normalized) });
    }
  }

  return or.length > 0 ? { $or: or } : null;
}

function buildOrderPayload(orderData: any, payments: any[]) {
  const payload: any = {};

  for (const field of ORDER_FIELDS) {
    if (orderData[field] !== undefined) {
      if (['customer', 'performedBy', 'dispatchWarehouse'].includes(field)) {
         payload[field] = normalizeIdentifier(orderData[field]);
      } else {
         payload[field] = orderData[field];
      }
    }
  }

  if (payments.length > 0) {
    payload.amountPaid = payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
    if (payments.length > 1) {
      payload.method = 'Múltiple';
    } else if (payments[0]?.method) {
      payload.method = payments[0].method;
    }
  }

  if (!payload.orderPlaced) {
    payload.orderPlaced = new Date().toISOString();
  }

  return payload;
}

function buildOrderMovementItems(items: any[]) {
  return items.map((item) => ({
    colorId: item.color || normalizeIdentifier(item.colorId) || null,
    productId: item.product || normalizeIdentifier(item.productId) || null,
    title: item.productName || item.title || 'Producto',
    colorName: item.colorName || item.selectedColor || 'N/A',
    quantity: Number(item.quantity) || 0,
  }));
}

export default factories.createCoreService('api::order.order', ({ strapi }) => {
  // Tipamos correctamente el query engine de Strapi para evitar problemas de TypeScript
  const dbQuery = (uid: string) => (strapi.db as any).query(uid);

  return {
    async processOrderTransaction(orderData: any) {
      const items = Array.isArray(orderData.items)
        ? orderData.items
        : Array.isArray(orderData.order)
        ? orderData.order
        : Array.isArray(orderData.orderItems)
        ? orderData.orderItems
        : [];
      const payments = Array.isArray(orderData.payments)
        ? orderData.payments
        : Array.isArray(orderData.payment)
        ? orderData.payment
        : [];
      const hasOrderItems = Array.isArray(orderData.items) || Array.isArray(orderData.order) || Array.isArray(orderData.orderItems);
      const hasPayments = Array.isArray(orderData.payments) || Array.isArray(orderData.payment);
      const lookupValue = orderData.id ?? orderData.documentId;

      return await strapi.db.transaction(async (trx) => {
        try {
          const orderPayload = buildOrderPayload(orderData, payments);
          const where = lookupValue ? buildWhere(lookupValue) : null;
          
          const existingOrder = where
            ? await dbQuery('api::order.order').findOne({
                where,
                select: ['id'],
                transacting: trx,
              })
            : null;

          // RESOLVER RELACIONES: db.query requiere IDs internos (numéricos), no documentIds.
          if (orderPayload.dispatchWarehouse && typeof orderPayload.dispatchWarehouse === 'string' && !/^\d+$/.test(orderPayload.dispatchWarehouse)) {
            const dw = await dbQuery('api::warehouse.warehouse').findOne({
              where: { documentId: orderPayload.dispatchWarehouse },
              select: ['id'],
              transacting: trx,
            });
            orderPayload.dispatchWarehouse = dw ? dw.id : null;
          }

          if (orderPayload.customer && typeof orderPayload.customer === 'string' && !/^\d+$/.test(orderPayload.customer)) {
            const cus = await dbQuery('plugin::users-permissions.user').findOne({
              where: { documentId: orderPayload.customer },
              select: ['id'],
              transacting: trx,
            });
            orderPayload.customer = cus ? cus.id : null;
          }

          if (orderPayload.performedBy && typeof orderPayload.performedBy === 'string' && !/^\d+$/.test(orderPayload.performedBy)) {
            const pb = await dbQuery('plugin::users-permissions.user').findOne({
              where: { documentId: orderPayload.performedBy },
              select: ['id'],
              transacting: trx,
            });
            orderPayload.performedBy = pb ? pb.id : null;
          }

          const productIds = items.map((item: any) => normalizeIdentifier(item.productId)).filter(Boolean);
          const colorIds = items.map((item: any) => normalizeIdentifier(item.colorId)).filter(Boolean);

          const [products, colors] = await Promise.all([
            productIds.length > 0
              ? dbQuery('api::product.product').findMany({
                  where: buildOrFilters(productIds) || undefined,
                  select: ['id', 'documentId', 'title', 'costPrice'],
                  transacting: trx,
                })
              : [],
            colorIds.length > 0
              ? dbQuery('api::color.color').findMany({
                  where: buildOrFilters(colorIds) || undefined,
                  select: ['id', 'documentId', 'name'],
                  transacting: trx,
                })
              : [],
          ]);

          const productMap = new Map<string, any>();
          products.forEach((product: any) => {
            if (product.id !== undefined) productMap.set(String(product.id), product);
            if (product.documentId) productMap.set(String(product.documentId), product);
          });

          const colorMap = new Map<string, any>();
          colors.forEach((color: any) => {
            if (color.id !== undefined) colorMap.set(String(color.id), color);
            if (color.documentId) colorMap.set(String(color.documentId), color);
          });

          const orderItems = items.map((item: any) => {
            const product = productMap.get(String(normalizeIdentifier(item.productId)));
            const color = colorMap.get(String(normalizeIdentifier(item.colorId)));
            const quantity = Number(item.quantity) || 1;

            return {
              productName: item.productName || item.title || product?.title || 'Producto',
              colorName: item.colorName || item.selectedColor || color?.name || 'N/A',
              quantity,
              unitPrice: Number(item.unitPrice ?? item.price ?? 0),
              unitCost:
                item.unitCost !== undefined && item.unitCost !== null
                  ? Number(item.unitCost)
                  : Number(product?.costPrice || 0),
              product: product?.id ?? null,
              color: color?.id ?? null,
            };
          });

          const paymentRecords = payments.map((payment: any) => ({
            amount: Number(payment.amount) || 0,
            method: payment.method || 'Efectivo',
            reference: payment.reference || '',
            status: payment.status || 'confirmed',
          }));

          orderPayload.orderItems = orderItems;
          orderPayload.paymentRecords = paymentRecords;

          let savedOrder: any;
          if (existingOrder) {
            savedOrder = await dbQuery('api::order.order').update({
              where: { id: existingOrder.id },
              data: orderPayload,
              transacting: trx,
            });
          } else {
            savedOrder = await dbQuery('api::order.order').create({
              data: orderPayload,
              transacting: trx,
            });
          }

          if (!savedOrder || !savedOrder.id) {
            throw new Error('No se pudo guardar la orden');
          }

          await this.processInventoryStockAndExpense(savedOrder, orderItems, trx);

          const result = await dbQuery('api::order.order').findOne({
            where: { id: savedOrder.id },
            populate: ['dispatchWarehouse', 'customer', 'performedBy'],
            transacting: trx,
          });

          return result;
        } catch (e) {
          console.error('------- TRANSACTION ERROR DETECTED -------');
          console.error(e);
          console.error('------------------------------------------');
          throw e;
        }
      });
    },

    async processInventoryStockAndExpense(order: any, items: any[], trx: any) {
      const orderId = order.id;
      const orderDocId = order.documentId;
      const isCancelled = order.orderStatus === 'cancelled' || order.orderStatus === 'returned';
      const shouldDeduct =
        order.orderStatus !== 'pending' &&
        (order.orderStatus === 'payment_confirmed' || order.orderStatus === 'delivered' || order.orderType === 'credit' || order.orderType === 'apartado');

      let dispatchWarehouse = normalizeIdentifier(order.dispatchWarehouse);

      if (!dispatchWarehouse) {
        const fullOrder = await dbQuery('api::order.order').findOne({
          where: { id: orderId },
          populate: ['dispatchWarehouse'],
          transacting: trx,
        });
        dispatchWarehouse = normalizeIdentifier(fullOrder?.dispatchWarehouse || null);
      }

      if (dispatchWarehouse && !isNumericIdentifier(dispatchWarehouse)) {
        const warehouse = await dbQuery('api::warehouse.warehouse').findOne({
          where: { documentId: dispatchWarehouse },
          select: ['id'],
          transacting: trx,
        });
        if (warehouse?.id) {
          dispatchWarehouse = warehouse.id;
        }
      }

      if (!dispatchWarehouse) {
        const mainWarehouse = await dbQuery('api::warehouse.warehouse').findOne({
          where: { code: 'MAIN' },
          select: ['id'],
          transacting: trx,
        });
        if (mainWarehouse) {
          dispatchWarehouse = mainWarehouse.id;
        }
      }

      const reasonMatches: any[] = [];
      if (orderId) reasonMatches.push({ order: orderId });
      if (orderDocId) reasonMatches.push({ order: { documentId: orderDocId } });
      reasonMatches.push({ reason: { $contains: `Pedido #${orderDocId || orderId}` } });

      const existingSale = await dbQuery('api::inventory-movement.inventory-movement').findOne({
        where: {
          $or: reasonMatches,
          type: 'OUT',
        },
        transacting: trx,
      });

      const existingReturn = await dbQuery('api::inventory-movement.inventory-movement').findOne({
        where: {
          $or: reasonMatches,
          type: 'IN',
        },
        transacting: trx,
      });

      const movementItems = buildOrderMovementItems(items);
      const totalQuantity = movementItems.reduce((sum, current) => sum + Number(current.quantity || 0), 0);

      if (isCancelled && existingSale && !existingReturn) {
        await dbQuery('api::inventory-movement.inventory-movement').create({
          data: {
            type: 'IN',
            reason: `Devolución automática por lote (Cancelación/Devolución Pedido #${orderDocId || orderId})`,
            order: orderId,
            items: movementItems,
            quantity: totalQuantity,
            date: new Date().toISOString(),
            performedBy: order.performedBy?.id || order.performedBy || null,
            exchangeRate: order.exchangeRate || 1,
            warehouse: dispatchWarehouse,
          },
          transacting: trx,
        });
        return;
      }

      if (shouldDeduct && !existingSale) {
        await dbQuery('api::inventory-movement.inventory-movement').create({
          data: {
            type: 'OUT',
            reason: `Venta automática por lote (Pedido #${orderDocId || orderId})`,
            order: orderId,
            items: movementItems,
            quantity: totalQuantity,
            date: new Date().toISOString(),
            performedBy: order.performedBy?.id || order.performedBy || null,
            exchangeRate: order.exchangeRate || 1,
            warehouse: dispatchWarehouse,
          },
          transacting: trx,
        });
      }

      if (order.deliveryMethod === 'delivery' && order.option && order.option !== 'Propio') {
        const primaryRef = `Delivery de la Orden #${orderDocId || orderId}`;
        const existingExpenses = await dbQuery('api::expense.expense').findMany({
          where: {
            $or: [
              ...(orderDocId ? [{ reference: { $eq: `Delivery de la Orden #${orderDocId}` } }] : []),
              ...(orderId ? [{ reference: { $eq: `Delivery de la Orden #${orderId}` } }] : []),
            ],
          },
          transacting: trx,
        });

        const expenseTitle = `Delivery - ${order.option} - ${order.adress || 'Sin dirección'}`;
        if (!existingExpenses || existingExpenses.length === 0) {
          await dbQuery('api::expense.expense').create({
            data: {
              title: expenseTitle,
              amount: Number(order.shippingCost) || 0,
              date: new Date().toISOString().split('T')[0],
              category: 'Operaciones',
              reference: primaryRef,
            },
            transacting: trx,
          });
        } else {
          const [first, ...rest] = existingExpenses;
          await dbQuery('api::expense.expense').update({
            where: { id: first.id },
            data: {
              title: expenseTitle,
              amount: Number(order.shippingCost) || 0,
              reference: primaryRef,
            },
            transacting: trx,
          });

          for (const duplicate of rest) {
            await dbQuery('api::expense.expense').delete({
              where: { id: duplicate.id },
              transacting: trx,
            });
          }
        }
      }
    },
  };
});
