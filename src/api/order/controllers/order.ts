/**
 * order controller
 */

import { factories } from '@strapi/strapi';
import * as yup from 'yup';

const orderLineItemSchema = yup.object({
  productId: yup.mixed().required(),
  colorId: yup.mixed().nullable().optional(),
  quantity: yup.number().required().min(1),
  unitPrice: yup.number().required().min(0),
  unitCost: yup.number().optional().min(0),
  productName: yup.string().optional(),
  title: yup.string().optional(),
  colorName: yup.string().optional(),
  selectedColor: yup.string().optional(),
  productImage: yup.string().nullable().optional(),
  priceType: yup.string().nullable().optional(),
});

const orderItemArray = yup.array().of(orderLineItemSchema).min(1);

const orderRequestSchema = yup.object({
  data: yup
    .object({
      orderData: yup
        .object({
          id: yup.number().integer().positive().optional(),
          documentId: yup.string().optional(),
          slug: yup.string().optional(),
          adress: yup.string().nullable().optional(),
          city: yup.string().nullable().optional(),
          state: yup.string().nullable().optional(),
          deliveryMethod: yup.string().nullable().optional(),
          email: yup.string().nullable().optional(),
          method: yup.string().nullable().optional(),
          option: yup.string().nullable().optional(),
          phone: yup.string().nullable().optional(),
          orderStatus: yup.string().required(),
          orderPlaced: yup.date().optional(),
          orderTotal: yup.number().when(['id', 'documentId'], {
            is: (id: any, documentId: any) => !id && !documentId,
            then: (schema) => schema.required(),
            otherwise: (schema) => schema.optional(),
          }),
          clientName: yup.string().nullable().optional(),
          paymentReference: yup.string().nullable().optional(),
          trackingNumber: yup.string().nullable().optional(),
          orderType: yup.string().optional(),
          amountPaid: yup.number().optional(),
          performedBy: yup.mixed().nullable().optional(),
          customer: yup.mixed().nullable().optional(),
          exchangeRate: yup.number().nullable().optional(),
          shippingCost: yup.number().nullable().optional(),
          dispatchWarehouse: yup.mixed().nullable().optional(),
          items: orderItemArray.optional(),
          order: orderItemArray.optional(),
          orderItems: orderItemArray.optional(),
          payments: yup
            .array()
            .of(
              yup.object({
                amount: yup.number().required().min(0),
                method: yup.string().required(),
                reference: yup.string().optional(),
                currency: yup.string().optional(),
                status: yup.string().optional(),
                date: yup.string().optional(),
              }),
            )
            .optional(),
        })
        .required()
        .test(
          'has-items',
          'Se requiere al menos un item de orden en items, order o orderItems al crear un pedido',
          (value) => {
            if (!value) return false;
            const hasItems =
              Array.isArray(value.items) ||
              Array.isArray(value.order) ||
              Array.isArray(value.orderItems);
            const isExistingOrder = value.id !== undefined || value.documentId !== undefined;
            return isExistingOrder || hasItems;
          },
        ),
    })
    .required(),
});

