import { buildAdminRoutes } from '../../../utils/adminCrud';

export default {
  routes: buildAdminRoutes(
    '/inventory-movements-admin',
    'api::inventory-movement.inventory-movement',
    ['find', 'findOne', 'create'],
  ),
};

