export default {
  routes: [
    {
      method: 'GET',
      path: '/orders-admin/alerts',
      handler: 'api::order.order.alerts',
      config: {
        auth: false,
        policies: [
          {
            name: 'global::is-admin',
            config: { allowAnyStaff: true },
          },
        ],
      },
    },
    {
      method: 'GET',
      path: '/orders-admin/analytics',
      handler: 'api::order.order.analytics',
      config: {
        auth: false,
        policies: [
          {
            name: 'global::is-admin',
            config: { allowAnyStaff: true },
          },
        ],
      },
    },
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
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/orders-public',
      handler: 'api::order.order.createPublicOrder',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/orders-public/track',
      handler: 'api::order.order.trackPublicOrder',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/orders-public/my-orders',
      handler: 'api::order.order.findMyOrders',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/orders-public/:slug',
      handler: 'api::order.order.findPublicBySlug',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'PUT',
      path: '/orders-public/:slug/submit-payment',
      handler: 'api::order.order.submitPublicPayment',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/orders-public/:slug/payment-proof',
      handler: 'api::order.order.uploadPublicPaymentProof',
      config: {
        auth: false,
        policies: [],
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
    {
      method: 'POST',
      path: '/orders-admin/:id/partial-return',
      handler: 'api::order.order.partialReturn',
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
