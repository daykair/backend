import { factories } from '@strapi/strapi';
import * as crypto from 'crypto';

const ORDER_FIELDS = [
  'slug',
  'adress',
  'city',
  'state',
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
  'trackingNumber',
  'orderType',
  'amountPaid',
  'performedBy',
  'customer',
  'exchangeRate',
  'shippingCost',
  'discount',
  'notes',
  'dispatchWarehouse',
];

function normalizeOrderStatus(status?: string): string | undefined {
  if (!status) return status;
  const trimmed = status.trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'pendiente por pago') return 'pending';
  if (lower === 'verification_failed') return 'failed_verification';
  return trimmed;
}

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
  return (
    typeof value === 'number' ||
    (typeof value === 'string' && /^[0-9]+$/.test(value.toString()))
  );
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
      } else if (field === 'orderStatus') {
        payload[field] = normalizeOrderStatus(orderData[field]);
      } else {
        payload[field] = orderData[field];
      }
    }
  }

  if (payments.length > 0) {
    payload.amountPaid = payments.reduce(
      (sum, payment) => sum + (Number(payment.amount) || 0),
      0,
    );
    if (payments.length > 1) {
      payload.method = 'Múltiple';
    } else if (payments[0]?.method) {
      payload.method = payments[0].method;
    }
  }

  if (!payload.orderPlaced) {
    payload.orderPlaced = new Date().toISOString();
  }

  // Ensure Strapi v5 Document Service recognizes the row as published
  payload.publishedAt = new Date().toISOString();
  payload.status = 'published';

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
      const hasOrderItems =
        Array.isArray(orderData.items) ||
        Array.isArray(orderData.order) ||
        Array.isArray(orderData.orderItems);
      const hasPayments =
        Array.isArray(orderData.payments) || Array.isArray(orderData.payment);
      const lookupValue = orderData.id ?? orderData.documentId;

      return await strapi.db.transaction(async (trx) => {
        try {
          const orderPayload = buildOrderPayload(orderData, payments);
          const where = lookupValue ? buildWhere(lookupValue) : null;

          const existingOrder = where
            ? await dbQuery('api::order.order').findOne({
                where,
                select: [
                  'id',
                  'documentId',
                  'orderStatus',
                  'orderType',
                  'orderTotal',
                  'amountPaid',
                  'method',
                  'paymentReference',
                  'orderItems',
                  'paymentRecords',
                ],
                transacting: trx,
              })
            : null;

          // RESOLVER RELACIONES: db.query requiere IDs internos (numéricos), no documentIds.
          if (
            orderPayload.dispatchWarehouse &&
            typeof orderPayload.dispatchWarehouse === 'string' &&
            !/^\d+$/.test(orderPayload.dispatchWarehouse)
          ) {
            const dw = await dbQuery('api::warehouse.warehouse').findOne({
              where: { documentId: orderPayload.dispatchWarehouse },
              select: ['id'],
              transacting: trx,
            });
            orderPayload.dispatchWarehouse = dw ? dw.id : null;
          }

          if (orderPayload.customer) {
            if (
              typeof orderPayload.customer === 'string' &&
              !/^\d+$/.test(orderPayload.customer)
            ) {
              const cus = await dbQuery('plugin::users-permissions.user').findOne({
                where: { documentId: orderPayload.customer },
                select: ['id'],
                transacting: trx,
              });
              orderPayload.customer = cus ? cus.id : null;
            }
          } else if (orderPayload.phone) {
            // Auto-vincular o auto-crear usuario basado en el número de teléfono
            const existingUser = await dbQuery('plugin::users-permissions.user').findOne({
              where: { phone: orderPayload.phone },
              select: ['id'],
              transacting: trx,
            });

            if (existingUser) {
              orderPayload.customer = existingUser.id;
            } else if (orderPayload.clientName) {
              const fakeEmail = `${orderPayload.phone.replace(/\D/g, '')}@cliente.local`;

              const userByEmail = await dbQuery('plugin::users-permissions.user').findOne({
                where: { email: fakeEmail },
                select: ['id'],
                transacting: trx,
              });

              if (!userByEmail) {
                const defaultRole = await dbQuery('plugin::users-permissions.role').findOne({
                  where: { type: 'client' },
                  select: ['id'],
                  transacting: trx,
                });

                const newUser = await dbQuery('plugin::users-permissions.user').create({
                  data: {
                    username:
                      orderPayload.clientName + '-' + Math.floor(Math.random() * 1000),
                    email: fakeEmail,
                    password: crypto.randomBytes(12).toString('hex'),
                    phone: orderPayload.phone,
                    fullname: orderPayload.clientName || null,
                    name: orderPayload.clientName || null,
                    address: orderPayload.adress || null,
                    adress: orderPayload.adress || null,
                    city: orderPayload.city || null,
                    confirmed: true,
                    blocked: false,
                    role: defaultRole ? defaultRole.id : null,
                  },
                  transacting: trx,
                });

                orderPayload.customer = newUser.id;
              }
            }
          }

          if (
            orderPayload.performedBy &&
            typeof orderPayload.performedBy === 'string' &&
            !/^\d+$/.test(orderPayload.performedBy)
          ) {
            const pb = await dbQuery('plugin::users-permissions.user').findOne({
              where: { documentId: orderPayload.performedBy },
              select: ['id'],
              transacting: trx,
            });
            orderPayload.performedBy = pb ? pb.id : null;
          }

          let orderItems = Array.isArray(existingOrder?.orderItems)
            ? existingOrder.orderItems
            : [];

          if (hasOrderItems && items.length > 0) {
            const productIds = items
              .map((item: any) => normalizeIdentifier(item.productId))
              .filter(Boolean);
            const colorIds = items
              .map((item: any) => normalizeIdentifier(item.colorId))
              .filter(Boolean);

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
                    populate: ['images'],
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

            // Map existing items to preserve productImage if not sent in partial updates
            const existingItemImageMap = new Map<string, string>();
            if (Array.isArray(existingOrder?.orderItems)) {
              existingOrder.orderItems.forEach((exItem: any) => {
                const key = `${exItem.product || exItem.productId}-${exItem.color || exItem.colorId}`;
                if (exItem.productImage) existingItemImageMap.set(key, exItem.productImage);
              });
            }

            orderItems = items.map((item: any) => {
              const product = productMap.get(String(normalizeIdentifier(item.productId)));
              const color = colorMap.get(String(normalizeIdentifier(item.colorId)));
              const quantity = Number(item.quantity) || 1;

              const colorFirstImg =
                color?.images?.[0]?.formats?.thumbnail?.url ||
                color?.images?.[0]?.formats?.small?.url ||
                color?.images?.[0]?.url ||
                '';
              const lookupKey = `${product?.id || item.productId}-${color?.id || item.colorId}`;

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
                productImage:
                  item.productImage ||
                  existingItemImageMap.get(lookupKey) ||
                  colorFirstImg ||
                  '',
                priceType: item.priceType || 'detal',
              };
            });

            orderPayload.orderItems = orderItems;
          }

          // Manejo inteligente de pagos y confirmaciones de órdenes web
          const effectiveOrderType =
            orderPayload.orderType || existingOrder?.orderType || 'regular';
          const effectiveStatus =
            orderPayload.orderStatus || existingOrder?.orderStatus || 'pending';
          const effectiveTotal = Number(
            orderPayload.orderTotal ?? existingOrder?.orderTotal ?? 0,
          );

          if (hasPayments && payments.length > 0) {
            const paymentRecords = payments.map((payment: any) => ({
              amount: Number(payment.amount) || 0,
              method: payment.method || 'Efectivo',
              reference: payment.reference || '',
              currency: payment.currency || 'USD',
              status: payment.status || 'confirmed',
              date: payment.date || new Date().toISOString(),
            }));
            orderPayload.paymentRecords = paymentRecords;
          } else if (existingOrder) {
            const existingRecords = Array.isArray(existingOrder.paymentRecords)
              ? existingOrder.paymentRecords
              : [];
            const isConfirming =
              effectiveStatus === 'payment_confirmed' || effectiveStatus === 'delivered';

            if (isConfirming && existingRecords.length === 0) {
              const rawMethod = orderPayload.method || existingOrder.method || 'Pago Móvil';
              const normalizedMethod =
                rawMethod === 'pago-movil'
                  ? 'Pago Móvil'
                  : rawMethod === 'binance'
                  ? 'Binance'
                  : rawMethod === 'cashea'
                  ? 'Cashea'
                  : rawMethod;
              const paidAmount =
                effectiveOrderType === 'regular'
                  ? effectiveTotal
                  : Number(orderPayload.amountPaid ?? existingOrder.amountPaid ?? 0) ||
                    (effectiveOrderType === 'cashea'
                      ? Number((effectiveTotal * 0.4).toFixed(2))
                      : 0);

              if (paidAmount > 0) {
                orderPayload.amountPaid = paidAmount;
                orderPayload.paymentRecords = [
                  {
                    amount: paidAmount,
                    method: normalizedMethod,
                    reference:
                      orderPayload.paymentReference || existingOrder.paymentReference || '',
                    status: 'confirmed',
                    date: new Date().toISOString(),
                  },
                ];
              } else {
                orderPayload.paymentRecords = existingRecords;
              }
            } else {
              orderPayload.paymentRecords = existingRecords;
            }
          } else {
            orderPayload.paymentRecords = [];
          }

          let savedOrder: any;
          if (existingOrder) {
            savedOrder = await dbQuery('api::order.order').update({
              where: { id: existingOrder.id },
              data: orderPayload,
              transacting: trx,
            });
          } else {
            orderPayload.documentId = crypto.randomBytes(12).toString('hex');
            orderPayload.locale = 'es';

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
            populate: ['dispatchWarehouse', 'customer', 'performedBy', 'referenceImage'],
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
      const normalizedStatus = normalizeOrderStatus(order.orderStatus);
      const isCancelled =
        normalizedStatus === 'cancelled' || normalizedStatus === 'returned';
      const shouldDeduct =
        normalizedStatus !== 'pending' &&
        normalizedStatus !== 'failed_verification' &&
        (normalizedStatus === 'payment_confirmed' ||
          normalizedStatus === 'delivered' ||
          order.orderType === 'credit' ||
          order.orderType === 'apartado' ||
          (order.orderType === 'cashea' && Number(order.amountPaid) > 0));

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

      const existingSale = await dbQuery(
        'api::inventory-movement.inventory-movement',
      ).findOne({
        where: {
          $or: reasonMatches,
          type: 'OUT',
          reason: { $contains: 'Venta automática por lote' },
        },
        transacting: trx,
      });

      const existingReturn = await dbQuery(
        'api::inventory-movement.inventory-movement',
      ).findOne({
        where: {
          $or: reasonMatches,
          type: 'IN',
          reason: { $contains: 'Devolución automática por lote' },
        },
        transacting: trx,
      });

      const movementItems = buildOrderMovementItems(items);
      const totalQuantity = movementItems.reduce(
        (sum, current) => sum + Number(current.quantity || 0),
        0,
      );

      if (isCancelled && existingSale && !existingReturn) {
        await dbQuery('api::inventory-movement.inventory-movement').create({
          data: {
            type: 'IN',
            reason: `Devolución automática por lote (Cancelación/Devolución Pedido #${
              orderDocId || orderId
            })`,
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
      } else if (shouldDeduct && existingSale && !existingReturn && Array.isArray(existingSale.items)) {
        // Si el pedido ya descontó stock y fue editado, calculamos diferencias (deltas) por variante
        const prevMap = new Map<string, { qty: number; item: any }>();
        existingSale.items.forEach((it: any) => {
          const cid = String(it.colorId || '');
          if (!cid) return;
          const cur = prevMap.get(cid);
          prevMap.set(cid, { qty: (cur?.qty || 0) + Number(it.quantity || 0), item: it });
        });

        const nextMap = new Map<string, { qty: number; item: any }>();
        movementItems.forEach((it: any) => {
          const cid = String(it.colorId || '');
          if (!cid) return;
          const cur = nextMap.get(cid);
          nextMap.set(cid, { qty: (cur?.qty || 0) + Number(it.quantity || 0), item: it });
        });

        const outDeltaItems: any[] = [];
        const inDeltaItems: any[] = [];

        const allColorKeys = new Set([...prevMap.keys(), ...nextMap.keys()]);
        allColorKeys.forEach((cid) => {
          const prevQty = prevMap.get(cid)?.qty || 0;
          const nextQty = nextMap.get(cid)?.qty || 0;
          const refItem = nextMap.get(cid)?.item || prevMap.get(cid)?.item;
          if (nextQty > prevQty) {
            outDeltaItems.push({ ...refItem, quantity: nextQty - prevQty });
          } else if (prevQty > nextQty) {
            inDeltaItems.push({ ...refItem, quantity: prevQty - nextQty });
          }
        });

        if (outDeltaItems.length > 0) {
          const outQty = outDeltaItems.reduce((s, i) => s + i.quantity, 0);
          await dbQuery('api::inventory-movement.inventory-movement').create({
            data: {
              type: 'OUT',
              reason: `Ajuste por edición de Pedido #${orderDocId || orderId}`,
              order: orderId,
              items: outDeltaItems,
              quantity: outQty,
              date: new Date().toISOString(),
              performedBy: order.performedBy?.id || order.performedBy || null,
              exchangeRate: order.exchangeRate || 1,
              warehouse: dispatchWarehouse,
            },
            transacting: trx,
          });
        }

        if (inDeltaItems.length > 0) {
          const inQty = inDeltaItems.reduce((s, i) => s + i.quantity, 0);
          await dbQuery('api::inventory-movement.inventory-movement').create({
            data: {
              type: 'IN',
              reason: `Reintegro por edición de Pedido #${orderDocId || orderId}`,
              order: orderId,
              items: inDeltaItems,
              quantity: inQty,
              date: new Date().toISOString(),
              performedBy: order.performedBy?.id || order.performedBy || null,
              exchangeRate: order.exchangeRate || 1,
              warehouse: dispatchWarehouse,
            },
            transacting: trx,
          });
        }

        if (outDeltaItems.length > 0 || inDeltaItems.length > 0) {
          await dbQuery('api::inventory-movement.inventory-movement').update({
            where: { id: existingSale.id },
            data: {
              items: movementItems,
              quantity: totalQuantity,
            },
            transacting: trx,
          });
        }
      }

      if (order.deliveryMethod === 'delivery' && order.option && order.option !== 'Propio') {
        const primaryRef = `Delivery de la Orden #${orderDocId || orderId}`;
        const existingExpenses = await dbQuery('api::expense.expense').findMany({
          where: {
            $or: [
              ...(orderDocId
                ? [{ reference: { $eq: `Delivery de la Orden #${orderDocId}` } }]
                : []),
              ...(orderId
                ? [{ reference: { $eq: `Delivery de la Orden #${orderId}` } }]
                : []),
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
