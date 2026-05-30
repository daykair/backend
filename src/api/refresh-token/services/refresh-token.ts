import crypto from 'crypto';

export default ({ strapi }: any) => ({
  async createToken({ tokenHash, userId, expiresAt, ip, userAgent, deviceName }: any) {
    const data: any = {
      tokenHash,
      user: userId,
      expiresAt,
      ip,
      userAgent,
      deviceName,
    };

    const created = await strapi.entityService.create('api::refresh-token.refresh-token', { data });
    return created;
  },

  async findByHash(tokenHash: string) {
    const row = await strapi.db.query('api::refresh-token.refresh-token').findOne({
      where: { tokenHash },
      populate: ['user']
    });
    return row;
  },

  async findById(id: number | string) {
    const row = await strapi.db.query('api::refresh-token.refresh-token').findOne({ where: { id } });
    return row;
  },

  async listForUser(userId: number | string) {
    const rows = await strapi.db.query('api::refresh-token.refresh-token').findMany({ where: { user: userId }, orderBy: { createdAt: 'desc' } });
    return rows;
  },

  async revokeById(id: number | string, opts: any = {}) {
    const data: any = {
      revoked: true,
      revokedAt: new Date(),
    };
    if (opts.replacedBy) data.replacedBy = String(opts.replacedBy);
    return await strapi.entityService.update('api::refresh-token.refresh-token', id, { data });
  },

  async revokeAllForUser(userId: number | string) {
    // Mark all non-revoked tokens as revoked
    await strapi.db.query('api::refresh-token.refresh-token').updateMany({
      where: { user: userId, revoked: false },
      data: { revoked: true, revokedAt: new Date() }
    });
    return true;
  },

  async deleteExpired() {
    try {
      const now = new Date();
      await strapi.db.query('api::refresh-token.refresh-token').deleteMany({ where: { expiresAt: { $lt: now } } });
      return true;
    } catch (e) {
      strapi.log.error('Failed to cleanup expired refresh tokens', e);
      return false;
    }
  }
});
