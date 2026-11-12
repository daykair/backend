import { buildAdminRoutes } from '../../../utils/adminCrud';

export default {
  routes: [
    ...buildAdminRoutes('/colors-admin', 'api::color.color', [
      'find',
      'findOne',
      'update',
      'delete',
    ]),
  ],
};

