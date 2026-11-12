import { factories } from '@strapi/strapi';
import { createAdminCrudHandlers } from '../../../utils/adminCrud';

export default factories.createCoreController('api::category.category', ({ strapi }) =>
  createAdminCrudHandlers(strapi, 'api::category.category', {
    defaultPopulate: ['image'],
    defaultStatus: 'published',
    forcePublishedStatus: true,
  }),
);
