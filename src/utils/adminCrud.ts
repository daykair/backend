import { buildAdminFindParams } from './adminQuery';

export const SAFE_USER_FIELDS = [
  'id',
  'documentId',
  'username',
  'email',
  'fullname',
  'phone',
  'address',
  'city',
  'state',
  'ci',
  'price_type',
  'blocked',
  'confirmed',
  'createdAt',
  'updatedAt',
] as const;

export const SAFE_USER_POPULATE = {
  fields: [...SAFE_USER_FIELDS],
};

export const SAFE_USER_DB_POPULATE = {
  select: [...SAFE_USER_FIELDS],
};

const PRIVATE_USER_KEYS = ['password', 'resetPasswordToken', 'confirmationToken'] as const;
const USER_RELATION_KEYS = new Set(['performedBy', 'customer', 'user']);

export function isSuperAdminRole(role: any): boolean {
  if (!role) return false;
  const roleType = String(role.type || '').trim().toLowerCase();
  const roleName = String(role.name || '').trim().toLowerCase();
  if (roleType === 'admin' || roleType === 'super_admin') return true;
  if (!roleType && (roleName === 'admin' || roleName === 'super admin')) return true;
  return false;
}

export function sanitizeUserOutput<T>(user: T): T {
  if (!user || typeof user !== 'object' || Array.isArray(user)) return user;
  const clean: Record<string, any> = { ...(user as Record<string, any>) };
  for (const secretKey of PRIVATE_USER_KEYS) {
    delete clean[secretKey];
  }
  return clean as T;
}

export function sanitizeEntityUserRelations<T>(payload: T, extraKeys: string[] = []): T {
  if (!payload || typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizeEntityUserRelations(item, extraKeys)) as unknown as T;
  }

  const targetKeys = new Set([...USER_RELATION_KEYS, ...extraKeys]);
  const copy: Record<string, any> = { ...(payload as Record<string, any>) };

  for (const key of Object.keys(copy)) {
    if (targetKeys.has(key) && copy[key] !== null && copy[key] !== undefined) {
      copy[key] = Array.isArray(copy[key])
        ? copy[key].map((entry: any) => sanitizeUserOutput(entry))
        : sanitizeUserOutput(copy[key]);
    }
  }

  return copy as T;
}

function clampUserPopulateEntries(
  populateObj: Record<string, any>,
  allowedRootKeys?: Set<string>,
  isRoot = true,
): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(populateObj || {})) {
    if (isRoot && allowedRootKeys && !allowedRootKeys.has(key)) {
      continue;
    }

    if (USER_RELATION_KEYS.has(key)) {
      result[key] = { fields: [...SAFE_USER_FIELDS] };
      continue;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = { ...(value as Record<string, any>) };
      if (nested.populate && typeof nested.populate === 'object' && !Array.isArray(nested.populate)) {
        nested.populate = clampUserPopulateEntries(nested.populate, undefined, false);
      } else if (nested.populate === '*') {
        delete nested.populate;
      }
      result[key] = nested;
    } else if (value === '*' || value === true) {
      result[key] = true;
    }
  }

  return result;
}

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

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clonePopulateValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(clonePopulateValue) as unknown as T;
  }
  if (isPlainObject(value)) {
    const copy: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      copy[key] = clonePopulateValue(val);
    }
    return copy as T;
  }
  return value;
}

function normalizeRelationDescriptor(descriptor: Record<string, any>): Record<string, any> {
  const copy = clonePopulateValue(descriptor);
  if (copy.populate !== undefined && copy.populate !== '*' && typeof copy.populate !== 'boolean') {
    copy.populate = normalizePopulateObject(copy.populate);
  }
  return copy;
}

function applyPopulatePath(
  target: Record<string, any>,
  rawPath: string,
  leafValue: any = true
): void {
  const segments = rawPath
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return;

  let cursor = target;
  for (let i = 0; i < segments.length; i += 1) {
    const key = segments[i];
    if (key === '*') continue;

    if (i === segments.length - 1) {
      if (isPlainObject(leafValue)) {
        const normalizedLeaf = normalizeRelationDescriptor(leafValue);
        cursor[key] = isPlainObject(cursor[key])
          ? mergePopulateObjects(cursor[key], normalizedLeaf)
          : normalizedLeaf;
      } else if (cursor[key] === undefined || leafValue !== true) {
        cursor[key] = clonePopulateValue(leafValue);
      }
      return;
    }

    const existing = cursor[key];
    if (isPlainObject(existing)) {
      cursor[key] = normalizeRelationDescriptor(existing);
      if (!isPlainObject(cursor[key].populate)) {
        cursor[key].populate = {};
      }
    } else {
      cursor[key] = { populate: {} };
    }
    cursor = cursor[key].populate;
  }
}

