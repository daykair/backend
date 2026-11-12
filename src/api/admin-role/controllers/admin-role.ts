import { isSuperAdminRole } from '../../../utils/adminCrud';

const PROTECTED_SYSTEM_ROLES = new Set(['admin', 'super_admin', 'public', 'authenticated', 'client', 'cliente', 'customer']);

function sanitizeRolePermissionsInput(permissions: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};

  for (const [resourceKey, resourceVal] of Object.entries(permissions || {})) {
    if (!resourceKey.startsWith('api::') && !resourceKey.startsWith('plugin::')) {
      continue;
    }

    if (resourceVal && typeof resourceVal === 'object' && 'controllers' in resourceVal) {
      const controllerObj = (resourceVal as any).controllers;
      sanitized[resourceKey] = { controllers: {} };

      for (const [controllerName, controllerVal] of Object.entries(controllerObj || {})) {
        if (controllerVal && typeof controllerVal === 'object') {
          sanitized[resourceKey].controllers[controllerName] = {};

          for (const [actionName, actionVal] of Object.entries(controllerVal)) {
            if (actionVal && typeof actionVal === 'object' && 'enabled' in actionVal) {
              sanitized[resourceKey].controllers[controllerName][actionName] = {
                enabled: Boolean((actionVal as any).enabled),
              };
            }
          }
        }
      }
    }
  }

  return sanitized;
}

function isReservedAdminOrSystemRoleName(name?: string, type?: string): boolean {
  const normalizedName = String(name || '').trim().toLowerCase();
  const normalizedType = String(type || '').trim().toLowerCase();
  if (
    normalizedName.includes('admin') ||
    normalizedType.includes('admin') ||
    PROTECTED_SYSTEM_ROLES.has(normalizedName) ||
    PROTECTED_SYSTEM_ROLES.has(normalizedType)
  ) {
    return true;
  }
  return false;
}

export default {
  async getRoles(ctx: any) {
    if (!isSuperAdminRole(ctx.state?.user?.role)) {
      return ctx.forbidden('Solo un Super Administrador puede consultar roles administrativos.');
    }
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
    if (!isSuperAdminRole(ctx.state?.user?.role)) {
      return ctx.forbidden('Solo un Super Administrador puede consultar el árbol de permisos.');
    }
    try {
      const upService = strapi.plugin('users-permissions').service('users-permissions');
      const permissions = await upService.getActions();
      return ctx.send({ permissions });
    } catch (err: any) {
      return ctx.badRequest(err.message || 'Error al obtener el catálogo de permisos.');
    }
  },

  async getRole(ctx: any) {
    if (!isSuperAdminRole(ctx.state?.user?.role)) {
      return ctx.forbidden('Solo un Super Administrador puede consultar detalles de roles.');
    }
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
    if (!isSuperAdminRole(ctx.state?.user?.role)) {
      return ctx.forbidden('Solo un Super Administrador puede modificar roles y permisos.');
    }

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

    try {
      const existingRole = await strapi.plugin('users-permissions').service('role').findOne(id);
      if (!existingRole) {
        return ctx.notFound('Rol no encontrado.');
      }

      if (isSuperAdminRole(existingRole)) {
        return ctx.forbidden('El rol maestro Admin no puede ser modificado.');
      }

      const existingType = String(existingRole.type || '').toLowerCase();
      if (isReservedAdminOrSystemRoleName(name) && !(PROTECTED_SYSTEM_ROLES.has(existingType) && name.trim().toLowerCase() === existingType)) {
        return ctx.badRequest('Ese nombre de rol está reservado por el sistema o contiene la palabra reservada "admin".');
      }

      const sanitizedPermissions = sanitizeRolePermissionsInput(permissions);

      await strapi.plugin('users-permissions').service('role').updateRole(id, {
        name: name.trim(),
        description: description ? description.trim() : '',
        permissions: sanitizedPermissions,
      });

      return ctx.send({ message: 'Rol y permisos actualizados correctamente.' });
    } catch (err: any) {
      return ctx.badRequest(err.message || 'Error al guardar el rol y sus permisos.');
    }
  },

  async createRole(ctx: any) {
    if (!isSuperAdminRole(ctx.state?.user?.role)) {
      return ctx.forbidden('Solo un Super Administrador puede crear roles.');
    }

    const { name, description, permissions } = ctx.request.body;

    if (!name || typeof name !== 'string' || name.trim().length < 3) {
      return ctx.badRequest('El nombre del rol es requerido y debe tener al menos 3 caracteres.');
    }

    if (isReservedAdminOrSystemRoleName(name)) {
      return ctx.badRequest('No puedes crear un rol con nombre reservado o que contenga "admin".');
    }

    if (description && typeof description !== 'string') {
      return ctx.badRequest('La descripción debe ser un texto válido.');
    }

    if (!permissions || typeof permissions !== 'object') {
      return ctx.badRequest('La estructura de permisos enviada no es válida.');
    }

    const sanitizedPermissions = sanitizeRolePermissionsInput(permissions);

    try {
      const newRole = await strapi.plugin('users-permissions').service('role').createRole({
        name: name.trim(),
        description: description ? description.trim() : '',
        users: [],
        permissions: sanitizedPermissions,
      });

      return ctx.send({ message: 'Rol creado correctamente.', role: newRole });
    } catch (err: any) {
      return ctx.badRequest(err.message || 'Error al crear el rol.');
    }
  },

  async deleteRole(ctx: any) {
    if (!isSuperAdminRole(ctx.state?.user?.role)) {
      return ctx.forbidden('Solo un Super Administrador puede eliminar roles.');
    }
    const { id } = ctx.params;
    
    try {
      const role = await strapi.plugin('users-permissions').service('role').findOne(id);
      
      if (!role) {
        return ctx.notFound('Rol no encontrado.');
      }
      
      // Prevent deleting system roles
      const systemRoles = ['admin', 'public', 'authenticated', 'client'];
      if (isSuperAdminRole(role) || systemRoles.includes(role.type?.toLowerCase())) {
        return ctx.badRequest('No se pueden eliminar los roles del sistema.');
      }

      // Check if there are users assigned to this role
      const userCount = await strapi.db.query('plugin::users-permissions.user').count({
        where: { role: role.id }
      });

      if (userCount > 0) {
        return ctx.badRequest('No se puede eliminar un rol que tiene usuarios asignados. Reasigna a los usuarios primero.');
      }

      await strapi.plugin('users-permissions').service('role').deleteRole(id);
      
      return ctx.send({ message: 'Rol eliminado correctamente.' });
    } catch (err: any) {
      return ctx.badRequest(err.message || 'Error al eliminar el rol.');
    }
  }
};
