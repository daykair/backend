/**
 * product controller
 */

import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::product.product', ({ strapi }) => ({
    // ... tus métodos existentes ...
    async findAdmin(ctx) {
        try {
            const products = await strapi.documents('api::product.product').findMany({
                ...ctx.query
            })

            return ctx.send({ data: products })
        } catch (err) {
            ctx.body = err;
        }
    },
    async findOneAdmin(ctx) {
        try {
            const product = await strapi.documents('api::product.product').findOne({
                documentId: ctx.params.id,
                ...ctx.query
            })
            return ctx.send({ data: product })
        } catch (err) {
            ctx.body = err;
        }
    }
}));
