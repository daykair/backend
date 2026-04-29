const isAdminMiddleware = async (ctx, next) => {
    // 1. Permitir acceso si la autenticación se realizó mediante un API Token (API Key)
    if (ctx.state.auth && ctx.state.auth.strategy.name === 'api-token') {
        return next();
    }

    // 2. Como usamos auth: false, Strapi no lee el JWT automáticamente. Debemos extraerlo manualmente:
    if (!ctx.request.header.authorization) {
        return ctx.unauthorized('No autenticado: Falta el token');
    }

    const token = ctx.request.header.authorization.replace('Bearer ', '').trim();

    try {
        // Verificar el token usando el servicio de JWT del plugin users-permissions
        const decoded = await strapi.plugin('users-permissions').service('jwt').verify(token);
        
        if (!decoded || !decoded.id) {
             return ctx.unauthorized('Token inválido');
        }

        // Buscar al usuario y su rol
        const user = await strapi.db.query('plugin::users-permissions.user').findOne({
            where: { id: decoded.id },
            populate: ['role']
        });

        // Gastos solo deben ser accesibles para administradores
        if (user?.role?.type === 'admin' || user?.role?.name?.toLowerCase() === 'admin') {
            ctx.state.user = user; 
            return next();
        }

        return ctx.forbidden('Acceso denegado: Solo administradores.');
    } catch (err) {
        return ctx.unauthorized('Token inválido o expirado');
    }
};

export default {
    routes: [
        {
            method: 'GET',
            path: '/expenses-admin',
            handler: 'api::expense.expense.findAdmin',
            config: {
                auth: false,
                middlewares: [isAdminMiddleware]
            }
        },
        {
            method: 'POST',
            path: '/expenses-admin',
            handler: 'api::expense.expense.createAdmin',
            config: {
                auth: false,
                middlewares: [isAdminMiddleware]
            }
        },
        {
            method: 'PUT',
            path: '/expenses-admin/:id',
            handler: 'api::expense.expense.updateAdmin',
            config: {
                auth: false,
                middlewares: [isAdminMiddleware]
            }
        },
        {
            method: 'DELETE',
            path: '/expenses-admin/:id',
            handler: 'api::expense.expense.deleteAdmin',
            config: {
                auth: false,
                middlewares: [isAdminMiddleware]
            }
        }
    ]
}
