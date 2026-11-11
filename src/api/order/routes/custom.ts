export default {
  routes: [
    {
      method: 'GET',
      path: '/orders-admin',
      handler: 'api::order.order.findAdmin',
      config: {
        auth: false,
        policies: [
          {
            name: 'global::is-admin',
            config: { permission: ['api::order.order.find', 'api::cash-register.cash-register.find'] },
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/orders-admin/process-full',
      handler: 'api::order.order.processOrderFull',
      config: {
        auth: false,
        policies: [
          {
            name: 'global::is-admin',
            config: { permission: 'api::order.order.create' },
          },
        ],
      },
    },
    {
      method: 'PUT',
      path: '/orders-admin/:id/add-payment',
      handler: 'api::order.order.addPayment',
      config: {
        auth: false,
        policies: [
          {
            name: 'global::is-admin',
            config: { permission: ['api::order.order.update', 'api::order.order.create'] },
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/orders-admin/cashea-webhook',
      handler: 'api::order.order.casheaWebhook',
      config: {
        auth: false,
        policies: ['global::is-admin'],
      },
    },
    {
      method: 'POST',
      path: '/orders-admin/batch-settle',
      handler: 'api::order.order.batchSettle',
      config: {
        auth: false,
        policies: [
          {
            name: 'global::is-admin',
            config: { permission: 'api::order.order.update' },
          },
        ],
      },
    },
  ],
};
