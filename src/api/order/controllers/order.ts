/**
 * order controller
 */

import { factories } from '@strapi/strapi'
import * as yup from 'yup'

const orderLineItemSchema = yup.object({
  productId: yup.mixed().required(),
  colorId: yup.mixed().optional(),
  quantity: yup.number().required().min(1),
  unitPrice: yup.number().required().min(0),
  unitCost: yup.number().optional().min(0),
  productName: yup.string().optional(),
  title: yup.string().optional(),
  colorName: yup.string().optional(),
  selectedColor: yup.string().optional(),
})

const orderItemArray = yup.array().of(orderLineItemSchema).min(1)

const orderRequestSchema = yup.object({
  data: yup.object({
    orderData: yup
      .object({
        id: yup.number().integer().positive().optional(),
        documentId: yup.string().optional(),
        slug: yup.string().optional(),
        adress: yup.string().optional(),
        city: yup.string().optional(),
        deliveryMethod: yup.string().optional(),
        email: yup.string().optional(),
        method: yup.string().optional(),
        option: yup.string().optional(),
        phone: yup.string().optional(),
        orderStatus: yup.string().required(),
        orderPlaced: yup.date().optional(),
        orderTotal: yup.number().when(['id', 'documentId'], {
          is: (id: any, documentId: any) => !id && !documentId,
          then: (schema) => schema.required(),
          otherwise: (schema) => schema.optional(),
        }),
        clientName: yup.string().optional(),
        paymentReference: yup.string().optional(),
        orderType: yup.string().optional(),
        amountPaid: yup.number().optional(),
        performedBy: yup.mixed().optional(),
        customer: yup.mixed().optional(),
        exchangeRate: yup.number().optional(),
        shippingCost: yup.number().optional(),
        dispatchWarehouse: yup.mixed().optional(),
        items: orderItemArray.optional(),
        order: orderItemArray.optional(),
        orderItems: orderItemArray.optional(),
        payments: yup.array().of(
          yup.object({
            amount: yup.number().required().min(0),
            method: yup.string().required(),
            reference: yup.string().optional(),
            status: yup.string().optional(),
          })
        ).optional(),
      })
      .required()
      .test(
        'has-items',
        'Se requiere al menos un item de orden en items, order o orderItems al crear un pedido',
        (value) => {
          if (!value) return false;
          const hasItems = Array.isArray(value.items) || Array.isArray(value.order) || Array.isArray(value.orderItems);
          const isExistingOrder = value.id !== undefined || value.documentId !== undefined;
          return isExistingOrder || hasItems;
        }
      ),
  }).required(),
})

export default factories.createCoreController('api::order.order', ({ strapi }) => ({
  async findAdmin(ctx) {
    try {
      const orders = await strapi.documents('api::order.order').findMany({
        ...ctx.query,
        populate: {
          ...((ctx.query.populate as any) || {}),
          performedBy: true,
          orderItems: true,
          payments: true,
          dispatchWarehouse: true,
          customer: true,
        },
      })

      return ctx.send({ data: orders })
    } catch (err) {
      ctx.body = err
    }
  },

  async processOrderFull(ctx) {
    try {
      const payload = await orderRequestSchema.validate(ctx.request.body, {
        abortEarly: false,
        stripUnknown: true,
      })

      const result = await strapi.service('api::order.order').processOrderTransaction(payload.data.orderData)
      return ctx.send({ data: result })
    } catch (err: any) {
      if (err.name === 'ValidationError') {
        ctx.throw(400, err.errors.join(', '))
      }

      console.error('[OrderProcess] Error en processOrderFull:', err)
      ctx.throw(500, err.message || 'Error al procesar el pedido')
    }
  },
}))
