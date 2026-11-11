export default {
  routes: [
    {
      method: 'GET',
      path: '/admin-roles',
      handler: 'admin-role.getRoles',
      config: {
        auth: false,
        policies: [
          { name: 'global::is-admin', config: { permission: ['plugin::users-permissions.role.find', 'plugin::users-permissions.user.find'] } }
        ]
      }
    },
    {
      method: 'GET',
      path: '/admin-roles/permissions-tree',
      handler: 'admin-role.getPermissionsTree',
      config: {
        auth: false,
        policies: [
          { name: 'global::is-admin', config: { permission: ['plugin::users-permissions.role.find', 'plugin::users-permissions.role.create', 'plugin::users-permissions.role.update'] } }
        ]
      }
    },
    {
      method: 'GET',
      path: '/admin-roles/:id',
      handler: 'admin-role.getRole',
      config: {
        auth: false,
        policies: [
          { name: 'global::is-admin', config: { permission: ['plugin::users-permissions.role.find', 'plugin::users-permissions.role.findOne'] } }
        ]
      }
    },
    {
      method: 'PUT',
      path: '/admin-roles/:id',
      handler: 'admin-role.updateRole',
      config: {
        auth: false,
        policies: [
          { name: 'global::is-admin', config: { permission: 'plugin::users-permissions.role.update' } }
        ]
      }
    },
    {
      method: 'POST',
      path: '/admin-roles',
      handler: 'admin-role.createRole',
      config: {
        auth: false,
        policies: [
          { name: 'global::is-admin', config: { permission: 'plugin::users-permissions.role.create' } }
        ]
      }
    },
    {
      method: 'DELETE',
      path: '/admin-roles/:id',
      handler: 'admin-role.deleteRole',
      config: {
        auth: false,
        policies: [
          { name: 'global::is-admin', config: { permission: 'plugin::users-permissions.role.delete' } }
        ]
      }
    }
  ]
};
