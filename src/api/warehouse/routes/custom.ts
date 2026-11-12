import { buildAdminRoutes } from '../../../utils/adminCrud';

export default {
  routes: [
    ...buildAdminRoutes('/warehouses-admin', 'api::warehouse.warehouse'),
    {
      method: 'POST',
      path: '/warehouses/transfer',
      handler: 'api::warehouse.warehouse.transfer',
      config: {
        auth: false,
        policies: [
          {
            name: 'global::is-admin',
            config: {
              permission: [
                'api::warehouse.warehouse.update',
                'api::inventory-movement.inventory-movement.create',
              ],
            },
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/warehouses-admin/physical-audit',
      handler: 'api::warehouse.warehouse.physicalAudit',
      config: {
        auth: false,
        policies: [
          {
            name: 'global::is-admin',
            config: {
              permission: [
                'api::warehouse.warehouse.find',
                'api::inventory-movement.inventory-movement.create',
              ],
            },
          },
        ],
      },
    },
  ],
};
