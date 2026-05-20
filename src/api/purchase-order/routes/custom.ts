export default {
  routes: [
    {
      method: 'GET',
      path: '/purchase-orders-admin',
      handler: 'api::purchase-order.purchase-order.findAdmin',
      config: {
        auth: false,
        policies: ['global::is-admin'],
      },
    },
    {
      method: 'POST',
      path: '/purchase-orders-admin/process-full',
      handler: 'api::purchase-order.purchase-order.processPurchaseOrderFull',
      config: {
        auth: false,
        policies: ['global::is-admin'],
      },
    },
  ],
};
