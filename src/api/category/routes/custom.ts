import { buildAdminRoutes } from '../../../utils/adminCrud';

export default {
  routes: buildAdminRoutes('/categories-admin', 'api::category.category'),
};

