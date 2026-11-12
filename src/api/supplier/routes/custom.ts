import { buildAdminRoutes } from '../../../utils/adminCrud';

export default {
  routes: buildAdminRoutes('/suppliers-admin', 'api::supplier.supplier'),
};

