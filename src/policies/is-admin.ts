export default async (policyContext: any, config: any, { strapi }: any) => {
    // 1. Permitir acceso si la autenticación se realizó mediante un API Token (API Key)
    if (policyContext.state.auth && policyContext.state.auth.strategy?.name === 'api-token') {
        return true;
    }

    // 2. Extraer el token de la cabecera de autorización o de las cookies
    let token = '';
    if (policyContext.request.header.authorization) {
        token = policyContext.request.header.authorization.replace('Bearer ', '').trim();
    } else if (policyContext.cookies && policyContext.cookies.get('strapi_jwt')) {
        token = policyContext.cookies.get('strapi_jwt') || '';
    }

    if (!token) {
        return policyContext.unauthorized('No autenticado: Falta el token');
    }

    try {
        // Verificar el token usando el servicio de JWT del plugin users-permissions
        const decoded = await strapi.plugin('users-permissions').service('jwt').verify(token);

        if (!decoded || !decoded.id) {
            return policyContext.unauthorized('Token inválido');
        }

        // Buscar al usuario y su rol
        const user = await strapi.db.query('plugin::users-permissions.user').findOne({
            where: { id: decoded.id },
            populate: ['role']
        });

        if (!user) {
            return policyContext.unauthorized('Usuario no encontrado');
        }

        // Configuración de roles: por defecto se permite 'admin' y 'authenticated'
        const allowedRoles = config?.roles || ['admin', 'authenticated'];
        const userRole = user.role?.type || user.role?.name?.toLowerCase();

        if (allowedRoles.includes(userRole)) {
            policyContext.state.user = user; // Guardar en state por si el controlador lo necesita
            return true;
        }

        return policyContext.forbidden('Acceso denegado: Solo administradores.');
    } catch (err) {
        return policyContext.unauthorized('Token inválido o expirado');
    }
};
