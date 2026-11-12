import { factories } from '@strapi/strapi';
import { buildAdminFindParams } from '../../../utils/adminQuery';
import {
    extractPayloadData,
    mergePopulate,
    SAFE_USER_POPULATE,
    sanitizeEntityUserRelations,
} from '../../../utils/adminCrud';

export default factories.createCoreController('api::expense.expense', ({ strapi }) => ({
    async findAdmin(ctx) {
        try {
            const params = buildAdminFindParams(ctx.query);
            const populate = mergePopulate(
                ctx.query?.populate,
                { performedBy: SAFE_USER_POPULATE },
                ['performedBy'],
            );
            const expenses = await strapi.documents('api::expense.expense').findMany({
                ...params,
                populate,
            });
            return ctx.send({ data: sanitizeEntityUserRelations(expenses) });
        } catch (err: any) {
            console.error('[Expense findAdmin Error]:', err);
            return ctx.internalServerError(err?.message || 'Error al obtener gastos');
        }
    },
    async createAdmin(ctx) {
        try {
            const data = extractPayloadData(ctx.request.body);
            const { id: _id, documentId: _docId, ...safeData } = data;
            // Set performedBy if available from middleware
            if (ctx.state.user && !safeData.performedBy) {
                safeData.performedBy = ctx.state.user.id;
            }

            const expense = await strapi.documents('api::expense.expense').create({
                data: safeData as any,
                populate: { performedBy: SAFE_USER_POPULATE } as any,
            });
            return ctx.send({ data: sanitizeEntityUserRelations(expense) });
        } catch (err: any) {
            console.error('[Expense createAdmin Error]:', err);
            return ctx.badRequest(err?.message || 'Error al crear gasto');
        }
    },
    async updateAdmin(ctx) {
        try {
            const data = extractPayloadData(ctx.request.body);
            const { id: _id, documentId: _docId, ...safeData } = data;
            const expense = await strapi.documents('api::expense.expense').update({
                documentId: ctx.params.id,
                data: safeData as any,
                populate: { performedBy: SAFE_USER_POPULATE } as any,
            });
            return ctx.send({ data: sanitizeEntityUserRelations(expense) });
        } catch (err: any) {
            console.error('[Expense updateAdmin Error]:', err);
            return ctx.badRequest(err?.message || 'Error al actualizar gasto');
        }
    },
    async deleteAdmin(ctx) {
        try {
            const expense = await strapi.documents('api::expense.expense').delete({
                documentId: ctx.params.id
            });
            return ctx.send({ data: expense });
        } catch (err: any) {
            console.error('[Expense deleteAdmin Error]:', err);
            return ctx.badRequest(err?.message || 'Error al eliminar gasto');
        }
    }
}));
