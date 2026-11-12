/**
 * order controller
 */

import { factories } from '@strapi/strapi';
import crypto from 'crypto';
import fs from 'fs';
import * as yup from 'yup';
import { buildAdminFindParams } from '../../../utils/adminQuery';
import {
  mergePopulate,
  SAFE_USER_DB_POPULATE,
  SAFE_USER_POPULATE,
  sanitizeEntityUserRelations,
  userHasExactPermission,
} from '../../../utils/adminCrud';
import {
  resolveCustomerFromContext,
  sendOrderStatusNotification,
  validatePublicOrderPayableAccess,
} from '../utils/publicOrder';

async function resolveCustomerUser(strapi: any, ctx: any) {
  return resolveCustomerFromContext(strapi, ctx);
}

const orderLineItemSchema = yup.object({
  productId: yup.mixed().required(),
  colorId: yup.mixed().nullable().optional(),
  sizeId: yup.mixed().nullable().optional(),
  sizeName: yup.string().nullable().optional(),
  quantity: yup.number().required().min(0.01),
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
          discount: yup.number().nullable().optional().min(0),
          notes: yup.string().nullable().optional(),
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
      const params = buildAdminFindParams(ctx.query);
      const defaultOrderPopulate = {
        performedBy: SAFE_USER_POPULATE,
        dispatchWarehouse: true,
        customer: SAFE_USER_POPULATE,
        referenceImage: true,
      };
      const populate = mergePopulate(
        ctx.query?.populate,
        defaultOrderPopulate,
        ['performedBy', 'dispatchWarehouse', 'customer', 'referenceImage'],
      );
      const orders = await strapi.documents('api::order.order').findMany({
        ...params,
        populate,
      });

      return ctx.send({ data: sanitizeEntityUserRelations(orders) });
    } catch (err: any) {
      console.error('[Order findAdmin] Error:', err);
      return ctx.internalServerError(err?.message || 'Error al obtener pedidos');
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
      const bodyPayload = ctx.request.body?.data || ctx.request.body || {};
      const { amount, method, reference, status } = bodyPayload;

      const parsedAmount = Number(amount);
      const cleanMethod = String(method || '').trim();
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || !cleanMethod) {
        return ctx.badRequest('Monto positivo y método son requeridos para un abono');
      }

      const idWhere = /^\d+$/.test(String(id)) ? { id: Number(id) } : { documentId: String(id) };
      const orderPopulate = {
        customer: SAFE_USER_POPULATE,
        performedBy: SAFE_USER_POPULATE,
        dispatchWarehouse: true,
        referenceImage: true,
      } as any;
      const txPopulate = {
        customer: SAFE_USER_DB_POPULATE,
        performedBy: SAFE_USER_DB_POPULATE,
        dispatchWarehouse: true,
        referenceImage: true,
      } as any;

      const outcome = await strapi.db.transaction(async (trx) => {
        const order = await (strapi.db as any).query('api::order.order').findOne({
          where: idWhere,
          populate: txPopulate,
          transacting: trx,
        });

        if (!order) {
          const notFoundErr: any = new Error('Orden no encontrada');
          notFoundErr.status = 404;
          throw notFoundErr;
        }

        const currentStatus = String(order.orderStatus || '').trim().toLowerCase();
        if (currentStatus === 'cancelled' || currentStatus === 'returned') {
          const badErr: any = new Error('No se pueden registrar abonos en una orden cancelada o devuelta.');
          badErr.status = 400;
          throw badErr;
        }

        const orderTotal = Number(order.orderTotal) || 0;
        const currentPaid = Number(order.amountPaid) || 0;
        if (orderTotal > 0 && currentPaid >= orderTotal - 0.01) {
          const paidErr: any = new Error('Esta orden ya se encuentra pagada en su totalidad.');
          paidErr.status = 400;
          throw paidErr;
        }

        const paymentRecords = Array.isArray(order.paymentRecords) ? [...order.paymentRecords] : [];
        paymentRecords.push({
          amount: Number(parsedAmount.toFixed(2)),
          method: cleanMethod,
          reference: reference || '',
          status: status || 'confirmed',
          date: new Date().toISOString(),
        });

        const newAmountPaid = Number((currentPaid + parsedAmount).toFixed(2));
        const isFullyPaid = newAmountPaid + 0.01 >= orderTotal;

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

        await (strapi.db as any).query('api::order.order').update({
          where: { id: order.id },
          data: updateData,
          transacting: trx,
        });

        const updatedOrder = await strapi.documents('api::order.order').findOne({
          documentId: order.documentId,
          populate: orderPopulate,
        });

        return {
          updatedOrder,
          previousStatus: order.orderStatus,
          confirmedNow: updateData.orderStatus === 'payment_confirmed',
        };
      });

      if (outcome.confirmedNow && outcome.updatedOrder) {
        void sendOrderStatusNotification(
          strapi,
          outcome.updatedOrder,
          'payment_confirmed',
          outcome.previousStatus,
        );
      }

      return ctx.send({ data: sanitizeEntityUserRelations(outcome.updatedOrder) });
    } catch (err: any) {
      const status = err?.status || err?.statusCode;
      if (status && status >= 400 && status < 500) {
        return ctx.throw(status, err.message || 'Solicitud de abono inválida');
      }
      console.error('[OrderProcess] Error en addPayment:', err);
      return ctx.internalServerError(err?.message || 'Error al registrar el abono');
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

      if (!configuredSecret) {
        return ctx.unauthorized('Cashea webhook secret is not configured');
      }

      if (!authHeader) {
        return ctx.unauthorized('Missing Cashea API Key or signature');
      }

      const cleanHeader = String(authHeader).replace(/^ApiKey\s+/i, '').replace(/^Bearer\s+/i, '').trim();
      const expectedDigest = crypto.createHash('sha256').update(configuredSecret).digest();
      const receivedDigest = crypto.createHash('sha256').update(cleanHeader).digest();
      if (!crypto.timingSafeEqual(expectedDigest, receivedDigest)) {
        return ctx.unauthorized('Invalid Cashea API Key or signature');
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
          ? Number(initialPaid.toFixed(2))
          : Number(existing.amountPaid) > 0
          ? Number(existing.amountPaid)
          : Number(((Number(existing.orderTotal) || 0) * 0.4).toFixed(2));

      const orderTotal = Number(existing.orderTotal || 0);
      const existingPayments: any[] = Array.isArray(existing.paymentRecords)
        ? existing.paymentRecords
        : [];
      const updatedPayments: any[] =
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

      const totalRecordedPaid = Number(
        updatedPayments
          .filter((p: any) => !p?.status || p.status === 'confirmed')
          .reduce((acc: number, p: any) => acc + (Number(p?.amount) || 0), 0)
          .toFixed(2),
      );
      const effectivePaidTotal = Math.max(effectiveInitial, totalRecordedPaid);
      const isFullyPaid = orderTotal > 0 ? effectivePaidTotal + 0.01 >= orderTotal : effectivePaidTotal > 0;
      const nextStatus =
        existing.orderStatus === 'delivered'
          ? 'delivered'
          : isFullyPaid
          ? 'payment_confirmed'
          : 'pending';

      const updated = await strapi.service('api::order.order').processOrderTransaction({
        documentId: existing.documentId,
        orderType: 'cashea',
        method: 'Cashea',
        orderStatus: nextStatus,
        amountPaid: effectivePaidTotal,
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
      const method = String(body.method || 'Cashea').trim() || 'Cashea';
      const reference = String(body.reference || 'Liquidación en lote').trim();

      if (orderIds.length === 0) {
        return ctx.badRequest('Debes seleccionar al menos una orden para liquidar');
      }

      const settledOutcome = await strapi.db.transaction(async (trx) => {
        const results: Array<{ updated: any; previousStatus: string; notify: boolean }> = [];

        for (const rawId of orderIds) {
          const idWhere = /^\d+$/.test(String(rawId))
            ? { id: Number(rawId) }
            : { documentId: String(rawId) };

          const order = await (strapi.db as any).query('api::order.order').findOne({
            where: idWhere,
            transacting: trx,
          });
          if (!order) continue;

          const currentStatus = String(order.orderStatus || '').trim().toLowerCase();
          if (currentStatus === 'cancelled' || currentStatus === 'returned') continue;

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
            amountPaid: Number(orderTotal.toFixed(2)),
          };

          const shouldConfirm =
            order.orderStatus !== 'payment_confirmed' &&
            order.orderStatus !== 'delivered';
          if (shouldConfirm) {
            updateData.orderStatus = 'payment_confirmed';
          }

          await (strapi.db as any).query('api::order.order').update({
            where: { id: order.id },
            data: updateData,
            transacting: trx,
          });

          const updated = await strapi.documents('api::order.order').findOne({
            documentId: order.documentId,
          });

          results.push({
            updated,
            previousStatus: order.orderStatus,
            notify: Boolean(shouldConfirm && updated),
          });
        }

        return results;
      });

      for (const entry of settledOutcome) {
        if (entry.notify) {
          void sendOrderStatusNotification(
            strapi,
            entry.updated,
            'payment_confirmed',
            entry.previousStatus,
          );
        }
      }

      const settledOrders = settledOutcome.map((entry) => entry.updated);
      return ctx.send({
        data: settledOrders,
        settledCount: settledOrders.length,
      });
    } catch (err: any) {
      console.error('[BatchSettle] Error:', err);
      ctx.throw(500, err.message || 'Error al liquidar órdenes en lote');
    }
  },

  /**
   * Analíticas y KPIs agregados en servidor (soporta daily, weekly, monthly, custom y warehouseId).
   */
  async analytics(ctx) {
    try {
      const user = ctx.state?.user;
      const [canViewOrders, canViewExpenses, canViewProducts] = await Promise.all([
        userHasExactPermission(strapi, user, 'api::order.order.find'),
        userHasExactPermission(strapi, user, 'api::expense.expense.find'),
        userHasExactPermission(strapi, user, 'api::product.product.find'),
      ]);

      const { period, from, to, warehouseId, lowStockThreshold } = (ctx.query || {}) as Record<string, string>;
      const validPeriod =
        period === 'daily' || period === 'weekly' || period === 'monthly' || period === 'custom'
          ? period
          : 'monthly';

      const summary = await strapi.service('api::order.order').getAnalyticsSummary({
        period: validPeriod,
        from,
        to,
        warehouseId,
        lowStockThreshold: lowStockThreshold !== undefined ? Number(lowStockThreshold) : undefined,
        canViewOrders,
        canViewExpenses,
        canViewProducts,
      });

      return ctx.send({ data: summary });
    } catch (err: any) {
      console.error('[OrderAnalytics] Error:', err);
      ctx.throw(500, err.message || 'Error calculando analíticas');
    }
  },

  /**
   * Procesa la devolución parcial (o remanente completo) de artículos de un pedido,
   * reingresando stock al almacén correspondiente y ajustando saldo sin anular ítems no devueltos.
   */
  async partialReturn(ctx) {
    try {
      const { id } = ctx.params;
      const body = ctx.request.body?.data || ctx.request.body || {};
      const result = await strapi
        .service('api::order.order')
        .processPartialReturn(id, body, ctx.state?.user);
      return ctx.send({ data: result });
    } catch (err: any) {
      console.error('[OrderPartialReturn] Error:', err);
      if (err?.status === 400) return ctx.badRequest(err.message);
      if (err?.status === 404) return ctx.notFound(err.message);
      ctx.throw(500, err.message || 'Error al procesar la devolución parcial');
    }
  },

  /**
   * Retorna alertas operativas consolidadas (pedidos abandonados, apartados por vencer, bajo stock).
   */
  async alerts(ctx) {
    try {
      const user = ctx.state?.user;
      const [canViewOrders, canViewProducts] = await Promise.all([
        userHasExactPermission(strapi, user, 'api::order.order.find'),
        userHasExactPermission(strapi, user, 'api::product.product.find'),
      ]);

      const data = await strapi.service('api::order.order').getOperationalAlerts({
        canViewOrders,
        canViewProducts,
      });

      return ctx.send({ data });
    } catch (err: any) {
      console.error('[OrderAlerts] Error:', err);
      ctx.throw(500, err.message || 'Error obteniendo alertas operativas');
    }
  },

  /**
   * Crea una orden pública validando precios, descuentos y disponibilidad en servidor.
   */
  async createPublicOrder(ctx) {
    try {
      const customerUser = await resolveCustomerUser(strapi, ctx);

      const data = await strapi
        .service('api::order.order')
        .createPublicOrderTransaction(ctx.request.body || {}, customerUser);
      return ctx.send({ data });
    } catch (err: any) {
      console.error('[CreatePublicOrder] Error:', err);
      if (err?.status === 400) return ctx.badRequest(err.message);
      ctx.throw(500, err.message || 'Error creando el pedido');
    }
  },

  /**
   * Consulta pública sanitizada de un pedido por slug o documentId.
   */
  async findPublicBySlug(ctx) {
    try {
      const { slug } = ctx.params;
      const data = await strapi.service('api::order.order').findPublicOrderBySlug(slug);
      if (!data) {
        return ctx.notFound('Orden no encontrada');
      }
      return ctx.send({ data });
    } catch (err: any) {
      console.error('[FindPublicBySlug] Error:', err);
      ctx.throw(500, err.message || 'Error consultando el pedido');
    }
  },

  /**
   * Rastreo público para invitados verificando código de pedido y teléfono o correo.
   */
  async trackPublicOrder(ctx) {
    try {
      const body = ctx.request.body?.data || ctx.request.body || {};
      const data = await strapi
        .service('api::order.order')
        .trackPublicOrder(body.slug || body.orderCode || body.code, body.verification);
      return ctx.send({ data });
    } catch (err: any) {
      if (err?.status === 400) return ctx.badRequest(err.message);
      if (err?.status === 404) return ctx.notFound(err.message);
      console.error('[TrackPublicOrder] Error:', err);
      ctx.throw(500, err.message || 'Error rastreando el pedido');
    }
  },

  /**
   * Historial de órdenes del cliente autenticado (portal Mis Pedidos).
   */
  async findMyOrders(ctx) {
    try {
      const user = await resolveCustomerUser(strapi, ctx);
      if (!user) {
        return ctx.unauthorized('Debes iniciar sesión para ver tus pedidos');
      }

      const data = await strapi.service('api::order.order').findMyCustomerOrders(user.id);
      return ctx.send({ data });
    } catch (err: any) {
      console.error('[FindMyOrders] Error:', err);
      ctx.throw(500, err.message || 'Error obteniendo tus pedidos');
    }
  },

  /**
   * Sube de forma segura el comprobante de pago validando estado pagable, propietario, MIME y tamaño.
   */
  async uploadPublicPaymentProof(ctx, next) {
    try {
      const { slug } = ctx.params;
      await validatePublicOrderPayableAccess(strapi, slug, ctx);

      const rawFiles = ctx.request.files?.files ?? ctx.request.files?.file;
      const candidateList = Array.isArray(rawFiles) ? rawFiles : rawFiles ? [rawFiles] : [];
      const cleanupTempFiles = async () => {
        for (const f of candidateList) {
          if (f?.filepath) {
            await fs.promises.unlink(f.filepath).catch(() => {});
          }
        }
      };

      if (candidateList.length !== 1) {
        await cleanupTempFiles();
        return ctx.badRequest('Debes adjuntar exactamente una imagen de comprobante.');
      }

      const file: any = candidateList[0];
      const mime = String(file?.mimetype || file?.type || '').toLowerCase();
      const size = Number(file?.size || 0);
      const allowedMimes = new Set(['image/jpeg', 'image/png', 'image/webp']);
      const maxProofBytes = 5 * 1024 * 1024;

      if (!allowedMimes.has(mime)) {
        await cleanupTempFiles();
        return ctx.badRequest('Formato inválido. Solo se permiten imágenes JPG, PNG o WebP.');
      }
      if (!Number.isFinite(size) || size <= 0 || size > maxProofBytes) {
        await cleanupTempFiles();
        return ctx.badRequest('El comprobante debe pesar entre 1 byte y 5 MB.');
      }

      ctx.request.body = {};
      ctx.request.files = { files: file };

      await (strapi.plugin('upload').controller('content-api') as any).upload(ctx, next);
      const uploaded = Array.isArray(ctx.body) ? ctx.body[0] : ctx.body;
      if (!uploaded?.id) {
        return ctx.internalServerError('No se pudo procesar la subida del comprobante.');
      }

      return ctx.send({
        data: {
          id: uploaded.id,
          documentId: uploaded.documentId,
          url: uploaded.url,
          name: uploaded.name,
          mime: uploaded.mime,
          size: uploaded.size,
        },
      });
    } catch (err: any) {
      if (err?.status === 400) return ctx.badRequest(err.message);
      if (err?.status === 403) return ctx.forbidden(err.message);
      if (err?.status === 404) return ctx.notFound(err.message);
      console.error('[UploadPublicPaymentProof] Error:', err);
      return ctx.internalServerError('Error subiendo el comprobante de pago.');
    }
  },

  /**
   * Recibe referencia e imagen de pago del cliente para órdenes pendientes.
   */
  async submitPublicPayment(ctx) {
    try {
      const { slug } = ctx.params;
      await validatePublicOrderPayableAccess(strapi, slug, ctx);
      const body = ctx.request.body?.data || ctx.request.body || {};
      const data = await strapi.service('api::order.order').submitPublicOrderPayment(slug, {
        paymentReference: body.paymentReference,
        referenceImage: body.referenceImage,
      });
      return ctx.send({ data });
    } catch (err: any) {
      if (err?.status === 400) return ctx.badRequest(err.message);
      if (err?.status === 403) return ctx.forbidden(err.message);
      if (err?.status === 404) return ctx.notFound(err.message);
      console.error('[SubmitPublicPayment] Error:', err);
      ctx.throw(500, err.message || 'Error enviando el comprobante');
    }
  },
}));
