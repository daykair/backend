export default {
  routes: [
    {
      method: 'POST',
      path: '/auth/local-cookie',
      handler: 'api::auth.auth.localWithCookie',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/auth/refresh',
      handler: 'api::auth.auth.refresh',
      config: {
        auth: false,
      }
    },
    {
      method: 'POST',
      path: '/auth/logout',
      handler: 'api::auth.auth.logout',
      config: {
        auth: false,
      }
    },
    {
      method: 'POST',
      path: '/auth/change-password',
      handler: 'api::auth.auth.changeOwnPassword',
      config: {
        auth: false,
      }
    },
    {
      method: 'GET',
      path: '/auth/verify-invite',
      handler: 'api::auth.auth.verifyInvite',
      config: {
        auth: false,
      }
    },
    {
      method: 'POST',
      path: '/auth/complete-invite',
      handler: 'api::auth.auth.completeInvite',
      config: {
        auth: false,
      }
    }
  ]
};