export default factories.createCoreController('api::order.order', ({ strapi }) => ({
  async findAdmin(ctx) {
    try {
      const orders = await strapi.documents('api::order.order').findMany({
        ...ctx.query,
        populate: {
          ...((ctx.query.populate as any) || {}),
          performedBy: true,
          dispatchWarehouse: true,
          customer: true,
          referenceImage: true,
        },
      });

      return ctx.send({ data: orders });
    } catch (err) {
      ctx.body = err;
    }
  },

  async processOrderFull(ctx) {
    try {
      const payload = await orderRequestSchema.validate(ctx.request.body, {
        abortEarly: false,
        stripUnknown: true,
      });

      const result = await strapi
        .service('api::order.order')
        .processOrderTransaction(payload.data.orderData);
      return ctx.send({ data: result });
    } catch (err: any) {
      if (err.name === 'ValidationError') {
        ctx.throw(400, err.errors.join(', '));
      }

      console.error('[OrderProcess] Error en processOrderFull:', err);
      ctx.throw(500, err.message || 'Error al procesar el pedido');
    }
  },

  async addPayment(ctx) {
    try {
      const { id } = ctx.params;
      const { amount, method, reference, status } = ctx.request.body.data || ctx.request.body;

      if (!amount || !method) {
        return ctx.throw(400, 'Monto y método son requeridos para un abono');
      }

      const filters = !isNaN(Number(id)) ? { id: Number(id) } : { documentId: String(id) };

      const orderList = await strapi.documents('api::order.order').findMany({
        filters,
        populate: ['customer', 'performedBy', 'dispatchWarehouse', 'referenceImage'],
      });
      const order = orderList && orderList.length > 0 ? orderList[0] : null;

      if (!order) {
        return ctx.throw(404, 'Orden no encontrada');
      }

      const paymentRecords = Array.isArray(order.paymentRecords) ? [...order.paymentRecords] : [];
      paymentRecords.push({
        amount: Number(amount),
        method,
        reference: reference || '',
        status: status || 'confirmed',
        date: new Date().toISOString(),
      });

      const newAmountPaid = (Number(order.amountPaid) || 0) + Number(amount);
      const isFullyPaid = newAmountPaid >= (Number(order.orderTotal) || 0);

      const updateData: any = {
        paymentRecords,
        amountPaid: newAmountPaid,
      };

      if (
        isFullyPaid &&
        order.orderStatus !== 'payment_confirmed' &&
        order.orderStatus !== 'delivered'
      ) {
        updateData.orderStatus = 'payment_confirmed';
      }

      const updatedOrder = await strapi.documents('api::order.order').update({
        documentId: order.documentId,
        data: updateData,
        populate: ['customer', 'performedBy', 'dispatchWarehouse', 'referenceImage'],
      });

      return ctx.send({ data: updatedOrder });
    } catch (err: any) {
      console.error('[OrderProcess] Error en addPayment:', err);
      ctx.throw(500, err.message || 'Error al registrar el abono');
    }
  },

  /**
   * Webhook / Callback endpoint for Cashea confirmation.
   * Ready to receive confirmations from Cashea or internal checkout verification once API keys are configured.
   */
  async casheaWebhook(ctx) {
    try {
      const configuredSecret = process.env.CASHEA_PRIVATE_API_KEY || process.env.CASHEA_WEBHOOK_SECRET;
      const authHeader = ctx.request.headers['authorization'] || ctx.request.headers['x-cashea-signature'];

      if (configuredSecret && authHeader) {
        const cleanHeader = String(authHeader).replace(/^ApiKey\s+/i, '').replace(/^Bearer\s+/i, '').trim();
        if (cleanHeader !== configuredSecret) {
          return ctx.unauthorized('Invalid Cashea API Key or signature');
        }
      }

      const body = ctx.request.body?.data || ctx.request.body || {};
      const orderIdentifier = body.orderId || body.slug || body.documentId || body.externalOrderId;
      const casheaReference = body.casheaOrderId || body.reference || body.idNumber || '';
      const initialPaid = Number(body.initialAmount ?? body.downPayment ?? body.amountPaid ?? 0);
      const status = body.status || 'APPROVED';

      if (!orderIdentifier) {
        return ctx.badRequest('orderId / documentId es requerido');
      }

      const orderList = await strapi.documents('api::order.order').findMany({
        filters: {
          $or: [
            { documentId: String(orderIdentifier) },
            { slug: String(orderIdentifier) },
            ...(!isNaN(Number(orderIdentifier)) ? [{ id: Number(orderIdentifier) }] : []),
          ],
        } as any,
      });

      const existing = orderList?.[0];
      if (!existing) {
        return ctx.notFound('Orden no encontrada para confirmación de Cashea');
      }

      const isApproved = ['APPROVED', 'CONFIRMED', 'COMPLETED', 'PAID', 'payment_confirmed'].includes(
        String(status).toUpperCase(),
      );

      if (!isApproved) {
        const failed = await strapi.service('api::order.order').processOrderTransaction({
          documentId: existing.documentId,
          orderStatus: 'failed_verification',
          paymentReference: String(casheaReference || existing.paymentReference || ''),
        });
        return ctx.send({ data: failed });
      }

      const effectiveInitial =
        initialPaid > 0
          ? initialPaid
          : Number(existing.amountPaid) > 0
          ? Number(existing.amountPaid)
          : Number(((Number(existing.orderTotal) || 0) * 0.4).toFixed(2));

      const existingPayments = Array.isArray(existing.paymentRecords) ? existing.paymentRecords : [];
      const updatedPayments =
        existingPayments.length > 0
          ? existingPayments
          : [
              {
                amount: effectiveInitial,
                method: 'Cashea (Inicial)',
                reference: String(casheaReference || existing.paymentReference || 'CASHEA'),
                status: 'confirmed',
                date: new Date().toISOString(),
              },
            ];

      const updated = await strapi.service('api::order.order').processOrderTransaction({
        documentId: existing.documentId,
        orderType: 'cashea',
        method: 'Cashea',
        orderStatus: 'payment_confirmed',
        amountPaid: effectiveInitial,
        paymentReference: String(casheaReference || existing.paymentReference || ''),
        orderItems: Array.isArray(existing.orderItems) ? existing.orderItems : [],
        payments: updatedPayments,
      });

      return ctx.send({ data: updated });
    } catch (err: any) {
      console.error('[CasheaWebhook] Error:', err);
      ctx.throw(500, err.message || 'Error procesando confirmación de Cashea');
    }
  },

  /**
   * Liquidación en lote para múltiples órdenes (Cashea Express / Apartados / Crédito)
   */
  async batchSettle(ctx) {
    try {
      const body = ctx.request.body?.data || ctx.request.body || {};
      const orderIds: (string | number)[] = Array.isArray(body.orderIds) ? body.orderIds : [];
      const method = body.method || 'Cashea';
      const reference = body.reference || 'Liquidación en lote';

      if (orderIds.length === 0) {
        return ctx.badRequest('Debes seleccionar al menos una orden para liquidar');
      }

      const settledOrders: any[] = [];

      for (const rawId of orderIds) {
        const filters = !isNaN(Number(rawId))
          ? { id: Number(rawId) }
          : { documentId: String(rawId) };

        const orderList = await strapi.documents('api::order.order').findMany({
          filters,
        });
        const order = orderList?.[0];
        if (!order) continue;

        const orderTotal = Number(order.orderTotal) || 0;
        const amountPaid = Number(order.amountPaid) || 0;
        const remaining = Number((orderTotal - amountPaid).toFixed(2));
        if (remaining <= 0.01) continue;

        const paymentRecords = Array.isArray(order.paymentRecords)
          ? [...order.paymentRecords]
          : [];
        paymentRecords.push({
          amount: remaining,
          method,
          reference,
          status: 'confirmed',
          date: new Date().toISOString(),
        });

        const updateData: any = {
          paymentRecords,
          amountPaid: orderTotal,
        };

        if (
          order.orderStatus !== 'payment_confirmed' &&
          order.orderStatus !== 'delivered'
        ) {
          updateData.orderStatus = 'payment_confirmed';
        }

        const updated = await strapi.documents('api::order.order').update({
          documentId: order.documentId,
          data: updateData,
        });
        settledOrders.push(updated);
      }

      return ctx.send({
        data: settledOrders,
        settledCount: settledOrders.length,
      });
    } catch (err: any) {
      console.error('[BatchSettle] Error:', err);
      ctx.throw(500, err.message || 'Error al liquidar órdenes en lote');
    }
  },
}));
