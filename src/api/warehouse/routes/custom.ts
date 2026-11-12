export default {
  routes: [
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
  ],
};
