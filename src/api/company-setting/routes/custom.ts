export default {
  routes: [
    {
      method: 'GET',
      path: '/company-setting-admin',
      handler: 'api::company-setting.company-setting.getAdminSettings',
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
      method: 'PUT',
      path: '/company-setting-admin',
      handler: 'api::company-setting.company-setting.updateAdminSettings',
      config: {
        auth: false,
        policies: [
          {
            name: 'global::is-admin',
            config: { permission: 'api::company-setting.company-setting.update' },
          },
        ],
      },
    },
  ],
};

