export default {
  routes: [
    {
      method: 'GET',
      path: '/customers-admin',
      handler: 'customer-admin.findCustomers',
      config: {
        auth: false,
        policies: [
          {
            name: 'global::is-admin',
            config: {
              permission: [
                'plugin::users-permissions.user.find',
                'api::order.order.find',
                'api::order.order.create',
              ],
            },
          },
        ],
      },
    },
    {
      method: 'GET',
      path: '/customers-admin/:id',
      handler: 'customer-admin.findOneCustomer',
      config: {
        auth: false,
        policies: [
          {
            name: 'global::is-admin',
            config: {
              permission: [
                'plugin::users-permissions.user.findOne',
                'plugin::users-permissions.user.find',
                'api::order.order.find',
                'api::order.order.create',
              ],
            },
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/customers-admin',
      handler: 'customer-admin.createCustomer',
      config: {
        auth: false,
        policies: [
          {
            name: 'global::is-admin',
            config: {
              permission: [
                'plugin::users-permissions.user.create',
                'api::order.order.create',
              ],
            },
          },
        ],
      },
    },
    {
      method: 'PUT',
      path: '/customers-admin/:id',
      handler: 'customer-admin.updateCustomer',
      config: {
        auth: false,
        policies: [
          {
            name: 'global::is-admin',
            config: {
              permission: ['plugin::users-permissions.user.update'],
            },
          },
        ],
      },
    },
  ],
};