function normalizePopulateObject(populate: any): Record<string, any> {
  const normalized: Record<string, any> = {};
  if (!populate || populate === '*') return normalized;

  if (typeof populate === 'string') {
    for (const part of populate.split(',')) {
      applyPopulatePath(normalized, part, true);
    }
    return normalized;
  }

  if (Array.isArray(populate)) {
    for (const item of populate) {
      if (typeof item === 'string') {
        for (const part of item.split(',')) {
          applyPopulatePath(normalized, part, true);
        }
      } else if (isPlainObject(item)) {
        Object.assign(normalized, mergePopulateObjects(normalized, normalizePopulateObject(item)));
      }
    }
    return normalized;
  }

  if (isPlainObject(populate)) {
    for (const [key, value] of Object.entries(populate)) {
      if (value === undefined) continue;
      if (key.includes('.')) {
        applyPopulatePath(normalized, key, value);
      } else if (isPlainObject(value)) {
        const descriptor = normalizeRelationDescriptor(value);
        normalized[key] = isPlainObject(normalized[key])
          ? mergePopulateObjects(normalized[key], descriptor)
          : descriptor;
      } else {
        normalized[key] = clonePopulateValue(value);
      }
    }
  }

  return normalized;
}

function mergePopulateObjects(
  base: Record<string, any>,
  override: Record<string, any>
): Record<string, any> {
  const merged = clonePopulateValue(base);

  for (const [key, overrideVal] of Object.entries(override)) {
    if (overrideVal === undefined) continue;
    const baseVal = merged[key];

    if (key === 'populate') {
      if (overrideVal === '*' || typeof overrideVal === 'boolean') {
        merged[key] = overrideVal;
      } else if (isPlainObject(baseVal)) {
        merged[key] = mergePopulateObjects(baseVal, normalizePopulateObject(overrideVal));
      } else {
        merged[key] = normalizePopulateObject(overrideVal);
      }
      continue;
    }

    if (key === 'filters' || key === 'sort' || key === 'fields') {
      merged[key] = clonePopulateValue(overrideVal);
      continue;
    }

    if (isPlainObject(baseVal) && isPlainObject(overrideVal)) {
      merged[key] = mergePopulateObjects(baseVal, overrideVal);
    } else if (isPlainObject(baseVal) && overrideVal === true) {
      merged[key] = clonePopulateValue(baseVal);
    } else {
      merged[key] = clonePopulateValue(overrideVal);
    }
  }

  return merged;
}

export function mergePopulate(
  queryPopulate: any,
  defaultPopulate?: any,
  allowedRootKeys?: string[],
): any {
  const allowedSet = Array.isArray(allowedRootKeys) ? new Set(allowedRootKeys) : undefined;
  const hasDefaults = defaultPopulate !== undefined && defaultPopulate !== null && defaultPopulate !== '*';
  const normalizedDefaults = hasDefaults ? normalizePopulateObject(defaultPopulate) : undefined;

  if (!queryPopulate) {
    return normalizedDefaults ? clampUserPopulateEntries(normalizedDefaults) : undefined;
  }

  if (queryPopulate === '*') {
    return normalizedDefaults ? clampUserPopulateEntries(normalizedDefaults) : undefined;
  }

  const normalizedQuery = clampUserPopulateEntries(
    normalizePopulateObject(queryPopulate),
    allowedSet,
    true,
  );

  if (!normalizedDefaults) {
    return Object.keys(normalizedQuery).length > 0 ? normalizedQuery : undefined;
  }

  return clampUserPopulateEntries(
    mergePopulateObjects(normalizedDefaults, normalizedQuery),
  );
}

export function extractPayloadData(body: any): Record<string, any> {
  if (!body || typeof body !== 'object') return {};
  return body.data && typeof body.data === 'object' && !Array.isArray(body.data)
    ? { ...body.data }
    : { ...body };
}

export async function userHasExactPermission(strapi: any, user: any, action: string): Promise<boolean> {
  if (!user) return false;
  if (isSuperAdminRole(user.role)) return true;

  const roleId = user.role?.id;
  if (!roleId) return false;

  const matched = await strapi.db.query('plugin::users-permissions.permission').findOne({
    where: { role: roleId, action },
  });
  return Boolean(matched);
}

