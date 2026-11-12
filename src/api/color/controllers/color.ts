/**
 * color controller
 */

import { factories } from '@strapi/strapi';
import { createAdminCrudHandlers, resolveEntityDocumentId } from '../../../utils/adminCrud';

export default factories.createCoreController('api::color.color', ({ strapi }) => {
    const crud = createAdminCrudHandlers(strapi, 'api::color.color', {
        defaultPopulate: ['images', 'colorImage', 'product', 'warehouse_stocks'],
    });

    return {
        ...crud,
        async deleteAdmin(ctx) {
            const docId = await resolveEntityDocumentId(strapi, 'api::color.color', ctx.params?.id);
            if (!docId) return ctx.notFound('Variante no encontrada');

            const whStocks: any[] = await strapi
                .documents('api::warehouse-stock.warehouse-stock')
                .findMany({
                    filters: { color: { documentId: docId } } as any,
                    limit: 500,
                });

            for (const ws of whStocks) {
                if (ws?.documentId) {
                    await strapi
                        .documents('api::warehouse-stock.warehouse-stock')
                        .delete({ documentId: ws.documentId })
                        .catch((err) => console.error('[color.deleteAdmin] Error cleaning warehouse-stock:', err));
                }
            }

            return crud.deleteAdmin(ctx);
        },
    };
});
