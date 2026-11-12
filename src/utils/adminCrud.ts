import { buildAdminFindParams } from './adminQuery';

export async function resolveEntityDocumentId(
  strapi: any,
  uid: string,
  idOrDocId: string | number | undefined | null,
): Promise<string | null> {
  if (idOrDocId === undefined || idOrDocId === null || idOrDocId === '') return null;
  const raw = String(idOrDocId).trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const entity = await strapi.documents(uid).findFirst({
      filters: { id: Number(raw) } as any,
    });
    return entity?.documentId || null;
  }

  const entity = await strapi.documents(uid).findOne({ documentId: raw });
  return entity?.documentId || null;
}

export function mergePopulate(queryPopulate: any, defaultPopulate?: any): any {
  if (!defaultPopulate) return queryPopulate;
  if (!queryPopulate) return defaultPopulate;
  if (queryPopulate === '*') return '*';

  if (Array.isArray(defaultPopulate)) {
    if (Array.isArray(queryPopulate)) {
      return Array.from(new Set([...defaultPopulate, ...queryPopulate]));
    }
    if (typeof queryPopulate === 'string') {
      return Array.from(new Set([...defaultPopulate, queryPopulate]));
    }
    if (typeof queryPopulate === 'object') {
      const merged: Record<string, any> = { ...queryPopulate };
      for (const rel of defaultPopulate) {
        if (merged[rel] === undefined) merged[rel] = true;
      }
      return merged;
    }
  }

  if (typeof defaultPopulate === 'object' && typeof queryPopulate === 'object' && !Array.isArray(queryPopulate)) {
    return { ...defaultPopulate, ...queryPopulate };
  }

  return queryPopulate;
}

export function extractPayloadData(body: any): Record<string, any> {
  if (!body || typeof body !== 'object') return {};
  return body.data && typeof body.data === 'object' && !Array.isArray(body.data)
    ? { ...body.data }
    : { ...body };
}

export async function userHasExactPermission(strapi: any, user: any, action: string): Promise<boolean> {
  if (!user) return false;
  const roleType = String(user.role?.type || '').toLowerCase();
  const roleName = String(user.role?.name || '').toLowerCase();
  const isSuperAdmin = roleType === 'admin' || roleType.includes('admin') || roleName.includes('admin');
  if (isSuperAdmin) return true;

  const roleId = user.role?.id;
  if (!roleId) return false;

  const matched = await strapi.db.query('plugin::users-permissions.permission').findOne({
    where: { role: roleId, action },
  });
  return Boolean(matched);
}

interface AdminCrudOptions {
  defaultPopulate?: any;
  defaultStatus?: 'published' | 'draft';
  injectPerformedBy?: boolean;
  forcePublishedStatus?: boolean;
  beforeCreate?: (strapi: any, data: Record<string, any>, ctx: any) => Promise<Record<string, any>> | Record<string, any>;
  beforeUpdate?: (strapi: any, documentId: string, data: Record<string, any>, ctx: any) => Promise<Record<string, any>> | Record<string, any>;
}

