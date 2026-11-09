import { factories } from '@strapi/strapi';

export default factories.createCoreController(
  'api::company-setting.company-setting' as any,
  ({ strapi }) => ({
    async getAdminSettings(ctx: any) {
      try {
        const dbQuery = (strapi.db as any).query('api::company-setting.company-setting');
        let setting = await dbQuery.findOne({
          populate: ['logo', 'favicon'],
        });

        if (!setting) {
          setting = await dbQuery.create({
            data: {
              commercialName: 'Saodi',
              businessName: '',
              rif: '',
              logoIncludesTaxInfo: false,
              phone: '',
              email: '',
              address: '',
              instagram: '',
              receiptFooterNote: 'Gracias por su compra.',
              publishedAt: new Date().toISOString(),
            },
            populate: ['logo', 'favicon'],
          });
        }

        return ctx.send({ data: setting });
      } catch (err: any) {
        console.error('[CompanySetting] Error en getAdminSettings:', err);
        ctx.throw(500, err.message || 'Error al obtener la configuración de la empresa');
      }
    },

    async updateAdminSettings(ctx: any) {
      try {
        const payload = ctx.request.body?.data || ctx.request.body || {};
        const dbQuery = (strapi.db as any).query('api::company-setting.company-setting');

        const existing = await dbQuery.findOne({
          populate: ['logo', 'favicon'],
        });

        const cleanData: any = {
          commercialName: payload.commercialName ?? existing?.commercialName ?? 'Saodi',
          businessName: payload.businessName ?? existing?.businessName ?? '',
          rif: payload.rif ?? existing?.rif ?? '',
          logoIncludesTaxInfo: Boolean(payload.logoIncludesTaxInfo),
          phone: payload.phone ?? existing?.phone ?? '',
          email: payload.email ?? existing?.email ?? '',
          address: payload.address ?? existing?.address ?? '',
          instagram: payload.instagram ?? existing?.instagram ?? '',
          receiptFooterNote: payload.receiptFooterNote ?? existing?.receiptFooterNote ?? '',
          publishedAt: new Date().toISOString(),
        };

        if (payload.logo !== undefined) {
          cleanData.logo = payload.logo;
        }
        if (payload.favicon !== undefined) {
          cleanData.favicon = payload.favicon;
        }

        let updated;
        if (existing?.id) {
          updated = await dbQuery.update({
            where: { id: existing.id },
            data: cleanData,
            populate: ['logo', 'favicon'],
          });
        } else {
          updated = await dbQuery.create({
            data: cleanData,
            populate: ['logo', 'favicon'],
          });
        }

        return ctx.send({ data: updated });
      } catch (err: any) {
        console.error('[CompanySetting] Error en updateAdminSettings:', err);
        ctx.throw(500, err.message || 'Error al actualizar la configuración de la empresa');
      }
    },
  }),
);
