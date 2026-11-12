import crypto from 'crypto';
import { normalizeComparablePhone } from '../../order/utils/publicOrder';

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ACCESS_TTL_MS = 15 * 60 * 1000; // 15 minutes

function cookieOptions(isRefresh = false) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: isRefresh ? REFRESH_TTL_MS : ACCESS_TTL_MS,
    path: '/',
  };
}

export default {
  async localWithCookie(ctx: any) {
    const { identifier, password } = ctx.request.body || {};
    if (!identifier || !password) return ctx.badRequest('identifier and password are required');

    try {
      const bcrypt = require('bcryptjs');
      // Find user by email or username with role populated
      let user = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { email: identifier.toLowerCase().trim() },
        populate: ['role'],
      });
      if (!user) {
        user = await strapi.db.query('plugin::users-permissions.user').findOne({
          where: { username: identifier.trim() },
          populate: ['role'],
        });
      }
      
      if (!user) {
        // Prevent timing attacks by performing a dummy hash comparison
        // The dummy hash matches the format of bcrypt
        await bcrypt.compare(password, '$2a$10$wTf2iR0H.P2b3wR5Vb.JbO1kO.2TfP7P7.E1V1r3V.7X.Y.a1T.f2');
        return ctx.unauthorized('Credenciales inválidas');
      }

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) return ctx.unauthorized('Credenciales inválidas');

      if (user.blocked) {
        return ctx.forbidden('Tu cuenta ha sido suspendida o bloqueada. Contacta al administrador.');
      }

      const forbiddenRoles = ['public', 'client', 'cliente', 'customer', 'authenticated'];
      const userRole = (user.role?.type || user.role?.name || '').toLowerCase();
      if (forbiddenRoles.includes(userRole)) {
        return ctx.forbidden('Esta cuenta no tiene privilegios para acceder al panel administrativo.');
      }

      // Issue short-lived access JWT
      const accessJwt = await strapi.plugin('users-permissions').service('jwt').issue({ id: user.id });

      // Generate refresh token (raw + hash) and persist hash
      const refreshRaw = crypto.randomBytes(64).toString('hex');
      const refreshHash = crypto.createHash('sha256').update(refreshRaw).digest('hex');

      const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
      const ua = ctx.request.header && ctx.request.header['user-agent'] ? ctx.request.header['user-agent'] : '';
      const ip = ctx.request.ip || ctx.request.header['x-forwarded-for'] || '';

      const created = await strapi.service('api::refresh-token.refresh-token').createToken({
        tokenHash: refreshHash,
        userId: user.id,
        expiresAt,
        ip,
        userAgent: ua,
        deviceName: ua,
      });

      // Set cookies: access and refresh
      ctx.cookies.set('strapi_jwt', accessJwt, cookieOptions(false));
      ctx.cookies.set('refresh_token', refreshRaw, cookieOptions(true));

      const safeUser = { ...user };
      if (safeUser.password) delete safeUser.password;
      return ctx.send({ user: safeUser });
    } catch (err: any) {
      strapi.log.error('Auth localWithCookie error', err);
      return ctx.badRequest(err.message || 'Login failed');
    }
  },

  async refresh(ctx: any) {
    try {
      const raw = ctx.cookies.get('refresh_token');
      if (!raw) return ctx.unauthorized('No refresh token');

      const hash = crypto.createHash('sha256').update(raw).digest('hex');
      const tokenRow = await strapi.service('api::refresh-token.refresh-token').findByHash(hash);

      if (!tokenRow) {
        return ctx.unauthorized('Invalid refresh token');
      }

      if (tokenRow.revoked) {
        // Add a 15-second grace period for concurrent refresh requests
        const revokedTime = tokenRow.revokedAt ? new Date(tokenRow.revokedAt).getTime() : 0;
        if (Date.now() - revokedTime < 15000) {
          // It was recently revoked, likely a concurrent refresh request.
          // Don't revoke everything, just deny this specific attempt so the client retries with the new token.
          return ctx.unauthorized('Concurrent refresh detected');
        }

        // Possible token reuse / theft: revoke all user's tokens
        try {
          const userId = tokenRow.user && (tokenRow.user.id || tokenRow.user) ? (tokenRow.user.id || tokenRow.user) : null;
          if (userId) await strapi.service('api::refresh-token.refresh-token').revokeAllForUser(userId);
        } catch (e) {
          strapi.log.error('Failed to revoke tokens after reuse detection', e);
        }
        // Clear cookies
        ctx.cookies.set('refresh_token', '', { httpOnly: true, expires: new Date(0), path: '/' });
        ctx.cookies.set('strapi_jwt', '', { httpOnly: true, expires: new Date(0), path: '/' });
        return ctx.unauthorized('Refresh token reuse detected');
      }

      if (tokenRow.expiresAt && new Date(tokenRow.expiresAt) < new Date()) {
        // expired
        await strapi.service('api::refresh-token.refresh-token').revokeById(tokenRow.id);
        ctx.cookies.set('refresh_token', '', { httpOnly: true, expires: new Date(0), path: '/' });
        return ctx.unauthorized('Refresh token expired');
      }

      const userId = tokenRow.user?.id || tokenRow.user || tokenRow.userId;

      if (!userId) {
        strapi.log.error('Token found but userId is missing/undefined in the token row');
        return ctx.unauthorized('Invalid token payload');
      }

      // Check if user still exists and is not blocked
      const user = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { id: userId } });
      if (!user || user.blocked) {
        // Revoke the token if user is invalid
        await strapi.service('api::refresh-token.refresh-token').revokeById(tokenRow.id);
        ctx.cookies.set('refresh_token', '', { httpOnly: true, expires: new Date(0), path: '/' });
        return ctx.unauthorized('User is blocked or deleted');
      }

      // Rotate: create new refresh token, revoke old
      const newRaw = crypto.randomBytes(64).toString('hex');
      const newHash = crypto.createHash('sha256').update(newRaw).digest('hex');
      const newExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);

      const created = await strapi.service('api::refresh-token.refresh-token').createToken({
        tokenHash: newHash,
        userId,
        expiresAt: newExpiresAt,
        ip: ctx.request.ip || '',
        userAgent: ctx.request.header && ctx.request.header['user-agent'] ? ctx.request.header['user-agent'] : '',
        deviceName: ctx.request.header && ctx.request.header['user-agent'] ? ctx.request.header['user-agent'] : '',
      });

      // Revoke old token and set replacedBy
      try {
        await strapi.service('api::refresh-token.refresh-token').revokeById(tokenRow.id, { replacedBy: created.id });
      } catch (e) {
        strapi.log.error('Failed to revoke old refresh token', e);
      }

      // Issue new access token
      const newAccess = await strapi.plugin('users-permissions').service('jwt').issue({ id: userId });

      // Set cookies
      ctx.cookies.set('strapi_jwt', newAccess, cookieOptions(false));
      ctx.cookies.set('refresh_token', newRaw, cookieOptions(true));

      return ctx.send({ ok: true });
    } catch (err: any) {
      strapi.log.error('Auth refresh error', err);
      return ctx.unauthorized('Invalid refresh request');
    }
  },

  async logout(ctx: any) {
    try {
      const raw = ctx.cookies.get('refresh_token');
      if (raw) {
        const hash = crypto.createHash('sha256').update(raw).digest('hex');
        const tokenRow = await strapi.service('api::refresh-token.refresh-token').findByHash(hash);
        if (tokenRow) {
          try {
            await strapi.service('api::refresh-token.refresh-token').revokeById(tokenRow.id);
          } catch (e) {
            strapi.log.error('Failed to revoke refresh token on logout', e);
          }
        }
      }

      ctx.cookies.set('refresh_token', '', { httpOnly: true, expires: new Date(0), path: '/' });
      ctx.cookies.set('strapi_jwt', '', { httpOnly: true, expires: new Date(0), path: '/' });
      return ctx.send({ ok: true });
    } catch (err: any) {
      strapi.log.error('Auth logout error', err);
      return ctx.badRequest(err.message || 'Logout failed');
    }
  },

  async changeOwnPassword(ctx: any) {
    const { currentPassword, newPassword } = ctx.request.body || {};
    if (!currentPassword || !newPassword) {
      return ctx.badRequest('Debes ingresar tu contraseña actual y la nueva contraseña.');
    }
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return ctx.badRequest('La nueva contraseña debe tener al menos 6 caracteres.');
    }

    try {
      let token = '';
      if (ctx.request.header?.authorization) {
        token = ctx.request.header.authorization.replace('Bearer ', '').trim();
      } else if (ctx.cookies?.get('strapi_jwt')) {
        token = ctx.cookies.get('strapi_jwt') || '';
      }

      if (!token) {
        return ctx.unauthorized('No autenticado.');
      }

      const decoded = await strapi.plugin('users-permissions').service('jwt').verify(token);
      if (!decoded?.id) {
        return ctx.unauthorized('Sesión inválida.');
      }

      const user = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { id: decoded.id },
      });

      if (!user || user.blocked) {
        return ctx.forbidden('Usuario no válido o bloqueado.');
      }

      const bcrypt = require('bcryptjs');
      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) {
        return ctx.badRequest('La contraseña actual es incorrecta.');
      }

      await strapi.plugin('users-permissions').service('user').edit(user.id, {
        password: newPassword,
      });

      return ctx.send({ message: 'Contraseña actualizada exitosamente.' });
    } catch (err: any) {
      strapi.log.error('changeOwnPassword error', err);
      return ctx.badRequest(err.message || 'No se pudo cambiar la contraseña.');
    }
  },

  async verifyInvite(ctx: any) {
    const token = ctx.request.query?.token;
    if (!token || typeof token !== 'string') {
      return ctx.badRequest('Enlace de invitación no válido.');
    }

    try {
      const decoded = await strapi.plugin('users-permissions').service('jwt').verify(token);
      if (!decoded?.id || decoded.purpose !== 'set-password' || !decoded.nonce) {
        return ctx.badRequest('El enlace de invitación es inválido o ha expirado.');
      }

      const user = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { id: decoded.id },
        populate: ['role'],
      });

      if (!user || user.blocked) {
        return ctx.badRequest('La cuenta asociada no está disponible.');
      }

      if (!user.resetPasswordToken || user.resetPasswordToken !== decoded.nonce) {
        return ctx.badRequest('Este enlace ya fue utilizado o ha sido reemplazado por uno nuevo.');
      }

      return ctx.send({
        valid: true,
        username: user.username,
        email: user.email,
        roleName: user.role?.name || 'Equipo',
      });
    } catch (err: any) {
      return ctx.badRequest('El enlace temporal ha expirado o no es válido.');
    }
  },

  async completeInvite(ctx: any) {
    const { token, password } = ctx.request.body || {};
    if (!token || !password) {
      return ctx.badRequest('Faltan datos para establecer la contraseña.');
    }
    if (typeof password !== 'string' || password.length < 6) {
      return ctx.badRequest('La contraseña debe tener al menos 6 caracteres.');
    }

    try {
      const decoded = await strapi.plugin('users-permissions').service('jwt').verify(token);
      if (!decoded?.id || decoded.purpose !== 'set-password' || !decoded.nonce) {
        return ctx.badRequest('El enlace de invitación es inválido o ha expirado.');
      }

      const user = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { id: decoded.id },
      });

      if (!user || user.blocked) {
        return ctx.badRequest('La cuenta asociada no está disponible.');
      }

      if (!user.resetPasswordToken || user.resetPasswordToken !== decoded.nonce) {
        return ctx.badRequest('Este enlace ya fue utilizado anteriormente.');
      }

      await strapi.plugin('users-permissions').service('user').edit(user.id, {
        password,
        resetPasswordToken: null,
        confirmed: true,
      });

      return ctx.send({
        ok: true,
        message: 'Contraseña establecida exitosamente. Ya puedes iniciar sesión.',
      });
    } catch (err: any) {
      return ctx.badRequest('El enlace temporal ha expirado o no es válido.');
    }
  },

  async customerLogin(ctx: any) {
    const { identifier, password } = ctx.request.body || {};
    if (!identifier || !password) {
      return ctx.badRequest('Ingresa tu correo/usuario y contraseña.');
    }

    try {
      const bcrypt = require('bcryptjs');
      const cleanId = String(identifier).trim();
      let user = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { email: cleanId.toLowerCase() },
        populate: ['role'],
      });
      if (!user) {
        user = await strapi.db.query('plugin::users-permissions.user').findOne({
          where: { username: cleanId },
          populate: ['role'],
        });
      }

      if (!user) {
        await bcrypt.compare(password, '$2a$10$wTf2iR0H.P2b3wR5Vb.JbO1kO.2TfP7P7.E1V1r3V.7X.Y.a1T.f2');
        return ctx.unauthorized('Credenciales inválidas.');
      }

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return ctx.unauthorized('Credenciales inválidas.');
      }

      const roleType = String(user.role?.type || '').toLowerCase();
      const roleName = String(user.role?.name || '').toLowerCase();
      const allowedCustomerRoles = new Set(['client', 'cliente', 'customer', 'authenticated']);
      if (!allowedCustomerRoles.has(roleType) && !allowedCustomerRoles.has(roleName)) {
        return ctx.forbidden('Las cuentas administrativas no pueden iniciar sesión desde la tienda.');
      }

      if (user.blocked) {
        return ctx.forbidden('Tu cuenta ha sido suspendida. Contacta con soporte.');
      }

      const jwt = await strapi.plugin('users-permissions').service('jwt').issue({ id: user.id });

      return ctx.send({
        jwt,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          phone: user.phone || '',
          fullname: user.fullname || user.name || '',
        },
      });
    } catch (err: any) {
      strapi.log.error('customerLogin error', err);
      return ctx.badRequest(err?.message || 'No se pudo iniciar sesión.');
    }
  },

  async customerRegister(ctx: any) {
    const { fullname, name, email, phone, password } = ctx.request.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanName = String(fullname || name || '').trim();
    const cleanPhone = String(phone || '').trim();
    const cleanPassword = String(password || '');

    if (cleanName.length < 2) {
      return ctx.badRequest('Ingresa tu nombre completo.');
    }
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.endsWith('@cliente.local')) {
      return ctx.badRequest('Ingresa un correo electrónico válido.');
    }
    if (cleanPhone.replace(/\D/g, '').length < 7) {
      return ctx.badRequest('Ingresa un número de teléfono válido.');
    }
    if (cleanPassword.length < 6) {
      return ctx.badRequest('La contraseña debe tener al menos 6 caracteres.');
    }

    try {
      const existingEmail = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { email: cleanEmail },
        select: ['id'],
      });
      if (existingEmail) {
        return ctx.badRequest('Ya existe una cuenta registrada con este correo.');
      }

      let clientRole = await strapi.db.query('plugin::users-permissions.role').findOne({
        where: { type: 'client' },
        select: ['id'],
      });
      if (!clientRole) {
        clientRole = await strapi.db.query('plugin::users-permissions.role').findOne({
          where: { type: 'authenticated' },
          select: ['id'],
        });
      }
      if (!clientRole) {
        return ctx.internalServerError('No hay rol de cliente configurado en el sistema.');
      }

      const baseUsername =
        cleanEmail
          .split('@')[0]
          .replace(/[^a-zA-Z0-9._-]/g, '')
          .slice(0, 24) || 'cliente';
      let username = baseUsername;
      const usernameExists = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { username },
        select: ['id'],
      });
      if (usernameExists) {
        username = `${baseUsername}-${crypto.randomBytes(2).toString('hex')}`;
      }

      const newUser = await strapi.plugin('users-permissions').service('user').add({
        username,
        email: cleanEmail,
        password: cleanPassword,
        phone: cleanPhone,
        fullname: cleanName,
        name: cleanName,
        role: clientRole.id,
        confirmed: true,
        blocked: false,
        provider: 'local',
      });

      // Solo vincular órdenes previas hechas como invitado si coinciden correo Y teléfono normalizado
      const targetPhoneDigits = normalizeComparablePhone(cleanPhone);
      if (targetPhoneDigits.length >= 7) {
        const priorOrders: any[] = await strapi.db.query('api::order.order').findMany({
          where: { email: cleanEmail },
          populate: {
            customer: { select: ['id', 'email'] },
          },
        });
        for (const ord of priorOrders) {
          const custEmail = String(ord?.customer?.email || '').toLowerCase();
          const ordPhoneDigits = normalizeComparablePhone(ord?.phone);
          const phonesMatch = ordPhoneDigits.length >= 7 && ordPhoneDigits === targetPhoneDigits;
          if (phonesMatch && (!ord.customer || custEmail.endsWith('@cliente.local'))) {
            await strapi.db.query('api::order.order').update({
              where: { id: ord.id },
              data: { customer: newUser.id },
            });
          }
        }
      }

      const jwt = await strapi.plugin('users-permissions').service('jwt').issue({ id: newUser.id });

      return ctx.send({
        jwt,
        user: {
          id: newUser.id,
          username: newUser.username,
          email: newUser.email,
          phone: newUser.phone || cleanPhone,
          fullname: newUser.fullname || cleanName,
        },
      });
    } catch (err: any) {
      strapi.log.error('customerRegister error', err);
      return ctx.badRequest(err?.message || 'No se pudo completar el registro.');
    }
  },

  async customerMe(ctx: any) {
    try {
      const authHeader = String(ctx.request.header?.authorization || '');
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      const cookieToken = ctx.cookies?.get('store_customer_jwt') || '';
      const token = bearer || cookieToken;
      if (!token) {
        return ctx.unauthorized('No autenticado.');
      }

      const decoded = await strapi.plugin('users-permissions').service('jwt').verify(token).catch(() => null);
      if (!decoded?.id) {
        return ctx.unauthorized('Sesión inválida o expirada.');
      }

      const user = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { id: decoded.id },
        select: ['id', 'username', 'email', 'phone', 'fullname', 'name', 'blocked'],
      });
      if (!user || user.blocked) {
        return ctx.unauthorized('Cuenta no disponible.');
      }

      return ctx.send({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          phone: user.phone || '',
          fullname: user.fullname || user.name || '',
        },
      });
    } catch (err: any) {
      return ctx.unauthorized('No autenticado.');
    }
  },
};
