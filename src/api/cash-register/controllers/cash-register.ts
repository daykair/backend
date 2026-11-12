import { factories } from '@strapi/strapi';
import {
  createAdminCrudHandlers,
  resolveEntityDocumentId,
  SAFE_USER_POPULATE,
} from '../../../utils/adminCrud';

export default factories.createCoreController('api::cash-register.cash-register', ({ strapi }) => {
  const findConflictingCashRegister = async (
    strapiRef: any,
    dateStr: string,
    warehouseDocId: string | null,
    excludeDocumentId?: string,
  ) => {
    if (!dateStr) return null;
    const where: any = {
      date: dateStr,
      warehouse: warehouseDocId ? { documentId: warehouseDocId } : { $null: true },
    };
    if (excludeDocumentId) {
      where.documentId = { $ne: excludeDocumentId };
    }
    return strapiRef.db.query('api::cash-register.cash-register').findOne({
      where,
      select: ['id', 'documentId', 'date'],
    });
  };

  const crud = createAdminCrudHandlers(strapi, 'api::cash-register.cash-register', {
    defaultPopulate: {
      performedBy: SAFE_USER_POPULATE,
      warehouse: true,
    },
    allowedPopulateKeys: ['performedBy', 'warehouse'],
    injectPerformedBy: true,
    transactional: true,
    beforeCreate: async (strapiRef, data) => {
      if (data.warehouse) {
        const resolvedWh = await resolveEntityDocumentId(
          strapiRef,
          'api::warehouse.warehouse',
          data.warehouse,
        );
        if (!resolvedWh) {
          const err: any = new Error('El almacén seleccionado no existe.');
          err.status = 400;
          throw err;
        }
        data.warehouse = resolvedWh;
      } else {
        data.warehouse = null;
      }
      data.openingBalance = Number(data.openingBalance || 0);

      const dateStr = data.date ? String(data.date).split('T')[0] : '';
      if (dateStr) {
        data.date = dateStr;
        const existing = await findConflictingCashRegister(
          strapiRef,
          dateStr,
          data.warehouse,
        );
        if (existing) {
          const err: any = new Error(
            'Ya existe un cierre de caja registrado para esta fecha y almacén. Edita o revisa el cierre existente en lugar de duplicarlo.',
          );
          err.status = 409;
          throw err;
        }
      }

      return data;
    },
    beforeUpdate: async (strapiRef, docId, data) => {
      const currentRecord = (await strapiRef.db
        .query('api::cash-register.cash-register')
        .findOne({
          where: { documentId: docId },
          populate: { warehouse: { select: ['documentId'] } },
        })) as any;

      let nextWarehouseDocId: string | null = currentRecord?.warehouse?.documentId || null;
      if (data.warehouse !== undefined) {
        if (data.warehouse) {
          const resolvedWh = await resolveEntityDocumentId(
            strapiRef,
            'api::warehouse.warehouse',
            data.warehouse,
          );
          if (!resolvedWh) {
            const err: any = new Error('El almacén seleccionado no existe.');
            err.status = 400;
            throw err;
          }
          nextWarehouseDocId = resolvedWh;
          data.warehouse = resolvedWh;
        } else {
          nextWarehouseDocId = null;
          data.warehouse = null;
        }
      }

      const nextDateStr =
        data.date !== undefined
          ? String(data.date).split('T')[0]
          : currentRecord?.date
          ? String(currentRecord.date).split('T')[0]
          : '';
      if (data.date !== undefined && nextDateStr) {
        data.date = nextDateStr;
      }

      if (nextDateStr && (data.date !== undefined || data.warehouse !== undefined)) {
        const conflict = await findConflictingCashRegister(
          strapiRef,
          nextDateStr,
          nextWarehouseDocId,
          docId,
        );
        if (conflict) {
          const err: any = new Error(
            'Ya existe otro cierre de caja registrado para esa fecha y almacén.',
          );
          err.status = 409;
          throw err;
        }
      }

      if (data.openingBalance !== undefined) {
        data.openingBalance = Number(data.openingBalance || 0);
      }
      return data;
    },
  });

  return crud;
});
