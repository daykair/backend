export default {
  routes: [
    {
      method: 'GET',
      path: '/orders-admin',
      handler: 'api::order.order.findAdmin',
      config: {
        auth: false,
        policies: ['global::is-admin'],
      },
    },
    {
      method: 'POST',
      path: '/orders-admin/process-full',
      handler: 'api::order.order.processOrderFull',
      config: {
        auth: false,
        policies: ['global::is-admin'],
      },
    },
    {
      method: 'PUT',
      path: '/orders-admin/:id/add-payment',
      handler: 'api::order.order.addPayment',
      config: {
        auth: false,
        policies: ['global::is-admin'],
      },
    },
  ],
};
