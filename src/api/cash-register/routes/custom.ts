import { buildAdminRoutes } from '../../../utils/adminCrud';

export default {
  routes: buildAdminRoutes('/cash-registers-admin', 'api::cash-register.cash-register'),
};

