import { factories } from '@strapi/strapi';
import * as crypto from 'crypto';
import {
  resolveEntityDocumentId,
  SAFE_USER_DB_POPULATE,
  sanitizeEntityUserRelations,
} from '../../../utils/adminCrud';

function toCaracasDateStr(raw: unknown): string {
  if (!raw) return '';
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  }
  const d = raw instanceof Date ? raw : new Date(raw as string | number);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - 4 * 3600000).toISOString().split('T')[0];
}

function getMondayStr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() - day + 1);
  return dt.toISOString().split('T')[0];
}

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

function buildOrderMovementItems(items: any[], subtractReturned = false) {
  return items
    .map((item) => {
      const sold = Number(item.quantity) || 0;
      const prevRet = subtractReturned ? Number(item.returnedQuantity) || 0 : 0;
      const qty = Math.max(0, Number((sold - prevRet).toFixed(3)));
      const sizeId = item.size || normalizeIdentifier(item.sizeId) || null;
      return {
        colorId: item.color || normalizeIdentifier(item.colorId) || null,
        ...(sizeId ? { sizeId, sizeName: item.sizeName || null } : {}),
        productId: item.product || normalizeIdentifier(item.productId) || null,
        title: item.productName || item.title || 'Producto',
        colorName: item.colorName || item.selectedColor || 'N/A',
        quantity: qty,
      };
    })
    .filter((it) => it.quantity > 0);
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

      const txOutcome = await strapi.db.transaction(async (trx) => {
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
            const sizeIds = items
              .map((item: any) => normalizeIdentifier(item.sizeId))
              .filter(Boolean);

            const [products, colors, sizes] = await Promise.all([
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
              sizeIds.length > 0
                ? dbQuery('api::size.size').findMany({
                    where: buildOrFilters(sizeIds) || undefined,
                    select: ['id', 'documentId', 'name', 'costPrice'],
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

            const sizeMap = new Map<string, any>();
            sizes.forEach((size: any) => {
              if (size.id !== undefined) sizeMap.set(String(size.id), size);
              if (size.documentId) sizeMap.set(String(size.documentId), size);
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
              const rawSizeId = normalizeIdentifier(item.sizeId);
              const size = rawSizeId ? sizeMap.get(String(rawSizeId)) : null;
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
                ...(size || item.sizeId
                  ? {
                      sizeId: size?.documentId || size?.id || item.sizeId,
                      sizeName: item.sizeName || size?.name || '',
                      size: size?.id ?? null,
                    }
                  : {}),
                quantity,
                unitPrice: Number(item.unitPrice ?? item.price ?? 0),
                unitCost:
                  item.unitCost !== undefined && item.unitCost !== null
                    ? Number(item.unitCost)
                    : Number(size?.costPrice ?? product?.costPrice ?? 0),
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
            populate: {
              dispatchWarehouse: true,
              customer: SAFE_USER_DB_POPULATE,
              performedBy: SAFE_USER_DB_POPULATE,
              referenceImage: true,
            },
            transacting: trx,
          });

          const previousNormStatus = existingOrder?.orderStatus
            ? normalizeOrderStatus(existingOrder.orderStatus)
            : null;
          return { result: sanitizeEntityUserRelations(result), previousNormStatus };
        } catch (e) {
          console.error('------- TRANSACTION ERROR DETECTED -------');
          console.error(e);
          console.error('------------------------------------------');
          throw e;
        }
      });

      const nextNormStatus = normalizeOrderStatus(txOutcome.result?.orderStatus);
      if (nextNormStatus === 'payment_confirmed' || nextNormStatus === 'delivered') {
        const publicUtils = require('../utils/publicOrder');
        void publicUtils.sendOrderStatusNotification(
          strapi,
          txOutcome.result,
          nextNormStatus,
          txOutcome.previousNormStatus,
        );
      }

      return txOutcome.result;
    },

    async processInventoryStockAndExpense(order: any, items: any[], trx: any) {
      const orderId = order.id;
      const orderDocId = order.documentId;
      const normalizedStatus = normalizeOrderStatus(order.orderStatus);
      const isCancelled =
        normalizedStatus === 'cancelled' || normalizedStatus === 'returned';
      const shouldDeduct =
        normalizedStatus !== 'failed_verification' &&
        !isCancelled &&
        (normalizedStatus === 'payment_confirmed' ||
          normalizedStatus === 'delivered' ||
          (normalizedStatus !== 'pending' &&
            (order.orderType === 'credit' || order.orderType === 'apartado')) ||
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
        const remainingReturnItems = buildOrderMovementItems(items, true);
        const remainingReturnQty = remainingReturnItems.reduce(
          (sum, current) => sum + Number(current.quantity || 0),
          0,
        );
        if (remainingReturnItems.length > 0 && remainingReturnQty > 0) {
          await dbQuery('api::inventory-movement.inventory-movement').create({
            data: {
              type: 'IN',
              reason: `Devolución automática por lote (Cancelación/Devolución Pedido #${
                orderDocId || orderId
              })`,
              order: orderId,
              items: remainingReturnItems,
              quantity: remainingReturnQty,
              date: new Date().toISOString(),
              performedBy: order.performedBy?.id || order.performedBy || null,
              exchangeRate: order.exchangeRate || 1,
              warehouse: dispatchWarehouse,
            },
            transacting: trx,
          });
        }
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
        // Si el pedido ya descontó stock y fue editado, calculamos diferencias (deltas) por variante+talla
        const getItemVariantKey = (it: any) => {
          const cid = String(it?.colorId || '');
          if (!cid) return '';
          const sid = it?.sizeId ? String(it.sizeId) : '';
          return sid ? `${cid}::${sid}` : cid;
        };

        const prevMap = new Map<string, { qty: number; item: any }>();
        existingSale.items.forEach((it: any) => {
          const key = getItemVariantKey(it);
          if (!key) return;
          const cur = prevMap.get(key);
          prevMap.set(key, { qty: (cur?.qty || 0) + Number(it.quantity || 0), item: it });
        });

        const nextMap = new Map<string, { qty: number; item: any }>();
        movementItems.forEach((it: any) => {
          const key = getItemVariantKey(it);
          if (!key) return;
          const cur = nextMap.get(key);
          nextMap.set(key, { qty: (cur?.qty || 0) + Number(it.quantity || 0), item: it });
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

    async getAnalyticsSummary(options: {
      period?: 'daily' | 'weekly' | 'monthly' | 'custom';
      from?: string;
      to?: string;
      warehouseId?: string | null;
      lowStockThreshold?: number;
      canViewOrders: boolean;
      canViewExpenses: boolean;
      canViewProducts: boolean;
    }) {
      const period = options.period || 'monthly';
      const nowCaracas = new Date(Date.now() - 4 * 3600000);
      const todayStr = nowCaracas.toISOString().split('T')[0];

      const resolvedWhDocId =
        options.warehouseId && options.warehouseId !== 'all'
          ? await resolveEntityDocumentId(strapi, 'api::warehouse.warehouse', options.warehouseId)
          : null;

      // Resolver rango de KPI según período
      let kpiStartStr = todayStr;
      let kpiEndStr = todayStr;
      if (period === 'custom') {
        const defaultStart = new Date(nowCaracas.getTime() - 29 * 86400000).toISOString().split('T')[0];
        kpiStartStr = options.from && /^\d{4}-\d{2}-\d{2}$/.test(options.from) ? options.from : defaultStart;
        kpiEndStr = options.to && /^\d{4}-\d{2}-\d{2}$/.test(options.to) ? options.to : todayStr;
        if (kpiStartStr > kpiEndStr) [kpiStartStr, kpiEndStr] = [kpiEndStr, kpiStartStr];
      } else if (period === 'daily') {
        kpiStartStr = todayStr;
        kpiEndStr = todayStr;
      } else if (period === 'weekly') {
        kpiStartStr = getMondayStr(todayStr);
        kpiEndStr = todayStr;
      } else {
        kpiStartStr = `${todayStr.slice(0, 7)}-01`;
        kpiEndStr = todayStr;
      }

      const [companySetting, products, warehouseStocks, allOrders, allExpenses] = await Promise.all([
        (strapi.documents('api::company-setting.company-setting' as any) as any).findFirst().catch(() => null),
        options.canViewProducts || options.canViewOrders
          ? strapi.documents('api::product.product').findMany({
              populate: { colors: { populate: { sizes: true } } } as any,
              limit: 5000,
            })
          : Promise.resolve([]),
        resolvedWhDocId
          ? strapi.documents('api::warehouse-stock.warehouse-stock').findMany({
              filters: { warehouse: { documentId: resolvedWhDocId } } as any,
              populate: { color: { populate: { product: true } }, size: true } as any,
              limit: 10000,
            })
          : Promise.resolve([]),
        options.canViewOrders
          ? strapi.documents('api::order.order').findMany({
              populate: { dispatchWarehouse: true },
              sort: 'createdAt:desc',
              limit: 10000,
            })
          : Promise.resolve([]),
        options.canViewExpenses
          ? strapi.documents('api::expense.expense').findMany({
              sort: 'date:asc',
              limit: 10000,
            })
          : Promise.resolve([]),
      ]);

      const configuredThreshold = Number((companySetting as any)?.operationalSettings?.lowStockThreshold ?? 5);
      const lowStockThreshold =
        options.lowStockThreshold !== undefined && !Number.isNaN(Number(options.lowStockThreshold))
          ? Number(options.lowStockThreshold)
          : configuredThreshold;

      // Costos por producto, valor de inventario y stock bajo
      const productCosts: Record<string, number> = {};
      let inventoryValue = 0;
      let lowStockCount = 0;

      (products as any[]).forEach((p: any) => {
        const cost = Number(p.costPrice || 0);
        if (p.documentId) productCosts[p.documentId] = cost;
        if (p.id) productCosts[String(p.id)] = cost;

        if (!resolvedWhDocId && options.canViewProducts) {
          const colors = Array.isArray(p.colors) ? p.colors : [];
          colors.forEach((c: any) => {
            const sizes = Array.isArray(c.sizes) ? c.sizes : [];
            if (sizes.length > 0) {
              sizes.forEach((sz: any) => {
                const st = Number(sz.stock ?? 0);
                const szCost = sz.costPrice != null ? Number(sz.costPrice) : cost;
                inventoryValue += Math.max(0, st) * szCost;
                if (st <= lowStockThreshold) lowStockCount++;
              });
            } else {
              const st = Number(c.stock ?? 0);
              inventoryValue += Math.max(0, st) * cost;
              if (st <= lowStockThreshold) lowStockCount++;
            }
          });
        }
      });

      if (resolvedWhDocId && options.canViewProducts) {
        (warehouseStocks as any[]).forEach((ws: any) => {
          const st = Number(ws.stock ?? 0);
          const pCost = Number(ws.size?.costPrice ?? ws.color?.product?.costPrice ?? 0);
          inventoryValue += Math.max(0, st) * pCost;
          if (st <= lowStockThreshold) lowStockCount++;
        });
      }

      // Filtrar pedidos por almacén si se especificó
      const filteredOrders = resolvedWhDocId
        ? (allOrders as any[]).filter((o: any) => o.dispatchWarehouse?.documentId === resolvedWhDocId)
        : (allOrders as any[]);

      // Buckets para gráficos
      type ChartRow = {
        monthKey: string;
        name: string;
        ingresos: number;
        costos: number;
        gastos: number;
        ganancia: number;
        pedidos: number;
      };
      const timeData: Record<string, ChartRow> = {};

      let customGroupByMonth = false;
      if (period === 'custom') {
        const startMs = new Date(`${kpiStartStr}T00:00:00Z`).getTime();
        const endMs = new Date(`${kpiEndStr}T00:00:00Z`).getTime();
        const diffDays = Math.max(1, Math.round((endMs - startMs) / 86400000) + 1);
        customGroupByMonth = diffDays > 62;
        if (customGroupByMonth) {
          const cursor = new Date(`${kpiStartStr.slice(0, 7)}-01T00:00:00Z`);
          const endCursor = new Date(`${kpiEndStr.slice(0, 7)}-01T00:00:00Z`);
          while (cursor <= endCursor) {
            const key = cursor.toISOString().slice(0, 7);
            const name = cursor.toLocaleString('es-ES', { month: 'short', year: 'numeric', timeZone: 'UTC' });
            timeData[key] = {
              monthKey: key,
              name: name.charAt(0).toUpperCase() + name.slice(1),
              ingresos: 0,
              costos: 0,
              gastos: 0,
              ganancia: 0,
              pedidos: 0,
            };
            cursor.setUTCMonth(cursor.getUTCMonth() + 1);
          }
        } else {
          for (let ts = startMs; ts <= endMs; ts += 86400000) {
            const d = new Date(ts);
            const key = d.toISOString().split('T')[0];
            const name = d.toLocaleString('es-ES', { day: '2-digit', month: 'short', timeZone: 'UTC' });
            timeData[key] = { monthKey: key, name, ingresos: 0, costos: 0, gastos: 0, ganancia: 0, pedidos: 0 };
          }
        }
      } else if (period === 'monthly') {
        const baseY = nowCaracas.getUTCFullYear();
        const baseM = nowCaracas.getUTCMonth();
        for (let i = 11; i >= 0; i--) {
          const d = new Date(Date.UTC(baseY, baseM - i, 1));
          const key = d.toISOString().slice(0, 7);
          const name = d.toLocaleString('es-ES', { month: 'short', year: 'numeric', timeZone: 'UTC' });
          timeData[key] = {
            monthKey: key,
            name: name.charAt(0).toUpperCase() + name.slice(1),
            ingresos: 0,
            costos: 0,
            gastos: 0,
            ganancia: 0,
            pedidos: 0,
          };
        }
      } else if (period === 'weekly') {
        for (let i = 11; i >= 0; i--) {
          const refDate = new Date(nowCaracas.getTime() - i * 7 * 86400000);
          const monKey = getMondayStr(refDate.toISOString().split('T')[0]);
          const monDate = new Date(`${monKey}T00:00:00Z`);
          const name = `Sem ${monDate.getUTCDate()} ${monDate.toLocaleString('es-ES', { month: 'short', timeZone: 'UTC' })}`;
          timeData[monKey] = { monthKey: monKey, name, ingresos: 0, costos: 0, gastos: 0, ganancia: 0, pedidos: 0 };
        }
      } else {
        for (let i = 13; i >= 0; i--) {
          const d = new Date(nowCaracas.getTime() - i * 86400000);
          const key = d.toISOString().split('T')[0];
          const name = d.toLocaleString('es-ES', { day: '2-digit', month: 'short', timeZone: 'UTC' });
          timeData[key] = { monthKey: key, name, ingresos: 0, costos: 0, gastos: 0, ganancia: 0, pedidos: 0 };
        }
      }

      const resolveGroupKey = (dateStr: string): string => {
        if (!dateStr) return '';
        if (period === 'monthly' || (period === 'custom' && customGroupByMonth)) return dateStr.slice(0, 7);
        if (period === 'weekly') return getMondayStr(dateStr);
        return dateStr;
      };

      let totalOrders = 0;
      let totalRevenue = 0;
      let totalCost = 0;
      let totalExpenses = 0;

      const methodStats: Record<string, { method: string; amount: number; count: number }> = {};
      const productStats: Record<string, { productId: string; productName: string; quantity: number; revenue: number }> = {};
      const warehouseStats: Record<string, { warehouseId: string; warehouseName: string; orders: number; revenue: number }> = {};

      filteredOrders.forEach((order: any) => {
        const orderDateStr = toCaracasDateStr(order.createdAt || order.orderPlaced);
        const st = String(normalizeOrderStatus(order.orderStatus) || '').toLowerCase();
        const isLayawayType =
          order.orderType === 'apartado' || order.orderType === 'credit' || order.orderType === 'cashea';
        const amount = isLayawayType ? Number(order.amountPaid) || 0 : Number(order.orderTotal) || 0;
        const isUnpaidPending =
          (st === 'pending' || st === 'pending_verification' || st === 'failed_verification') &&
          (!isLayawayType || amount <= 0);
        const isActive = st !== 'cancelled' && st !== 'returned' && !isUnpaidPending;

        if (!isActive) return;

        const inKpiWindow = orderDateStr >= kpiStartStr && orderDateStr <= kpiEndStr;
        if (inKpiWindow) {
          totalOrders++;
        }

        const orderItems = Array.isArray(order.orderItems)
          ? order.orderItems
          : Array.isArray(order.order)
            ? order.order
            : [];

        let orderCost = 0;
        orderItems.forEach((item: any) => {
          const pId = String(item.product?.documentId || item.product?.id || item.product || item.productId || '');
          const cost = item.unitCost !== undefined ? Number(item.unitCost) : (productCosts[pId] || 0);
          const qty = Math.max(0, Number(item.quantity || 1) - Number(item.returnedQuantity || 0));
          orderCost += cost * qty;
        });

        if (inKpiWindow) {
          totalRevenue += amount;
          totalCost += orderCost;

          // Agrupar método de pago
          const records = Array.isArray(order.paymentRecords) ? order.paymentRecords : [];
          if (records.length > 0) {
            records.forEach((pr: any) => {
              if (pr.status && pr.status !== 'confirmed') return;
              const mName = String(pr.method || order.method || 'Otros').trim() || 'Otros';
              if (!methodStats[mName]) methodStats[mName] = { method: mName, amount: 0, count: 0 };
              methodStats[mName].amount += Number(pr.amount || 0);
              methodStats[mName].count += 1;
            });
          } else {
            const mName = String(order.method || 'Otros').trim() || 'Otros';
            if (!methodStats[mName]) methodStats[mName] = { method: mName, amount: 0, count: 0 };
            methodStats[mName].amount += amount;
            methodStats[mName].count += 1;
          }

          // Agrupar productos vendidos
          orderItems.forEach((item: any) => {
            const pKey = String(item.productId || item.productName || item.title || 'item');
            const pName = String(item.productName || item.title || 'Producto');
            const qty = Math.max(0, Number(item.quantity || 1) - Number(item.returnedQuantity || 0));
            const unitPrice = Number(item.unitPrice ?? item.price ?? 0);
            if (!productStats[pKey]) {
              productStats[pKey] = { productId: pKey, productName: pName, quantity: 0, revenue: 0 };
            }
            productStats[pKey].quantity += qty;
            productStats[pKey].revenue += qty * unitPrice;
          });

          // Agrupar por almacén
          const whKey = order.dispatchWarehouse?.documentId || 'unassigned';
          const whName = order.dispatchWarehouse?.name || 'Sin almacén asignado';
          if (!warehouseStats[whKey]) {
            warehouseStats[whKey] = { warehouseId: whKey, warehouseName: whName, orders: 0, revenue: 0 };
          }
          warehouseStats[whKey].orders += 1;
          warehouseStats[whKey].revenue += amount;
        }

        const gKey = resolveGroupKey(orderDateStr);
        if (timeData[gKey]) {
          timeData[gKey].pedidos++;
          timeData[gKey].ingresos += amount;
          timeData[gKey].costos += orderCost;
        }
      });

      (allExpenses as any[]).forEach((expense: any) => {
        const expDateStr = toCaracasDateStr(expense.date || expense.createdAt);
        if (!expDateStr) return;
        const amt = Number(expense.amount || 0);
        if (expDateStr >= kpiStartStr && expDateStr <= kpiEndStr) {
          totalExpenses += amt;
        }
        const gKey = resolveGroupKey(expDateStr);
        if (timeData[gKey]) {
          timeData[gKey].gastos += amt;
        }
      });

      const chartData = Object.values(timeData).map((row) => ({
        ...row,
        ingresos: Number(row.ingresos.toFixed(2)),
        costos: Number(row.costos.toFixed(2)),
        gastos: Number(row.gastos.toFixed(2)),
        ganancia:
          options.canViewOrders && options.canViewExpenses
            ? Number((row.ingresos - row.costos - row.gastos).toFixed(2))
            : 0,
      }));

      const totalProfit =
        options.canViewOrders && options.canViewExpenses
          ? Number((totalRevenue - totalCost - totalExpenses).toFixed(2))
          : 0;

      return {
        period,
        range: { from: kpiStartStr, to: kpiEndStr },
        warehouseId: resolvedWhDocId || 'all',
        stats: {
          totalOrders,
          totalRevenue: Number(totalRevenue.toFixed(2)),
          totalCost: Number(totalCost.toFixed(2)),
          totalExpenses: Number(totalExpenses.toFixed(2)),
          totalProfit,
          lowStockCount,
        },
        chartData,
        raw: {
          ordersCount: filteredOrders.length,
          expensesCount: (allExpenses as any[]).length,
          productsCount: (products as any[]).length,
          inventoryValue: Number(inventoryValue.toFixed(2)),
        },
        byPaymentMethod: Object.values(methodStats).sort((a, b) => b.amount - a.amount),
        topProducts: Object.values(productStats).sort((a, b) => b.revenue - a.revenue).slice(0, 5),
        byWarehouse: Object.values(warehouseStats).sort((a, b) => b.revenue - a.revenue),
      };
    },

    async processPartialReturn(
      orderIdOrDocId: string | number,
      payload: {
        items: Array<{
          index?: number;
          productId?: string | number;
          colorId?: string | number;
          sizeId?: string | number;
          quantity: number;
        }>;
        reason?: string;
        refundAmount?: number;
      },
      user?: any,
    ) {
      const where = buildWhere(orderIdOrDocId);
      if (!where || Object.keys(where).length === 0) {
        const err: any = new Error('Identificador de pedido inválido');
        err.status = 400;
        throw err;
      }

      return await strapi.db.transaction(async (trx) => {
        const order = await dbQuery('api::order.order').findOne({
          where,
          populate: {
            dispatchWarehouse: true,
            performedBy: SAFE_USER_DB_POPULATE,
            customer: SAFE_USER_DB_POPULATE,
            referenceImage: true,
          },
          transacting: trx,
        });

        if (!order) {
          const err: any = new Error('Pedido no encontrado');
          err.status = 404;
          throw err;
        }

        const currentStatus = normalizeOrderStatus(order.orderStatus);
        if (currentStatus === 'cancelled' || currentStatus === 'returned') {
          const err: any = new Error('Este pedido ya está cancelado o devuelto en su totalidad.');
          err.status = 400;
          throw err;
        }

        const saleReasonMatches: any[] = [];
        if (order.id) saleReasonMatches.push({ order: order.id });
        if (order.documentId) saleReasonMatches.push({ order: { documentId: order.documentId } });
        saleReasonMatches.push({ reason: { $contains: `Pedido #${order.documentId || order.id}` } });

        const existingOutSale = await dbQuery('api::inventory-movement.inventory-movement').findOne({
          where: {
            $or: saleReasonMatches,
            type: 'OUT',
            reason: { $contains: 'Venta automática por lote' },
          },
          select: ['id'],
          transacting: trx,
        });

        if (!existingOutSale) {
          const err: any = new Error(
            'El pedido aún no ha descontado inventario confirmado para procesar una devolución.',
          );
          err.status = 400;
          throw err;
        }

        const requestedLines = Array.isArray(payload.items)
          ? payload.items.filter((it) => Number(it.quantity) > 0)
          : [];
        if (requestedLines.length === 0) {
          const err: any = new Error('Debes indicar al menos un artículo con cantidad mayor a 0 para devolver.');
          err.status = 400;
          throw err;
        }

        const orderItems: any[] = Array.isArray(order.orderItems)
          ? order.orderItems.map((it: any) => ({ ...it }))
          : [];
        if (orderItems.length === 0) {
          const err: any = new Error('El pedido no posee artículos registrados.');
          err.status = 400;
          throw err;
        }

        const movementItems: any[] = [];
        let computedCredit = 0;

        for (const reqItem of requestedLines) {
          const retQty = Number(reqItem.quantity) || 0;
          let targetIdx = -1;

          if (
            reqItem.index !== undefined &&
            Number.isInteger(Number(reqItem.index)) &&
            orderItems[Number(reqItem.index)]
          ) {
            targetIdx = Number(reqItem.index);
          } else {
            targetIdx = orderItems.findIndex((oi: any) => {
              const oiColor = String(normalizeIdentifier(oi.color || oi.colorId) || '');
              const oiSize = String(normalizeIdentifier(oi.size || oi.sizeId) || '');
              const oiProd = String(normalizeIdentifier(oi.product || oi.productId) || '');
              const reqColor = String(normalizeIdentifier(reqItem.colorId) || '');
              const reqSize = String(normalizeIdentifier(reqItem.sizeId) || '');
              const reqProd = String(normalizeIdentifier(reqItem.productId) || '');
              if (reqColor) {
                return oiColor === reqColor && (!reqSize || oiSize === reqSize);
              }
              return Boolean(reqProd && oiProd === reqProd);
            });
          }

          if (targetIdx < 0) {
            const err: any = new Error('Uno de los artículos seleccionados no pertenece al pedido.');
            err.status = 400;
            throw err;
          }

          const line = orderItems[targetIdx];
          const sold = Number(line.quantity || 0);
          const prevRet = Number(line.returnedQuantity || 0);
          const returnable = Math.max(0, Number((sold - prevRet).toFixed(3)));

          if (retQty > returnable + 0.0001) {
            const err: any = new Error(
              `Cantidad a devolver (${retQty}) excede las unidades disponibles (${returnable}) para "${line.productName || 'Producto'}".`,
            );
            err.status = 400;
            throw err;
          }

          line.returnedQuantity = Number((prevRet + retQty).toFixed(3));
          const unitPrice = Number(line.unitPrice ?? line.price ?? 0);
          computedCredit += unitPrice * retQty;

          const lineSizeId = normalizeIdentifier(line.size || line.sizeId) || null;
          movementItems.push({
            colorId: normalizeIdentifier(line.color || line.colorId) || null,
            ...(lineSizeId ? { sizeId: lineSizeId, sizeName: line.sizeName || null } : {}),
            productId: normalizeIdentifier(line.product || line.productId) || null,
            title: line.productName || line.title || 'Producto',
            colorName: line.colorName || line.selectedColor || 'N/A',
            quantity: retQty,
          });
        }

        let dispatchWarehouse = order.dispatchWarehouse?.id || normalizeIdentifier(order.dispatchWarehouse);
        if (!dispatchWarehouse) {
          const mainWh = await dbQuery('api::warehouse.warehouse').findOne({
            where: { code: 'MAIN' },
            select: ['id'],
            transacting: trx,
          });
          dispatchWarehouse = mainWh?.id || null;
        }

        const totalReturnedNow = movementItems.reduce((sum, it) => sum + Number(it.quantity || 0), 0);
        const reasonSuffix = payload.reason?.trim() ? ` — ${payload.reason.trim()}` : '';

        await dbQuery('api::inventory-movement.inventory-movement').create({
          data: {
            type: 'IN',
            reason: `Devolución parcial Pedido #${order.documentId || order.id}${reasonSuffix}`,
            order: order.id,
            items: movementItems,
            quantity: totalReturnedNow,
            date: new Date().toISOString(),
            performedBy: user?.id || order.performedBy?.id || null,
            exchangeRate: order.exchangeRate || 1,
            warehouse: dispatchWarehouse || null,
          },
          transacting: trx,
        });

        const currentTotal = Number(order.orderTotal || 0);
        const creditApplied =
          payload.refundAmount !== undefined && !Number.isNaN(Number(payload.refundAmount))
            ? Math.min(currentTotal, Math.max(0, Number(payload.refundAmount)))
            : Math.min(currentTotal, Number(computedCredit.toFixed(2)));

        const nextOrderTotal = Math.max(0, Number((currentTotal - creditApplied).toFixed(2)));
        const nextAmountPaid = Math.min(nextOrderTotal, Number(order.amountPaid || 0));

        const allReturned = orderItems.every(
          (it: any) => Number(it.quantity || 0) - Number(it.returnedQuantity || 0) <= 0.0001,
        );

        const dateTag = new Date().toISOString().split('T')[0];
        const noteEntry = `[Devolución ${dateTag}: ${totalReturnedNow} und / -$${creditApplied.toFixed(2)}${reasonSuffix}]`;
        const nextNotes = [order.notes, noteEntry].filter(Boolean).join('\n');

        await dbQuery('api::order.order').update({
          where: { id: order.id },
          data: {
            orderItems,
            orderTotal: nextOrderTotal,
            amountPaid: nextAmountPaid,
            orderStatus: allReturned ? 'returned' : currentStatus,
            notes: nextNotes,
          },
          transacting: trx,
        });

        const updatedOrder = await dbQuery('api::order.order').findOne({
          where: { id: order.id },
          populate: {
            dispatchWarehouse: true,
            customer: SAFE_USER_DB_POPULATE,
            performedBy: SAFE_USER_DB_POPULATE,
            referenceImage: true,
          },
          transacting: trx,
        });

        return {
          order: sanitizeEntityUserRelations(updatedOrder),
          returnedQuantity: totalReturnedNow,
          creditApplied,
          fullyReturned: allReturned,
        };
      });
    },

    async getOperationalAlerts(options: { canViewOrders: boolean; canViewProducts: boolean }) {
      const companySetting: any = await (strapi
        .documents('api::company-setting.company-setting' as any) as any)
        .findFirst()
        .catch(() => null);
      const ops = companySetting?.operationalSettings || {};

      const abandonedOrderHours = Number(ops.abandonedOrderHours ?? 24);
      const layawayWarningDays = Number(ops.layawayWarningDays ?? 20);
      const layawayExpiredDays = Number(ops.layawayExpiredDays ?? 30);
      const lowStockThreshold = Number(ops.lowStockThreshold ?? 5);

      const nowMs = Date.now();
      const abandonedOrders: any[] = [];
      const layawayAlerts: any[] = [];
      const lowStockVariants: any[] = [];
      let totalLowStockCount = 0;

      if (options.canViewOrders) {
        const orders: any[] = await strapi.documents('api::order.order').findMany({
          filters: {
            orderStatus: { $notIn: ['cancelled', 'returned'] },
          },
          sort: 'createdAt:desc',
          limit: 2000,
        });

        for (const o of orders) {
          const st = normalizeOrderStatus(o.orderStatus);
          const total = Number(o.orderTotal || 0);
          const paid = Number(o.amountPaid || 0);
          const records = Array.isArray(o.paymentRecords) ? o.paymentRecords : [];
          const refTime = new Date(o.orderPlaced || o.createdAt || nowMs).getTime();
          const elapsedHours = Math.max(0, Math.floor((nowMs - refTime) / 3600000));
          const elapsedDays = Math.max(0, Math.floor((nowMs - refTime) / 86400000));

          if (
            st === 'pending' &&
            paid <= 0 &&
            !o.paymentReference &&
            records.length === 0 &&
            elapsedHours >= abandonedOrderHours
          ) {
            abandonedOrders.push({
              id: o.id,
              documentId: o.documentId,
              slug: o.slug,
              clientName: o.clientName || 'Cliente Web',
              orderTotal: total,
              hoursElapsed: elapsedHours,
              createdAt: o.createdAt,
            });
          }

          const isLayaway =
            o.orderType === 'apartado' || o.orderType === 'credit' || o.orderType === 'cashea';
          const remaining = Number((total - paid).toFixed(2));
          if (isLayaway && remaining > 0.01 && elapsedDays >= layawayWarningDays) {
            layawayAlerts.push({
              id: o.id,
              documentId: o.documentId,
              clientName: o.clientName || 'Cliente',
              orderType: o.orderType,
              remaining,
              daysElapsed: elapsedDays,
              severity: elapsedDays >= layawayExpiredDays ? 'expired' : 'warning',
            });
          }
        }
      }

      if (options.canViewProducts) {
        const products: any[] = await strapi.documents('api::product.product').findMany({
          filters: { isActive: { $ne: false } },
          populate: { colors: true },
          limit: 5000,
        });

        for (const p of products) {
          const colors = Array.isArray(p.colors) ? p.colors : [];
          for (const c of colors) {
            const stock = Number(c.stock ?? 0);
            if (stock <= lowStockThreshold) {
              totalLowStockCount++;
              if (lowStockVariants.length < 15) {
                lowStockVariants.push({
                  productId: p.documentId || p.id,
                  colorId: c.documentId || c.id,
                  title: p.title,
                  colorName: c.name || 'Único',
                  code: c.code || p.productCode || '',
                  stock,
                });
              }
            }
          }
        }
      }

      const layawayExpiredCount = layawayAlerts.filter((a) => a.severity === 'expired').length;
      const layawayWarningCount = layawayAlerts.filter((a) => a.severity === 'warning').length;
      const totalAlerts = abandonedOrders.length + layawayAlerts.length + totalLowStockCount;

      return {
        summary: {
          totalAlerts,
          abandonedCount: abandonedOrders.length,
          layawayExpiredCount,
          layawayWarningCount,
          lowStockCount: totalLowStockCount,
        },
        thresholds: {
          abandonedOrderHours,
          layawayWarningDays,
          layawayExpiredDays,
          lowStockThreshold,
        },
        abandonedOrders: abandonedOrders.slice(0, 10),
        layawayAlerts: layawayAlerts.slice(0, 10),
        lowStockVariants,
        companyEmail: companySetting?.email || '',
        commercialName: companySetting?.commercialName || 'Tienda Online',
        generatedAt: new Date().toISOString(),
      };
    },

    /**
     * Crea una orden pública desde el storefront validando catálogo, stock (almacén web o global)
     * y precios/descuentos exclusivamente en el servidor.
     */
    async createPublicOrderTransaction(rawPayload: any, customerUser?: any) {
      const publicUtils = require('../utils/publicOrder');
      const orderData = rawPayload?.data?.orderData || rawPayload?.orderData || rawPayload?.data || rawPayload || {};
      const items = Array.isArray(orderData.orderItems) ? orderData.orderItems : [];

      if (items.length === 0) {
        const err: any = new Error('La orden debe contener al menos un producto');
        err.status = 400;
        throw err;
      }

      const clientName = String(orderData.clientName || orderData.name || '').trim();
      const phone = String(orderData.phone || '').trim();
      const method = String(orderData.method || '').trim();
      const deliveryMethod = String(orderData.deliveryMethod || '').trim();
      const adress = String(orderData.adress || orderData.address || '').trim();
      const city = String(orderData.city || '').trim();
      const state = String(orderData.state || '').trim();
      const option = String(orderData.option || '').trim();
      const email = String(orderData.email || '').trim();

      if (clientName.length < 2) {
        const err: any = new Error('El nombre completo es requerido');
        err.status = 400;
        throw err;
      }
      if (publicUtils.normalizePhoneDigits(phone).length < 7) {
        const err: any = new Error('Ingresa un número de teléfono válido');
        err.status = 400;
        throw err;
      }
      if (!publicUtils.isValidPublicMethod(method)) {
        const err: any = new Error('Método de pago no permitido');
        err.status = 400;
        throw err;
      }
      if (!publicUtils.isValidDeliveryMethod(deliveryMethod)) {
        const err: any = new Error('Método de envío no permitido');
        err.status = 400;
        throw err;
      }
      if (deliveryMethod === 'envio' && (!state || !city || !option || !adress)) {
        const err: any = new Error('Completa estado, ciudad, empresa de envío y dirección');
        err.status = 400;
        throw err;
      }

      const companySetting = await (strapi.documents('api::company-setting.company-setting' as any) as any)
        .findFirst()
        .catch(() => null);
      const configuredWebWhId = companySetting?.logisticsSettings?.webWarehouseId || null;

      let resolvedWarehouse: any = null;
      if (configuredWebWhId) {
        const whFilter = /^\d+$/.test(String(configuredWebWhId))
          ? { id: Number(configuredWebWhId) }
          : { documentId: String(configuredWebWhId) };
        const foundWh = await strapi.db.query('api::warehouse.warehouse').findOne({
          where: whFilter,
        });
        if (foundWh && foundWh.isActive !== false) {
          resolvedWarehouse = foundWh;
        }
      }

      const productLookupKeys: string[] = Array.from(
        new Set<string>(
          items.map((item: any) => String(item.productId || item.id || '').trim()).filter(Boolean),
        ),
      );
      if (productLookupKeys.length === 0) {
        const err: any = new Error('Faltan identificadores de producto');
        err.status = 400;
        throw err;
      }

      const numericProductIds = productLookupKeys.filter((k) => /^\d+$/.test(k)).map((k) => Number(k));
      const docProductIds = productLookupKeys.filter((k) => !/^\d+$/.test(k));
      const productOr: any[] = [];
      if (numericProductIds.length > 0) productOr.push({ id: { $in: numericProductIds } });
      if (docProductIds.length > 0) productOr.push({ documentId: { $in: docProductIds } });

      const dbProducts: any[] = await strapi.db.query('api::product.product').findMany({
        where: { $or: productOr },
        populate: { colors: { populate: ['sizes'] }, categories: true },
      });

      const productByKey = new Map<string, any>();
      for (const p of dbProducts) {
        if (p.id != null) productByKey.set(String(p.id), p);
        if (p.documentId) productByKey.set(String(p.documentId), p);
      }

      const warehouseStockMap = new Map<string, number>();
      if (resolvedWarehouse) {
        const allColorNumericIds: number[] = [];
        for (const p of dbProducts) {
          for (const c of Array.isArray(p.colors) ? p.colors : []) {
            if (c.id) allColorNumericIds.push(Number(c.id));
          }
        }
        if (allColorNumericIds.length > 0) {
          const whStocks: any[] = await strapi.db.query('api::warehouse-stock.warehouse-stock').findMany({
            where: {
              warehouse: resolvedWarehouse.id,
              color: { $in: allColorNumericIds },
            },
            populate: ['color', 'size'],
          });
          for (const ws of whStocks) {
            const cId = Number(ws.color?.id || ws.color);
            const sId = ws.size ? Number(ws.size?.id || ws.size) : null;
            if (cId) {
              const wsKey = `${cId}::${sId || 'BASE'}`;
              warehouseStockMap.set(wsKey, Number(ws.stock || 0));
            }
          }
        }
      }

      const verifiedItems: any[] = [];
      const requestedQtyByVariant = new Map<string, { qty: number; available: number; label: string }>();

      for (const rawItem of items) {
        const pKey = String(rawItem.productId || rawItem.id || '').trim();
        const product = productByKey.get(pKey);
        if (!product || product.isActive === false) {
          const err: any = new Error('Uno o más productos no están disponibles');
          err.status = 400;
          throw err;
        }

        const cKey = String(rawItem.colorId || '').trim();
        const productColors = Array.isArray(product.colors) ? product.colors : [];
        const matchedColor =
          productColors.find((c: any) => String(c.documentId) === cKey || String(c.id) === cKey) ||
          (productColors.length === 1 && !cKey ? productColors[0] : null);

        if (!matchedColor) {
          const err: any = new Error(`Variante no encontrada para ${product.title}`);
          err.status = 400;
          throw err;
        }

        const sKey = String(rawItem.sizeId || '').trim();
        const colorSizes = Array.isArray(matchedColor.sizes) ? matchedColor.sizes : [];
        let matchedSize: any = null;
        if (sKey) {
          matchedSize = colorSizes.find(
            (sz: any) => String(sz.documentId) === sKey || String(sz.id) === sKey,
          );
          if (!matchedSize) {
            const err: any = new Error(`Talla no encontrada para ${product.title} (${matchedColor.name || 'Único'})`);
            err.status = 400;
            throw err;
          }
        } else if (colorSizes.length > 0) {
          const err: any = new Error(`Debes seleccionar una talla para ${product.title} (${matchedColor.name || 'Único'})`);
          err.status = 400;
          throw err;
        }

        const quantity = Number(rawItem.quantity);
        if (!Number.isFinite(quantity) || quantity < 0.01) {
          const err: any = new Error(`Cantidad inválida para ${product.title}`);
          err.status = 400;
          throw err;
        }

        const variantKey = `${Number(matchedColor.id)}::${matchedSize ? Number(matchedSize.id) : 'BASE'}`;
        const availableStock = resolvedWarehouse
          ? Number(warehouseStockMap.get(variantKey) ?? 0)
          : Number((matchedSize ? matchedSize.stock : matchedColor.stock) ?? 0);

        const variantLabel = `${product.title} (${matchedColor.name || 'Único'}${matchedSize ? ` · ${matchedSize.name}` : ''})`;
        const prevEntry = requestedQtyByVariant.get(variantKey);
        const cumulativeQty = Number(((prevEntry?.qty || 0) + quantity).toFixed(4));
        requestedQtyByVariant.set(variantKey, {
          qty: cumulativeQty,
          available: availableStock,
          label: variantLabel,
        });

        if (cumulativeQty > availableStock) {
          const err: any = new Error(
            `Stock insuficiente para ${variantLabel}. Disponible: ${availableStock}`,
          );
          err.status = 400;
          throw err;
        }

        const basePrice = publicUtils.getEffectiveVariantPrice(product, matchedSize, 'detal');
        const discountPct = publicUtils.calculateEffectiveDiscountPct(product, matchedColor, matchedSize);
        const unitPrice = Number((basePrice * (1 - discountPct / 100)).toFixed(2));
        const unitCost = Number((matchedSize?.costPrice ?? product.costPrice) || 0);

        verifiedItems.push({
          productId: product.id,
          colorId: matchedColor.documentId || matchedColor.id,
          ...(matchedSize ? { sizeId: matchedSize.documentId || matchedSize.id, sizeName: matchedSize.name } : {}),
          quantity,
          unitPrice,
          unitCost,
          title: product.title,
          productName: product.title,
          selectedColor: matchedColor.name || 'Único',
          colorName: matchedColor.name || 'Único',
          productImage: rawItem.productImage || null,
        });
      }

      const serverOrderTotal = Number(
        verifiedItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0).toFixed(2),
      );

      let safeSlug = String(orderData.slug || '').trim();
      if (!/^[a-zA-Z0-9_-]{8,80}$/.test(safeSlug)) {
        safeSlug = crypto.randomUUID();
      } else {
        const collision = await strapi.db.query('api::order.order').findOne({
          where: { slug: safeSlug },
          select: ['id'],
        });
        if (collision) {
          safeSlug = crypto.randomUUID();
        }
      }

      const savedOrder = await this.processOrderTransaction({
        slug: safeSlug,
        clientName,
        phone,
        email: email || undefined,
        adress,
        city,
        state,
        deliveryMethod,
        option,
        method,
        orderType: method === 'cashea' ? 'cashea' : 'regular',
        orderStatus: 'pending',
        orderTotal: serverOrderTotal,
        amountPaid: 0,
        payments: [],
        dispatchWarehouse: resolvedWarehouse ? resolvedWarehouse.documentId || resolvedWarehouse.id : undefined,
        customer: customerUser?.id || undefined,
        orderItems: verifiedItems,
      });

      return publicUtils.sanitizePublicOrder(savedOrder, { includeCustomerPii: false });
    },

    /**
     * Consulta pública sanitizada por slug o documentId para página de estado de pago (/order/[slug]).
     */
    async findPublicOrderBySlug(identifier: string) {
      const publicUtils = require('../utils/publicOrder');
      const clean = String(identifier || '').trim();
      if (!clean) return null;

      const order = await strapi.db.query('api::order.order').findOne({
        where: {
          $or: [{ slug: clean }, { documentId: clean }],
        },
      });
      if (!order) return null;

      return publicUtils.sanitizePublicOrder(order, { includeCustomerPii: false });
    },

    /**
     * Seguimiento de pedido para invitados mediante código/slug y verificación de teléfono o correo.
     */
    async trackPublicOrder(slugOrIdentifier: string, verification: string) {
      const publicUtils = require('../utils/publicOrder');
      const cleanCode = String(slugOrIdentifier || '').trim().replace(/^#/, '');
      const cleanVerification = String(verification || '').trim();

      if (!cleanCode || !cleanVerification) {
        const err: any = new Error('Ingresa el código de pedido y tu teléfono o correo');
        err.status = 400;
        throw err;
      }

      const orFilters: any[] = [{ slug: cleanCode }, { documentId: cleanCode }];
      if (/^\d+$/.test(cleanCode)) {
        orFilters.push({ id: Number(cleanCode) });
      }

      const candidates: any[] = await strapi.db.query('api::order.order').findMany({
        where: { $or: orFilters },
        limit: 5,
      });

      const matched = candidates.find((candidate) =>
        publicUtils.matchesOrderVerification(candidate, cleanVerification),
      );

      if (!matched) {
        const err: any = new Error('No encontramos un pedido que coincida con esos datos');
        err.status = 404;
        throw err;
      }

      return publicUtils.sanitizePublicOrder(matched, { includeCustomerPii: true });
    },

    /**
     * Retorna el historial de órdenes perteneciente al cliente autenticado.
     */
    async findMyCustomerOrders(userId: number) {
      const publicUtils = require('../utils/publicOrder');
      const orders: any[] = await strapi.documents('api::order.order').findMany({
        filters: { customer: { id: userId } } as any,
        sort: 'createdAt:desc',
        limit: 200,
      });

      return orders.map((order) => publicUtils.sanitizePublicOrder(order, { includeCustomerPii: true }));
    },

    /**
     * Registra comprobante y referencia de pago del cliente solo mientras el pedido sea pagable.
     */
    async submitPublicOrderPayment(
      identifier: string,
      payload: { paymentReference?: string; referenceImage?: any },
    ) {
      const publicUtils = require('../utils/publicOrder');
      const clean = String(identifier || '').trim();
      const paymentReference = String(payload?.paymentReference || '').trim();

      if (!clean || paymentReference.length < 4) {
        const err: any = new Error('Número de referencia inválido');
        err.status = 400;
        throw err;
      }

      const existing = await strapi.db.query('api::order.order').findOne({
        where: {
          $or: [{ slug: clean }, { documentId: clean }],
        },
      });
      if (!existing) {
        const err: any = new Error('Orden no encontrada');
        err.status = 404;
        throw err;
      }

      if (!publicUtils.isPayablePublicStatus(existing.orderStatus)) {
        const err: any = new Error('Este pedido ya no admite envío de comprobante en su estado actual');
        err.status = 400;
        throw err;
      }

      let referenceImageId: number | null = null;
      const rawImg = payload?.referenceImage;
      if (rawImg !== undefined && rawImg !== null && rawImg !== '') {
        const fileFilter = /^\d+$/.test(String(rawImg))
          ? { id: Number(rawImg) }
          : { documentId: String(rawImg) };
        const fileRow = await strapi.db.query('plugin::upload.file').findOne({
          where: fileFilter,
          select: ['id', 'mime'],
        });
        if (!fileRow || !String(fileRow.mime || '').toLowerCase().startsWith('image/')) {
          const err: any = new Error('Comprobante de imagen inválido');
          err.status = 400;
          throw err;
        }
        const alreadyUsed = await strapi.db.query('api::order.order').findOne({
          where: {
            referenceImage: fileRow.id,
            id: { $ne: existing.id },
          },
          select: ['id'],
        });
        if (alreadyUsed) {
          const err: any = new Error('Este archivo ya está asociado a otro pedido');
          err.status = 400;
          throw err;
        }
        referenceImageId = fileRow.id;
      }

      const updated = await strapi.documents('api::order.order').update({
        documentId: existing.documentId,
        data: {
          paymentReference,
          orderStatus: 'pending_verification',
          ...(referenceImageId ? { referenceImage: referenceImageId } : {}),
        } as any,
      });

      return publicUtils.sanitizePublicOrder(updated, { includeCustomerPii: false });
    },
  };
});
