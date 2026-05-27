export default (plugin: any) => {
  const originalMe = plugin.controllers.user.me;

  plugin.controllers.user.me = async (ctx: any) => {
    // 1. Ejecutar el controlador nativo de Strapi
    await originalMe(ctx);

    // 2. Si se resolvió el usuario autenticado
    if (ctx.body && ctx.state.user) {
      try {
        // 3. Buscar el usuario con su rol poblado en la base de datos
        const userWithRole = await strapi.db.query('plugin::users-permissions.user').findOne({
          where: { id: ctx.state.user.id },
          populate: ['role']
        }) as any;

        if (userWithRole && userWithRole.role) {
          const roleId = userWithRole.role.id;
          
          // Preparar objeto de rol y permisos
          const roleObj = {
            id: userWithRole.role.id,
            name: userWithRole.role.name,
            description: userWithRole.role.description,
            type: userWithRole.role.type
          };

          // 4. Obtener todos los permisos asignados a ese rol
          const permissions = await strapi.db.query('plugin::users-permissions.permission').findMany({
            where: { role: roleId },
            select: ['action'],
          }) as any[];
          const perms = permissions.map((p: any) => p.action);

          // 5. Inyectar los permisos y rol en la estructura correcta según el formato de respuesta
          if (ctx.body.data && ctx.body.data.attributes) {
            ctx.body.data.attributes.role = roleObj;
            ctx.body.data.attributes.permissions = perms;
          } else {
            ctx.body.role = roleObj;
            ctx.body.permissions = perms;
          }
        } else {
          if (ctx.body.data && ctx.body.data.attributes) {
            ctx.body.data.attributes.role = null;
            ctx.body.data.attributes.permissions = [];
          } else {
            ctx.body.role = null;
            ctx.body.permissions = [];
          }
        }
      } catch (err: any) {
        strapi.log.error(`[users-permissions-extension] Error al inyectar rol o permisos en /users/me: ${err.message}`);
        // Proveer fallbacks seguros en caso de error de base de datos
        if (ctx.body.data && ctx.body.data.attributes) {
          ctx.body.data.attributes.role = ctx.body.data.attributes.role || null;
          ctx.body.data.attributes.permissions = ctx.body.data.attributes.permissions || [];
        } else {
          ctx.body.role = ctx.body.role || null;
          ctx.body.permissions = ctx.body.permissions || [];
        }
      }
    }
  };

  return plugin;
};
