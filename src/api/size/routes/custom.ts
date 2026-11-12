export default {
  routes: [
    {
      method: 'GET',
      path: '/sizes-admin',
      handler: 'api::size.size.findAdmin',
      config: {
        auth: false,
        policies: [
          {
            name: 'global::is-admin',
            config: {
              permission: ['api::size.size.find', 'api::color.color.find', 'api::product.product.find'],
            },
          },
        ],
      },
    },
    {
      method: 'GET',
      path: '/sizes-admin/:id',
      handler: 'api::size.size.findOneAdmin',
      config: {
        auth: false,
        policies: [
          {
            name: 'global::is-admin',
            config: {
              permission: ['api::size.size.findOne', 'api::color.color.findOne', 'api::product.product.findOne'],
            },
          },
        ],
      },
    },
    {
      method: 'PUT',
      path: '/sizes-admin/:id',
      handler: 'api::size.size.updateAdmin',
      config: {
        auth: false,
        policies: [
          {
            name: 'global::is-admin',
            config: {
              permission: ['api::size.size.update', 'api::color.color.update', 'api::product.product.update'],
            },
          },
        ],
      },
    },
    {
      method: 'DELETE',
      path: '/sizes-admin/:id',
      handler: 'api::size.size.deleteAdmin',
      config: {
        auth: false,
        policies: [
          {
            name: 'global::is-admin',
            config: {
              permission: ['api::size.size.delete', 'api::color.color.delete', 'api::product.product.delete'],
            },
          },
        ],
      },
    },
  ],
};
