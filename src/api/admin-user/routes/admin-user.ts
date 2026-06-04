export default {
  routes: [
    {
      method: 'GET',
      path: '/admin-users',
      handler: 'admin-user.getUsers',
      config: {
        auth: false,
        policies: [
          { name: 'global::is-admin', config: { roles: ['admin'] } }
        ]
      }
    },
    {
      method: 'POST',
      path: '/admin-users',
      handler: 'admin-user.createUser',
      config: {
        auth: false,
        policies: [
          { name: 'global::is-admin', config: { roles: ['admin'] } }
        ]
      }
    },
    {
      method: 'PUT',
      path: '/admin-users/:id',
      handler: 'admin-user.updateUser',
      config: {
        auth: false,
        policies: [
          { name: 'global::is-admin', config: { roles: ['admin'] } }
        ]
      }
    },
    {
      method: 'DELETE',
      path: '/admin-users/:id',
      handler: 'admin-user.deleteUser',
      config: {
        auth: false,
        policies: [
          { name: 'global::is-admin', config: { roles: ['admin'] } }
        ]
      }
    }
  ]
};
