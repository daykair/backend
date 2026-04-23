/**
 * order controller
 */

import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::order.order', ({ strapi }) => ({
  async findAdmin(ctx) {
    try {
      // strapi.documents bypasses the default API sanitization, so private fields are kept.
      const orders = await strapi.documents('api::order.order').findMany({
        populate: '*',
        sort: 'createdAt:desc',
      });
      
      return ctx.send({ data: orders });
    } catch (err) {
      ctx.body = err;
    }
  }
}));
