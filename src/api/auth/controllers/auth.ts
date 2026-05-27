import crypto from 'crypto';

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ACCESS_TTL_MS = 15 * 60 * 1000; // 15 minutes

function cookieOptions(isRefresh = false) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
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
      // Find user by email or username
      let user = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { email: identifier } });
      if (!user) user = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { username: identifier } });
      
      if (!user) {
        // Prevent timing attacks by performing a dummy hash comparison
        // The dummy hash matches the format of bcrypt
        await bcrypt.compare(password, '$2a$10$wTf2iR0H.P2b3wR5Vb.JbO1kO.2TfP7P7.E1V1r3V.7X.Y.a1T.f2');
        return ctx.unauthorized('Invalid credentials');
      }

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) return ctx.unauthorized('Invalid credentials');

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
};