export function createAdminCrudHandlers(strapi: any, uid: string, options: AdminCrudOptions = {}) {
  return {
    async findAdmin(ctx: any) {
      try {
        const params = buildAdminFindParams(ctx.query);
        const populate = mergePopulate(params.populate, options.defaultPopulate);
        const status = params.status || options.defaultStatus;
        const entities = await strapi.documents(uid).findMany({
          ...params,
          ...(status ? { status } : {}),
          ...(populate !== undefined ? { populate } : {}),
        });
        return ctx.send({ data: entities });
      } catch (err: any) {
        console.error(`[${uid}] Error en findAdmin:`, err);
        return ctx.internalServerError(err?.message || 'Error consultando registros');
      }
    },

    async findOneAdmin(ctx: any) {
      try {
        const docId = await resolveEntityDocumentId(strapi, uid, ctx.params?.id);
        if (!docId) return ctx.notFound('Registro no encontrado');

        const populate = mergePopulate(ctx.query?.populate, options.defaultPopulate);
        const entity = await strapi.documents(uid).findOne({
          documentId: docId,
          ...(populate !== undefined ? { populate } : {}),
        });
        if (!entity) return ctx.notFound('Registro no encontrado');
        return ctx.send({ data: entity });
      } catch (err: any) {
        console.error(`[${uid}] Error en findOneAdmin:`, err);
        return ctx.internalServerError(err?.message || 'Error consultando registro');
      }
    },

    async createAdmin(ctx: any) {
      try {
        let data = extractPayloadData(ctx.request.body);

        if (options.injectPerformedBy && ctx.state?.user?.id && data.performedBy === undefined) {
          data.performedBy = ctx.state.user.id;
        }
        if (options.beforeCreate) {
          data = await options.beforeCreate(strapi, data, ctx);
        }

        const populate = mergePopulate(ctx.query?.populate, options.defaultPopulate);
        const created = await strapi.documents(uid).create({
          data,
          ...(options.forcePublishedStatus ? { status: 'published' } : {}),
          ...(populate !== undefined ? { populate } : {}),
        });
        return ctx.send({ data: created });
      } catch (err: any) {
        const status = err?.status || err?.statusCode;
        if (status && status >= 400 && status < 500) {
          return ctx.throw(status, err.message || 'Solicitud inválida');
        }
        console.error(`[${uid}] Error en createAdmin:`, err);
        return ctx.badRequest(err?.message || 'Error al crear registro');
      }
    },

    async updateAdmin(ctx: any) {
      try {
        const docId = await resolveEntityDocumentId(strapi, uid, ctx.params?.id);
        if (!docId) return ctx.notFound('Registro no encontrado');

        let data = extractPayloadData(ctx.request.body);
        if (options.beforeUpdate) {
          data = await options.beforeUpdate(strapi, docId, data, ctx);
        }

        const populate = mergePopulate(ctx.query?.populate, options.defaultPopulate);
        const updated = await strapi.documents(uid).update({
          documentId: docId,
          data,
          ...(options.forcePublishedStatus ? { status: 'published' } : {}),
          ...(populate !== undefined ? { populate } : {}),
        });
        return ctx.send({ data: updated });
      } catch (err: any) {
        const status = err?.status || err?.statusCode;
        if (status && status >= 400 && status < 500) {
          return ctx.throw(status, err.message || 'Solicitud inválida');
        }
        console.error(`[${uid}] Error en updateAdmin:`, err);
        return ctx.badRequest(err?.message || 'Error al actualizar registro');
      }
    },

    async deleteAdmin(ctx: any) {
      try {
        const docId = await resolveEntityDocumentId(strapi, uid, ctx.params?.id);
        if (!docId) return ctx.notFound('Registro no encontrado');

        const deleted = await strapi.documents(uid).delete({ documentId: docId });
        return ctx.send({ data: deleted });
      } catch (err: any) {
        console.error(`[${uid}] Error en deleteAdmin:`, err);
        return ctx.badRequest(err?.message || 'Error al eliminar registro');
      }
    },
  };
}

/**
 * Helper to create Strapi v5 custom route configs with `global::is-admin`
 */
export function buildAdminRoutes(
  basePath: string,
  uid: string,
  actions: Array<'find' | 'findOne' | 'create' | 'update' | 'delete'> = ['find', 'findOne', 'create', 'update', 'delete'],
  extraCreatePerms: string[] = [],
) {
  const routes: any[] = [];
  const baseHandler = `${uid}.${uid.split('.').pop()}`;

  if (actions.includes('find')) {
    routes.push({
      method: 'GET',
      path: basePath,
      handler: `${baseHandler}.findAdmin`,
      config: {
        auth: false,
        policies: [{ name: 'global::is-admin', config: { permission: `${uid}.find` } }],
      },
    });
  }
  if (actions.includes('findOne')) {
    routes.push({
      method: 'GET',
      path: `${basePath}/:id`,
      handler: `${baseHandler}.findOneAdmin`,
      config: {
        auth: false,
        policies: [{ name: 'global::is-admin', config: { permission: [`${uid}.find`, `${uid}.findOne`] } }],
      },
    });
  }
  if (actions.includes('create')) {
    const perm = extraCreatePerms.length > 0 ? [`${uid}.create`, ...extraCreatePerms] : `${uid}.create`;
    routes.push({
      method: 'POST',
      path: basePath,
      handler: `${baseHandler}.createAdmin`,
      config: {
        auth: false,
        policies: [{ name: 'global::is-admin', config: { permission: perm } }],
      },
    });
  }
  if (actions.includes('update')) {
    routes.push({
      method: 'PUT',
      path: `${basePath}/:id`,
      handler: `${baseHandler}.updateAdmin`,
      config: {
        auth: false,
        policies: [{ name: 'global::is-admin', config: { permission: `${uid}.update` } }],
      },
    });
  }
  if (actions.includes('delete')) {
    routes.push({
      method: 'DELETE',
      path: `${basePath}/:id`,
      handler: `${baseHandler}.deleteAdmin`,
      config: {
        auth: false,
        policies: [{ name: 'global::is-admin', config: { permission: `${uid}.delete` } }],
      },
    });
  }
  return routes;
}
