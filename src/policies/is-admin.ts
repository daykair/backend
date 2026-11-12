import { errors } from '@strapi/utils';
const { PolicyError } = errors;

/**
 * Infiere el permiso CRUD estándar de Strapi a partir del handler de la ruta y el verbo HTTP
 * cuando la ruta no declaró explícitamente `config.permission`.
 */
function inferRequiredPermissions(policyContext: any): string[] {
    const handler: string = policyContext?.state?.route?.handler || '';
    const method: string = (policyContext?.request?.method || 'GET').toUpperCase();

    // Ejemplo de handler: "api::order.order.findAdmin" o "admin-user.getUsers"
    let baseUid = '';
    if (handler.startsWith('api::') || handler.startsWith('plugin::')) {
        const parts = handler.split('.');
        if (parts.length >= 2) {
            baseUid = `${parts[0]}.${parts[1]}`;
        }
    } else if (handler.startsWith('admin-user.')) {
        baseUid = 'plugin::users-permissions.user';
    } else if (handler.startsWith('admin-role.')) {
        baseUid = 'plugin::users-permissions.role';
    }

    if (!baseUid) return [];

    switch (method) {
        case 'GET':
        case 'HEAD':
            return [`${baseUid}.find`, `${baseUid}.findOne`];
        case 'POST':
            return [`${baseUid}.create`];
        case 'PUT':
        case 'PATCH':
            return [`${baseUid}.update`];
        case 'DELETE':
            return [`${baseUid}.delete`, `${baseUid}.destroy`];
        default:
            return [];
    }
}

export default async (policyContext: any, config: any, { strapi }: any) => {
    // 1. Permitir acceso si la autenticación se realizó mediante un API Token de servidor (API Key)
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

    if (!token && cookieHeader) {
        const match = cookieHeader.match(/(?:^|;\s*)strapi_jwt=([^;]*)/);
        if (match) {
            token = match[1];
        }
    }

    if (!token) {
        throw new PolicyError('No autenticado: Falta el token');
    }

    // 3. Verificar firma y validez del JWT por separado para no enmascarar errores de permisos (403)
    let decoded: any = null;
    try {
        decoded = await strapi.plugin('users-permissions').service('jwt').verify(token);
    } catch (jwtErr: any) {
        console.error('[is-admin policy] Error verificando JWT:', jwtErr.message || jwtErr);
        throw new PolicyError('Token inválido o expirado');
    }

    if (!decoded || !decoded.id) {
        console.error('[is-admin policy] Token inválido: decoded object is null or missing id');
        throw new PolicyError('Token inválido');
    }

    // 4. Buscar al usuario y su rol
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

    // 5. Validar rol del usuario (Fail-Closed por defecto)
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

    if (config?.roles && Array.isArray(config.roles)) {
        // Si la ruta restringe explícitamente a una lista de roles (ej. ['admin'])
        isAllowed = config.roles.includes(roleType) || config.roles.includes(roleName);
    } else if (config?.allowAnyStaff === true) {
        // Cualquier usuario de equipo autenticado (ya excluimos bloqueados y roles públicos/clientes arriba)
        isAllowed = true;
    } else {
        // Determinar permisos requeridos: explícitos en config.permission o inferidos automáticamente del handler/método
        const explicitPerms = config?.permission
            ? Array.isArray(config.permission)
                ? config.permission
                : [config.permission]
            : [];

        const requiredPerms = explicitPerms.length > 0 ? explicitPerms : inferRequiredPermissions(policyContext);
        const roleId = user.role?.id;

        if (roleId && requiredPerms.length > 0) {
            const matchedPerm = await strapi.db.query('plugin::users-permissions.permission').findOne({
                where: {
                    role: roleId,
                    action: { $in: requiredPerms }
                }
            });
            isAllowed = Boolean(matchedPerm);
        } else {
            // Fail-Closed: si no hay permiso explícito ni inferible, solo Super Admin puede ejecutar la operación
            isAllowed = false;
        }
    }

    if (isAllowed) {
        policyContext.state.user = user;
        return true;
    }

    console.error(`[is-admin policy] Acceso denegado: El rol '${userRole}' no tiene permiso para '${policyContext?.state?.route?.handler || policyContext?.request?.url}'.`);
    throw new PolicyError('Acceso denegado: No tienes permisos para realizar esta acción.');
};
