export default {
  routes: [
    {
      method: 'POST',
      path: '/warehouses/transfer',
      handler: 'api::warehouse.warehouse.transfer',
    },
  ],
};
