import { factories } from '@strapi/strapi';
import { createAdminCrudHandlers } from '../../../utils/adminCrud';

export default factories.createCoreController('api::supplier.supplier', ({ strapi }) =>
  createAdminCrudHandlers(strapi, 'api::supplier.supplier'),
);
