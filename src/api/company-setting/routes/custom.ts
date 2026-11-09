export default {
  routes: [
    {
      method: 'GET',
      path: '/company-setting-admin',
      handler: 'api::company-setting.company-setting.getAdminSettings',
      config: {
        auth: false,
      },
    },
    {
      method: 'PUT',
      path: '/company-setting-admin',
      handler: 'api::company-setting.company-setting.updateAdminSettings',
      config: {
        auth: false,
        policies: ['global::is-admin'],
      },
    },
  ],
};

