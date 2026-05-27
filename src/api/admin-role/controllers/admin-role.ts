export default {
  async getRoles(ctx: any) {
    try {
      const rawRoles = await strapi.entityService.findMany('plugin::users-permissions.role');

      // Mapeamos los roles para retornar un conteo de usuarios preciso por rol
      const rolesWithUserCount = await Promise.all(
        rawRoles.map(async (role: any) => {
          const userCount = await strapi.db.query('plugin::users-permissions.user').count({
            where: { role: role.id }
          });
          return {
            id: role.id,
            name: role.name,
            description: role.description,
            type: role.type,
            nb_users: userCount // Mantener compatibilidad de nomenclatura
          };
        })
      );

      return ctx.send({ roles: rolesWithUserCount });
    } catch (err: any) {
      return ctx.badRequest(err.message || 'Error al obtener la lista de roles.');
    }
  },

  async getPermissionsTree(ctx: any) {
    try {
      const upService = strapi.plugin('users-permissions').service('users-permissions');
      const permissions = await upService.getActions();
      return ctx.send({ permissions });
    } catch (err: any) {
      return ctx.badRequest(err.message || 'Error al obtener el catálogo de permisos.');
    }
  },

  async getRole(ctx: any) {
    const { id } = ctx.params;
    try {
      const role = await strapi.plugin('users-permissions').service('role').findOne(id);
      if (!role) {
        return ctx.notFound('Rol no encontrado.');
      }
      return ctx.send({ role });
    } catch (err: any) {
      return ctx.badRequest(err.message || 'Error al obtener el detalle del rol.');
    }
  },

  async updateRole(ctx: any) {
    const { id } = ctx.params;
    const { name, description, permissions } = ctx.request.body;

    if (!name || typeof name !== 'string' || name.trim().length < 3) {
      return ctx.badRequest('El nombre del rol es requerido y debe tener al menos 3 caracteres.');
    }

    if (description && typeof description !== 'string') {
      return ctx.badRequest('La descripción debe ser un texto válido.');
    }

    if (!permissions || typeof permissions !== 'object') {
      return ctx.badRequest('La estructura de permisos enviada no es válida.');
    }

    const sanitizedPermissions: Record<string, any> = {};

    for (const [resourceKey, resourceVal] of Object.entries(permissions)) {
      if (!resourceKey.startsWith('api::') && !resourceKey.startsWith('plugin::')) {
        continue;
      }

      if (resourceVal && typeof resourceVal === 'object' && 'controllers' in resourceVal) {
        const controllerObj = (resourceVal as any).controllers;
        sanitizedPermissions[resourceKey] = { controllers: {} };

        for (const [controllerName, controllerVal] of Object.entries(controllerObj)) {
          if (controllerVal && typeof controllerVal === 'object') {
            sanitizedPermissions[resourceKey].controllers[controllerName] = {};

            for (const [actionName, actionVal] of Object.entries(controllerVal)) {
              if (actionVal && typeof actionVal === 'object' && 'enabled' in actionVal) {
                sanitizedPermissions[resourceKey].controllers[controllerName][actionName] = {
                  enabled: Boolean((actionVal as any).enabled)
                };
              }
            }
          }
        }
      }
    }

    try {
      await strapi.plugin('users-permissions').service('role').updateRole(id, {
        name: name.trim(),
        description: description ? description.trim() : '',
        permissions: sanitizedPermissions,
      });

      return ctx.send({ message: 'Rol y permisos actualizados correctamente.' });
    } catch (err: any) {
      return ctx.badRequest(err.message || 'Error al guardar el rol y sus permisos.');
    }
  }
};
