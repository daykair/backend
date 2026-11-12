import crypto from 'crypto';
import {
  extractPayloadData,
  SAFE_USER_FIELDS,
  sanitizeUserOutput,
} from '../../../utils/adminCrud';

const ALLOWED_PRICE_TYPES = new Set(['detal', 'mayor']);

async function resolveClientRole(strapi: any) {
  const role = await strapi.db.query('plugin::users-permissions.role').findOne({
    where: {
      $or: [{ type: 'client' }, { name: 'client' }, { name: 'Cliente' }],
    },
    select: ['id', 'name', 'type'],
  });

  if (!role) {
    throw new Error('No se encontró el rol client configurado en Strapi.');
  }
  return role;
}

function buildCustomerLookupWhere(idOrDocId: string, clientRoleId: number) {
  const clean = String(idOrDocId || '').trim();
  const base: Record<string, any> = { role: clientRoleId };
  if (/^\d+$/.test(clean)) {
    base.id = Number(clean);
  } else {
    base.documentId = clean;
  }
  return base;
}

function pickCustomerFields(raw: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  const strKeys = ['username', 'email', 'fullname', 'phone', 'address', 'city', 'state', 'ci'] as const;

  for (const key of strKeys) {
    if (raw[key] !== undefined && raw[key] !== null) {
      out[key] = typeof raw[key] === 'string' ? raw[key].trim() : String(raw[key]).trim();
    }
  }

  if (raw.price_type !== undefined) {
    const normalized = String(raw.price_type || 'detal').trim().toLowerCase();
    out.price_type = ALLOWED_PRICE_TYPES.has(normalized) ? normalized : 'detal';
  }

  return out;
}

export default {
  async findCustomers(ctx: any) {
    try {
      const clientRole = await resolveClientRole(strapi);
      const q = String(ctx.query?.q || '').trim();
      const where: Record<string, any> = { role: clientRole.id };

      if (q) {
        where.$or = [
          { fullname: { $containsi: q } },
          { username: { $containsi: q } },
          { email: { $containsi: q } },
          { ci: { $containsi: q } },
          { phone: { $containsi: q } },
        ];
      }

      const customers = await strapi.db.query('plugin::users-permissions.user').findMany({
        where,
        select: [...SAFE_USER_FIELDS],
        orderBy: { createdAt: 'desc' },
        ...(ctx.query?.limit ? { limit: Math.min(500, Math.max(1, Number(ctx.query.limit))) } : {}),
      });

      return ctx.send({ data: customers.map(sanitizeUserOutput) });
    } catch (err: any) {
      console.error('[CustomerAdmin] Error en findCustomers:', err);
      return ctx.internalServerError(err?.message || 'Error al obtener clientes.');
    }
  },

  async findOneCustomer(ctx: any) {
    try {
      const clientRole = await resolveClientRole(strapi);
      const where = buildCustomerLookupWhere(ctx.params.id, clientRole.id);
      const customer = await strapi.db.query('plugin::users-permissions.user').findOne({
        where,
        select: [...SAFE_USER_FIELDS],
      });

      if (!customer) {
        return ctx.notFound('Cliente no encontrado.');
      }

      return ctx.send({ data: sanitizeUserOutput(customer) });
    } catch (err: any) {
      console.error('[CustomerAdmin] Error en findOneCustomer:', err);
      return ctx.internalServerError(err?.message || 'Error al obtener cliente.');
    }
  },

  async createCustomer(ctx: any) {
    try {
      const clientRole = await resolveClientRole(strapi);
      const raw = extractPayloadData(ctx.request.body);
      const safeFields = pickCustomerFields(raw);

      if (!safeFields.email && !safeFields.phone && !safeFields.fullname && !safeFields.username) {
        return ctx.badRequest('Proporciona al menos un nombre, teléfono o correo para crear el cliente.');
      }

      const cleanPhoneDigits = String(safeFields.phone || '').replace(/\D/g, '');
      const email =
        safeFields.email?.toLowerCase() ||
        `${cleanPhoneDigits || crypto.randomBytes(4).toString('hex')}@cliente.local`;
      const baseUsername =
        safeFields.username ||
        safeFields.fullname?.replace(/\s+/g, '.').toLowerCase() ||
        email.split('@')[0];
      const username =
        baseUsername.length >= 3
          ? baseUsername
          : `cliente_${crypto.randomBytes(3).toString('hex')}`;

      const existing = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: {
          $or: [{ email }, { username }],
        },
        select: ['id', 'email', 'username'],
      });

      if (existing) {
        const suffix = crypto.randomBytes(2).toString('hex');
        if (String(existing.email || '').toLowerCase() === email) {
          return ctx.badRequest('Ya existe una cuenta registrada con ese correo electrónico.');
        }
        safeFields.username = `${username}_${suffix}`;
      } else {
        safeFields.username = username;
      }

      const created = await strapi.plugin('users-permissions').service('user').add({
        ...safeFields,
        email,
        provider: 'local',
        confirmed: true,
        blocked: false,
        role: clientRole.id,
        password: crypto.randomBytes(24).toString('hex'),
      });

      return ctx.send({ data: sanitizeUserOutput(created) });
    } catch (err: any) {
      console.error('[CustomerAdmin] Error en createCustomer:', err);
      return ctx.badRequest(err?.message || 'No se pudo crear el cliente.');
    }
  },

  async updateCustomer(ctx: any) {
    try {
      const clientRole = await resolveClientRole(strapi);
      const where = buildCustomerLookupWhere(ctx.params.id, clientRole.id);
      const existing = await strapi.db.query('plugin::users-permissions.user').findOne({
        where,
        select: ['id', 'email', 'username'],
      });

      if (!existing) {
        return ctx.notFound('Cliente no encontrado.');
      }

      const raw = extractPayloadData(ctx.request.body);
      const safeFields = pickCustomerFields(raw);
      if (safeFields.email) {
        safeFields.email = safeFields.email.toLowerCase();
      }
      if (raw.blocked !== undefined) {
        safeFields.blocked = Boolean(raw.blocked);
      }

      if (safeFields.email || safeFields.username) {
        const conflictOr: any[] = [];
        if (safeFields.email && safeFields.email !== existing.email) {
          conflictOr.push({ email: safeFields.email });
        }
        if (safeFields.username && safeFields.username !== existing.username) {
          conflictOr.push({ username: safeFields.username });
        }
        if (conflictOr.length > 0) {
          const dup = await strapi.db.query('plugin::users-permissions.user').findOne({
            where: {
              id: { $ne: existing.id },
              $or: conflictOr,
            },
            select: ['id'],
          });
          if (dup) {
            return ctx.badRequest('Ese correo o nombre de usuario ya está en uso por otra cuenta.');
          }
        }
      }

      const updated = await strapi.plugin('users-permissions').service('user').edit(existing.id, safeFields);
      return ctx.send({ data: sanitizeUserOutput(updated) });
    } catch (err: any) {
      console.error('[CustomerAdmin] Error en updateCustomer:', err);
      return ctx.badRequest(err?.message || 'No se pudo actualizar el cliente.');
    }
  },
};

