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
    },
    {
      method: 'POST',
      path: '/admin-roles',
      handler: 'admin-role.createRole',
      config: {
        auth: false,
        policies: ['global::is-admin']
      }
    },
    {
      method: 'DELETE',
      path: '/admin-roles/:id',
      handler: 'admin-role.deleteRole',
      config: {
        auth: false,
        policies: ['global::is-admin']
      }
    }
  ]
};