interface AdminCrudOptions {
  defaultPopulate?: any;
  allowedPopulateKeys?: string[];
  defaultStatus?: 'published' | 'draft';
  injectPerformedBy?: boolean;
  forcePublishedStatus?: boolean;
  transactional?: boolean;
  beforeCreate?: (strapi: any, data: Record<string, any>, ctx: any) => Promise<Record<string, any>> | Record<string, any>;
  beforeUpdate?: (strapi: any, documentId: string, data: Record<string, any>, ctx: any) => Promise<Record<string, any>> | Record<string, any>;
  beforeDelete?: (strapi: any, documentId: string, ctx: any) => Promise<void> | void;
}

export function createAdminCrudHandlers(strapi: any, uid: string, options: AdminCrudOptions = {}) {
  return {
    async findAdmin(ctx: any) {
      try {
        const params = buildAdminFindParams(ctx.query);
        const populate = mergePopulate(params.populate, options.defaultPopulate, options.allowedPopulateKeys);
        const status = params.status || options.defaultStatus;
        const entities = await strapi.documents(uid).findMany({
          ...params,
          ...(status ? { status } : {}),
          ...(populate !== undefined ? { populate } : {}),
        });
        return ctx.send({ data: sanitizeEntityUserRelations(entities) });
      } catch (err: any) {
        console.error(`[${uid}] Error en findAdmin:`, err);
        return ctx.internalServerError(err?.message || 'Error consultando registros');
      }
    },

    async findOneAdmin(ctx: any) {
      try {
        const docId = await resolveEntityDocumentId(strapi, uid, ctx.params?.id);
        if (!docId) return ctx.notFound('Registro no encontrado');

        const populate = mergePopulate(ctx.query?.populate, options.defaultPopulate, options.allowedPopulateKeys);
        const entity = await strapi.documents(uid).findOne({
          documentId: docId,
          ...(populate !== undefined ? { populate } : {}),
        });
        if (!entity) return ctx.notFound('Registro no encontrado');
        return ctx.send({ data: sanitizeEntityUserRelations(entity) });
      } catch (err: any) {
        console.error(`[${uid}] Error en findOneAdmin:`, err);
        return ctx.internalServerError(err?.message || 'Error consultando registro');
      }
    },

    async createAdmin(ctx: any) {
      try {
        const executeCreate = async () => {
          let data = extractPayloadData(ctx.request.body);

          if (options.injectPerformedBy && ctx.state?.user?.id && data.performedBy === undefined) {
            data.performedBy = ctx.state.user.id;
          }
          if (options.beforeCreate) {
            data = await options.beforeCreate(strapi, data, ctx);
          }

          const populate = mergePopulate(ctx.query?.populate, options.defaultPopulate, options.allowedPopulateKeys);
          return strapi.documents(uid).create({
            data,
            ...(options.forcePublishedStatus ? { status: 'published' } : {}),
            ...(populate !== undefined ? { populate } : {}),
          });
        };

        const created = options.transactional
          ? await strapi.db.transaction(executeCreate)
          : await executeCreate();
        return ctx.send({ data: sanitizeEntityUserRelations(created) });
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
        const executeUpdate = async () => {
          const docId = await resolveEntityDocumentId(strapi, uid, ctx.params?.id);
          if (!docId) {
            const notFoundErr: any = new Error('Registro no encontrado');
            notFoundErr.status = 404;
            throw notFoundErr;
          }

          let data = extractPayloadData(ctx.request.body);
          if (options.beforeUpdate) {
            data = await options.beforeUpdate(strapi, docId, data, ctx);
          }

          const populate = mergePopulate(ctx.query?.populate, options.defaultPopulate, options.allowedPopulateKeys);
          return strapi.documents(uid).update({
            documentId: docId,
            data,
            ...(options.forcePublishedStatus ? { status: 'published' } : {}),
            ...(populate !== undefined ? { populate } : {}),
          });
        };

        const updated = options.transactional
          ? await strapi.db.transaction(executeUpdate)
          : await executeUpdate();
        return ctx.send({ data: sanitizeEntityUserRelations(updated) });
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

        if (options.beforeDelete) {
          await options.beforeDelete(strapi, docId, ctx);
        }

        const deleted = await strapi.documents(uid).delete({ documentId: docId });
        return ctx.send({ data: deleted });
      } catch (err: any) {
        const status = err?.status || err?.statusCode;
        if (status && status >= 400 && status < 500) {
          return ctx.throw(status, err.message || 'Solicitud inválida');
        }
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
  const baseHandler = uid;

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
