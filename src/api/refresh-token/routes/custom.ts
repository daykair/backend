export default {
  routes: [
    {
      method: 'GET',
      path: '/sessions',
      handler: 'api::refresh-token.refresh-token.getSessions',
      config: {
        auth: false
      }
    },
    {
      method: 'POST',
      path: '/sessions/revoke-others',
      handler: 'api::refresh-token.refresh-token.revokeOtherSessions',
      config: {
        auth: false
      }
    },
    {
      method: 'POST',
      path: '/sessions/:id/revoke',
      handler: 'api::refresh-token.refresh-token.revokeSession',
      config: {
        auth: false
      }
    }
  ]
};
