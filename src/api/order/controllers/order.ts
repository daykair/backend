/**
 * order controller
 */

import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::order.order', ({ strapi }) => ({
  async findAdmin(ctx) {
        try {
            const orders = await strapi.documents('api::order.order').findMany({
                ...ctx.query
            })

            return ctx.send({ data: orders })
        } catch (err) {
            ctx.body = err;
        }
    },
}));
