import { factories } from '@strapi/strapi';
import { createAdminCrudHandlers, resolveEntityDocumentId } from '../../../utils/adminCrud';

export default factories.createCoreController('api::size.size' as any, ({ strapi }) => {
  const crud = createAdminCrudHandlers(strapi, 'api::size.size', {
    defaultPopulate: ['color', 'warehouse_stocks'],
    allowedPopulateKeys: ['color', 'warehouse_stocks', 'inventory_movements'],
  });

  return {
    ...crud,
    async deleteAdmin(ctx) {
      const docId = await resolveEntityDocumentId(strapi, 'api::size.size', ctx.params?.id);
      if (!docId) return ctx.notFound('Talla no encontrada');

      const sizeEntity: any = await strapi.documents('api::size.size' as any).findOne({
        documentId: docId,
        populate: ['color'],
      } as any);

      const whStocks: any[] = await strapi
        .documents('api::warehouse-stock.warehouse-stock')
        .findMany({
          filters: { size: { documentId: docId } } as any,
          limit: 500,
        });

      for (const ws of whStocks) {
        if (ws?.documentId) {
          await strapi
            .documents('api::warehouse-stock.warehouse-stock')
            .delete({ documentId: ws.documentId })
            .catch((err) => console.error('[size.deleteAdmin] Error cleaning warehouse-stock:', err));
        }
      }

      const res = await crud.deleteAdmin(ctx);

      const parentColorDocId = sizeEntity?.color?.documentId;
      if (parentColorDocId) {
        const remainingStocks: any[] = await strapi
          .documents('api::warehouse-stock.warehouse-stock')
          .findMany({
            filters: { color: { documentId: parentColorDocId } } as any,
            limit: 2000,
          });
        const totalColorStock = Number(
          remainingStocks.reduce((sum, s) => sum + Number(s.stock || 0), 0).toFixed(3),
        );
        await strapi.db.query('api::color.color').updateMany({
          where: { documentId: parentColorDocId },
          data: { stock: totalColorStock },
        });
      }

      return res;
    },
  };
});

