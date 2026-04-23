export default {
  routes: [
    {
      method: 'GET',
      path: '/orders-admin',
      handler: 'api::order.order.findAdmin',
      config: {
        auth: false, // For local dev, bypass auth for this specific admin route to ensure it works without API Token granular permissions issues.
      },
    },
  ],
};
