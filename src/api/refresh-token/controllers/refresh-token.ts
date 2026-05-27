import crypto from 'crypto';

export default {
  async getSessions(ctx: any) {
    try {
      const access = ctx.cookies.get('strapi_jwt');
      if (!access) return ctx.unauthorized('No access token');

      const decoded = await strapi.plugin('users-permissions').service('jwt').verify(access);
      const userId = decoded?.id;
      if (!userId) return ctx.unauthorized();

      const sessions = await strapi.service('api::refresh-token.refresh-token').listForUser(userId);
      // Return only safe fields
      const safe = sessions.map((s: any) => ({
        id: s.id,
        ip: s.ip,
        userAgent: s.userAgent,
        deviceName: s.deviceName,
        expiresAt: s.expiresAt,
        revoked: s.revoked,
        createdAt: s.createdAt,
        replacedBy: s.replacedBy,
      }));
      return ctx.send({ data: safe });
    } catch (err: any) {
      strapi.log.error('getSessions error', err);
      return ctx.unauthorized('Failed to list sessions');
    }
  },

  async revokeSession(ctx: any) {
    const { id } = ctx.params;
    if (!id) return ctx.badRequest('Missing session id');

    try {
      const access = ctx.cookies.get('strapi_jwt');
      if (!access) return ctx.unauthorized('No access token');
      const decoded = await strapi.plugin('users-permissions').service('jwt').verify(access);
      const requesterId = decoded?.id;
      if (!requesterId) return ctx.unauthorized();

      const tokenRow = await strapi.service('api::refresh-token.refresh-token').findById(id);
      if (!tokenRow) return ctx.notFound();

      const ownerId = tokenRow.user && (tokenRow.user.id || tokenRow.user) ? (tokenRow.user.id || tokenRow.user) : tokenRow.user;

      // Allow revoke if owner or if requester is admin
      let isAdmin = false;
      try {
        const requester = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { id: requesterId }, populate: ['role'] });
        const roleType = requester?.role?.type || requester?.role?.name || '';
        isAdmin = ['admin', 'superadmin'].includes(String(roleType).toLowerCase());
      } catch (e) {
        // ignore
      }

      if (String(ownerId) !== String(requesterId) && !isAdmin) {
        return ctx.forbidden('Not allowed');
      }

      await strapi.service('api::refresh-token.refresh-token').revokeById(id);
      return ctx.send({ ok: true });
    } catch (err: any) {
      strapi.log.error('revokeSession error', err);
      return ctx.badRequest(err.message || 'Failed to revoke session');
    }
  }
};
