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

        if (user.blocked) {
            console.error('[is-admin policy] Usuario bloqueado intentó acceder:', decoded.id);
            throw new PolicyError('Acceso denegado: Tu cuenta está bloqueada.');
        }

        // Configuración de roles: Lista negra de roles que no son administrativos
        const forbiddenRoles = ['public', 'client', 'cliente', 'customer', 'authenticated'];
        const roleType = (user.role?.type || '').toLowerCase();
        const roleName = (user.role?.name || '').toLowerCase();
        const userRole = roleType || roleName;
        const isSuperAdmin = roleType === 'admin' || roleType.includes('admin') || roleName.includes('admin');

        if (isSuperAdmin) {
            policyContext.state.user = user;
            return true;
        }

        if (forbiddenRoles.includes(roleType) || forbiddenRoles.includes(roleName)) {
            console.error(`[is-admin policy] Acceso denegado: El rol '${userRole}' pertenece a la lista de clientes/público.`);
            throw new PolicyError('Acceso denegado: Solo personal autorizado.');
        }

        let isAllowed = false;

        if (config?.permission) {
            // Validar si el rol personalizado tiene asignado el permiso granular en Strapi
            const requiredPerms = Array.isArray(config.permission) ? config.permission : [config.permission];
            const roleId = user.role?.id;
            if (roleId && requiredPerms.length > 0) {
                const matchedPerm = await strapi.db.query('plugin::users-permissions.permission').findOne({
                    where: {
                        role: roleId,
                        action: { $in: requiredPerms }
                    }
                });
                isAllowed = Boolean(matchedPerm);
            }
        } else if (config?.roles && Array.isArray(config.roles)) {
            // Si la ruta especifica explícitamente los roles permitidos, respetarlo
            isAllowed = config.roles.includes(roleType) || config.roles.includes(roleName);
        } else {
            // Por defecto, permitimos cualquier rol administrativo que NO esté en la lista negra.
            isAllowed = true;
        }

        if (isAllowed) {
            policyContext.state.user = user; // Guardar en state por si el controlador lo necesita
            return true;
        }

        console.error(`[is-admin policy] Acceso denegado: El rol '${userRole}' no tiene privilegios para esta operación.`);
        throw new PolicyError('Acceso denegado: No tienes permisos para realizar esta acción.');
    } catch (err: any) {
        console.error('[is-admin policy] Excepción capturada:', err.message || err);
        throw new PolicyError('Token inválido o expirado');
    }
};
