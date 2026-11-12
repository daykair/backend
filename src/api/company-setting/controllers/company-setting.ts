import { factories } from '@strapi/strapi';

const EMPTY_PAYMENT_SETTINGS = {
  pagoMovil: {
    enabled: false,
    bank: '',
    phone: '',
    idNumber: '',
    holder: '',
  },
  binance: {
    enabled: false,
    email: '',
    binanceId: '',
    qrImageUrl: '',
  },
  zelle: {
    enabled: false,
    email: '',
    holder: '',
  },
  cashea: {
    enabled: false,
    defaultLevelPct: 60,
    allowZeroInitial: true,
    customPromoEnabled: true,
    badgeText: '3 cuotas sin interés',
  },
};

const EMPTY_BANNER_SETTINGS = {
  slides: [],
  catalogPromo: {
    enabled: false,
    badge: '',
    title: '',
    subtitle: '',
    perk1: '',
    perk2: '',
    perk3: '',
    whatsappText: '',
  },
};

const EMPTY_LOGISTICS_SETTINGS = {
  enablePickupWeb: false,
  enableDeliveryWeb: true,
  enableNationalShippingWeb: true,
  webWarehouseId: null as string | null,
  deliveryZonesText: '',
  deliveryNoteText: '',
  defaultDeliveryCost: 0,
  nationalAgencies: [],
  localCouriers: [],
};

const EMPTY_OPERATIONAL_SETTINGS = {
  lowStockThreshold: 5,
  enableWeighedProducts: false,
  abandonedOrderHours: 24,
  layawayWarningDays: 20,
  layawayExpiredDays: 30,
  whatsappTemplateGeneral:
    'Hola {cliente}, te escribimos respecto a tu pedido #{pedido} ({estado}).',
  whatsappTemplateShipping:
    'Hola {cliente}, tu pedido #{pedido} ({estado}) fue enviado por {agencia} con el número de guía: {guia}.',
  whatsappTemplatePaymentReminder:
    'Hola {cliente}, te recordamos que tu pedido #{pedido} presenta un saldo pendiente de ${saldo}.',
};

export default factories.createCoreController(
  'api::company-setting.company-setting' as any,
  ({ strapi }) => ({
    async getPublicSettings(ctx: any) {
      try {
        const dbQuery = (strapi.db as any).query('api::company-setting.company-setting');
        const setting = await dbQuery.findOne({
          populate: ['logo', 'favicon'],
        });

        if (!setting) {
          return ctx.send({ data: null });
        }

        return ctx.send({
          data: {
            commercialName: setting.commercialName || '',
            businessName: setting.businessName || '',
            phone: setting.phone || '',
            email: setting.email || '',
            address: setting.address || '',
            instagram: setting.instagram || '',
            logo: setting.logo || null,
            favicon: setting.favicon || null,
            paymentSettings: setting.paymentSettings || EMPTY_PAYMENT_SETTINGS,
            bannerSettings: setting.bannerSettings || EMPTY_BANNER_SETTINGS,
            logisticsSettings: setting.logisticsSettings || EMPTY_LOGISTICS_SETTINGS,
            operationalSettings: {
              lowStockThreshold: Number(
                setting.operationalSettings?.lowStockThreshold ??
                  EMPTY_OPERATIONAL_SETTINGS.lowStockThreshold,
              ),
              enableWeighedProducts: Boolean(
                setting.operationalSettings?.enableWeighedProducts ??
                  EMPTY_OPERATIONAL_SETTINGS.enableWeighedProducts,
              ),
            },
          },
        });
      } catch (err: any) {
        console.error('[CompanySetting] Error en getPublicSettings:', err);
        ctx.throw(500, err.message || 'Error al obtener la configuración pública');
      }
    },

    async getAdminSettings(ctx: any) {
      try {
        const dbQuery = (strapi.db as any).query('api::company-setting.company-setting');
        let setting = await dbQuery.findOne({
          populate: ['logo', 'favicon'],
        });

        if (!setting) {
          setting = await dbQuery.create({
            data: {
              commercialName: '',
              businessName: '',
              rif: '',
              logoIncludesTaxInfo: false,
              phone: '',
              email: '',
              address: '',
              instagram: '',
              receiptFooterNote: '',
              paymentSettings: EMPTY_PAYMENT_SETTINGS,
              bannerSettings: EMPTY_BANNER_SETTINGS,
              logisticsSettings: EMPTY_LOGISTICS_SETTINGS,
              operationalSettings: EMPTY_OPERATIONAL_SETTINGS,
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
          commercialName: payload.commercialName ?? existing?.commercialName ?? '',
          businessName: payload.businessName ?? existing?.businessName ?? '',
          rif: payload.rif ?? existing?.rif ?? '',
          logoIncludesTaxInfo:
            payload.logoIncludesTaxInfo !== undefined
              ? Boolean(payload.logoIncludesTaxInfo)
              : Boolean(existing?.logoIncludesTaxInfo),
          phone: payload.phone ?? existing?.phone ?? '',
          email: payload.email ?? existing?.email ?? '',
          address: payload.address ?? existing?.address ?? '',
          instagram: payload.instagram ?? existing?.instagram ?? '',
          receiptFooterNote: payload.receiptFooterNote ?? existing?.receiptFooterNote ?? '',
          paymentSettings:
            payload.paymentSettings ?? existing?.paymentSettings ?? EMPTY_PAYMENT_SETTINGS,
          bannerSettings:
            payload.bannerSettings ?? existing?.bannerSettings ?? EMPTY_BANNER_SETTINGS,
          logisticsSettings:
            payload.logisticsSettings ?? existing?.logisticsSettings ?? EMPTY_LOGISTICS_SETTINGS,
          operationalSettings:
            payload.operationalSettings ??
            existing?.operationalSettings ??
            EMPTY_OPERATIONAL_SETTINGS,
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
