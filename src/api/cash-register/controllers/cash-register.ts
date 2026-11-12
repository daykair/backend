import { factories } from '@strapi/strapi';
import {
  createAdminCrudHandlers,
  resolveEntityDocumentId,
  userHasExactPermission,
} from '../../../utils/adminCrud';

export default factories.createCoreController('api::cash-register.cash-register', ({ strapi }) => {
  const crud = createAdminCrudHandlers(strapi, 'api::cash-register.cash-register', {
    defaultPopulate: ['performedBy', 'warehouse'],
    injectPerformedBy: true,
    beforeCreate: async (strapiRef, data, ctx) => {
      if (data.warehouse) {
        const resolvedWh = await resolveEntityDocumentId(
          strapiRef,
          'api::warehouse.warehouse',
          data.warehouse,
        );
        data.warehouse = resolvedWh || null;
      }
      data.openingBalance = Number(data.openingBalance || 0);

      const dateStr = data.date ? String(data.date).split('T')[0] : '';
      if (dateStr) {
        const filters: any = { date: dateStr };
        if (data.warehouse) {
          filters.warehouse = { documentId: data.warehouse };
        }
        const existing = await strapiRef.documents('api::cash-register.cash-register').findFirst({
          filters,
        });
        if (existing) {
          const canUpdate = await userHasExactPermission(
            strapiRef,
            ctx.state?.user,
            'api::cash-register.cash-register.update',
          );
          if (!canUpdate) {
            const err: any = new Error(
              'Ya existe un cierre de caja registrado para esta fecha y no tienes permiso para modificarlo o duplicarlo.',
            );
            err.status = 403;
            throw err;
          }
        }
      }

      return data;
    },
    beforeUpdate: async (strapiRef, _docId, data) => {
      if (data.warehouse !== undefined) {
        data.warehouse = data.warehouse
          ? await resolveEntityDocumentId(strapiRef, 'api::warehouse.warehouse', data.warehouse)
          : null;
      }
      if (data.openingBalance !== undefined) {
        data.openingBalance = Number(data.openingBalance || 0);
      }
      return data;
    },
  });

  return crud;
});
