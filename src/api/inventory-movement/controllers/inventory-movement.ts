import { factories } from '@strapi/strapi';
import {
  createAdminCrudHandlers,
  resolveEntityDocumentId,
  SAFE_USER_POPULATE,
} from '../../../utils/adminCrud';

export default factories.createCoreController(
  'api::inventory-movement.inventory-movement',
  ({ strapi }) =>
    createAdminCrudHandlers(strapi, 'api::inventory-movement.inventory-movement', {
      defaultPopulate: {
        color: { populate: { product: true } },
        warehouse: true,
        performedBy: SAFE_USER_POPULATE,
        order: true,
      },
      allowedPopulateKeys: ['color', 'product', 'warehouse', 'performedBy', 'order'],
      injectPerformedBy: true,
      beforeCreate: async (strapiRef, data) => {
        if (data.warehouse) {
          data.warehouse =
            (await resolveEntityDocumentId(strapiRef, 'api::warehouse.warehouse', data.warehouse)) ||
            data.warehouse;
        }
        if (data.color) {
          data.color =
            (await resolveEntityDocumentId(strapiRef, 'api::color.color', data.color)) || data.color;
        }
        if (data.product) {
          data.product =
            (await resolveEntityDocumentId(strapiRef, 'api::product.product', data.product)) ||
            data.product;
        }
        if (data.performedBy) {
          data.performedBy =
            (await resolveEntityDocumentId(
              strapiRef,
              'plugin::users-permissions.user',
              data.performedBy,
            )) || data.performedBy;
        }
        if (!data.date) {
          data.date = new Date().toISOString();
        }
        return data;
      },
    }),
);
