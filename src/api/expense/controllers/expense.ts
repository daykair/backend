import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::expense.expense', ({ strapi }) => ({
    async findAdmin(ctx) {
        try {
            const expenses = await strapi.documents('api::expense.expense').findMany({
                ...ctx.query
            });
            return ctx.send({ data: expenses });
        } catch (err) {
            ctx.body = err;
        }
    },
    async createAdmin(ctx) {
        try {
            const expense = await strapi.documents('api::expense.expense').create({
                ...ctx.request.body
            });
            return ctx.send({ data: expense });
        } catch (err) {
            ctx.body = err;
        }
    },
    async updateAdmin(ctx) {
        try {
            const expense = await strapi.documents('api::expense.expense').update({
                documentId: ctx.params.id,
                ...ctx.request.body
            });
            return ctx.send({ data: expense });
        } catch (err) {
            ctx.body = err;
        }
    },
    async deleteAdmin(ctx) {
        try {
            const expense = await strapi.documents('api::expense.expense').delete({
                documentId: ctx.params.id
            });
            return ctx.send({ data: expense });
        } catch (err) {
            ctx.body = err;
        }
    }
}));
