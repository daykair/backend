export default {
  routes: [
    {
      method: 'GET',
      path: '/admin-roles',
      handler: 'admin-role.getRoles',
      config: {
        auth: false,
        policies: ['global::is-admin']
      }
    },
    {
      method: 'GET',
      path: '/admin-roles/permissions-tree',
      handler: 'admin-role.getPermissionsTree',
      config: {
        auth: false,
        policies: ['global::is-admin']
      }
    },
    {
      method: 'GET',
      path: '/admin-roles/:id',
      handler: 'admin-role.getRole',
      config: {
        auth: false,
        policies: ['global::is-admin']
      }
    },
    {
      method: 'PUT',
      path: '/admin-roles/:id',
      handler: 'admin-role.updateRole',
      config: {
        auth: false,
        policies: ['global::is-admin']
      }
    }
  ]
};
