import { errors } from '@strapi/utils';
const { PolicyError } = errors;

export default async (policyContext: any, config: any, { strapi }: any) => {
    // 1. Permitir acceso si la autenticación se realizó mediante un API Token (API Key)
    if (policyContext.state.auth && policyContext.state.auth.strategy?.name === 'api-token') {
        return true;
    }

    // 2. Extraer el token de la cabecera de autorización o de las cookies
    let token = '';
    const cookieHeader = policyContext.request.header.cookie || '';
    
    if (policyContext.request.header.authorization) {
        token = policyContext.request.header.authorization.replace('Bearer ', '').trim();
    } else if (policyContext.cookies && policyContext.cookies.get('strapi_jwt')) {
        token = policyContext.cookies.get('strapi_jwt') || '';
    }

    // Fallback: parsear manualmente la cabecera cookie por si ctx.cookies.get falla
    if (!token && cookieHeader) {
        const match = cookieHeader.match(/(?:^|;\s*)strapi_jwt=([^;]*)/);
        if (match) {
            token = match[1];
        }
    }

    if (!token) {
        throw new PolicyError('No autenticado: Falta el token');
    }

    try {
        // Verificar el token usando el servicio de JWT del plugin users-permissions
        const decoded = await strapi.plugin('users-permissions').service('jwt').verify(token);

        if (!decoded || !decoded.id) {
            console.error('[is-admin policy] Token inválido: decoded object is null or missing id');
            throw new PolicyError('Token inválido');
        }

        // Buscar al usuario y su rol
        const user = await strapi.db.query('plugin::users-permissions.user').findOne({
            where: { id: decoded.id },
            populate: ['role']
        });

        if (!user) {
            console.error('[is-admin policy] Usuario no encontrado para el id:', decoded.id);
            throw new PolicyError('Usuario no encontrado');
        }

        // Configuración de roles: por defecto se permite 'superadmin', 'admin' y 'authenticated'
        const allowedRoles = config?.roles || ['superadmin', 'admin', 'authenticated'];
        const userRole = user.role?.type || user.role?.name?.toLowerCase();

        if (allowedRoles.includes(userRole)) {
            policyContext.state.user = user; // Guardar en state por si el controlador lo necesita
            return true;
        }

        console.error(`[is-admin policy] Acceso denegado: El rol '${userRole}' no está en la lista de permitidos (${allowedRoles.join(', ')})`);
        throw new PolicyError('Acceso denegado: Solo administradores.');
    } catch (err: any) {
        console.error('[is-admin policy] Excepción capturada:', err.message || err);
        throw new PolicyError('Token inválido o expirado');
    }
};
