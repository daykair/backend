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

const EMPTY_REDES_SETTINGS = {
  showStatusBadge: true,
  statusBadge: '¡Estamos activos para ti!',
  headline: '',
  bio: 'Escríbenos para asesorarte o descubre todo lo nuevo en nuestro catálogo.',
  whatsappMessage: '¡Hola {tienda}! Vengo desde sus redes y quisiera más información.',
  footerText: 'Envíos a toda Venezuela',
  publicStoreUrl: '',
  syncFooterAndMenu: true,
  socialProfiles: {
    tiktok: '',
    facebook: '',
    youtube: '',
  },
  useCustomLinks: false,
  links: [] as any[],
};

const VALID_LINK_TYPES = new Set(['internal', 'whatsapp', 'external']);
const VALID_LINK_ICONS = new Set([
  'catalog',
  'whatsapp',
  'instagram',
  'tiktok',
  'facebook',
  'youtube',
  'contact',
  'web',
  'map',
  'sparkles',
]);

function sanitizeSafeHref(rawHref: unknown): string {
  const val = typeof rawHref === 'string' ? rawHref.trim() : '';
  if (!val) return '';
  if (/^(javascript|data|vbscript):/i.test(val)) return '';
  return val;
}

function sanitizeRedesSettings(raw: any) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const rawProfiles = src.socialProfiles && typeof src.socialProfiles === 'object' ? src.socialProfiles : {};
  const rawLinks = Array.isArray(src.links) ? src.links : [];

  const links = rawLinks
    .filter((item: any) => item && typeof item === 'object')
    .map((item: any, idx: number) => ({
      id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `redes-link-${idx + 1}`,
      enabled: item.enabled !== false,
      title: typeof item.title === 'string' ? item.title : '',
      subtitle: typeof item.subtitle === 'string' ? item.subtitle : '',
      linkType: VALID_LINK_TYPES.has(item.linkType) ? item.linkType : 'external',
      href: sanitizeSafeHref(item.href),
      icon: VALID_LINK_ICONS.has(item.icon) ? item.icon : 'web',
      featured: Boolean(item.featured),
      badge: typeof item.badge === 'string' ? item.badge : '',
      pulse: Boolean(item.pulse),
      whatsappText: typeof item.whatsappText === 'string' ? item.whatsappText : '',
    }));

  return {
    showStatusBadge:
      src.showStatusBadge !== undefined
        ? Boolean(src.showStatusBadge)
        : EMPTY_REDES_SETTINGS.showStatusBadge,
    statusBadge:
      typeof src.statusBadge === 'string' ? src.statusBadge : EMPTY_REDES_SETTINGS.statusBadge,
    headline: typeof src.headline === 'string' ? src.headline : EMPTY_REDES_SETTINGS.headline,
    bio: typeof src.bio === 'string' ? src.bio : EMPTY_REDES_SETTINGS.bio,
    whatsappMessage:
      typeof src.whatsappMessage === 'string'
        ? src.whatsappMessage
        : EMPTY_REDES_SETTINGS.whatsappMessage,
    footerText:
      typeof src.footerText === 'string' ? src.footerText : EMPTY_REDES_SETTINGS.footerText,
    publicStoreUrl: sanitizeSafeHref(src.publicStoreUrl),
    syncFooterAndMenu:
      src.syncFooterAndMenu !== undefined
        ? Boolean(src.syncFooterAndMenu)
        : EMPTY_REDES_SETTINGS.syncFooterAndMenu,
    socialProfiles: {
      tiktok: typeof rawProfiles.tiktok === 'string' ? rawProfiles.tiktok.trim() : '',
      facebook: sanitizeSafeHref(rawProfiles.facebook),
      youtube: sanitizeSafeHref(rawProfiles.youtube),
    },
    useCustomLinks: Boolean(src.useCustomLinks),
    links,
  };
}

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
            redesSettings: sanitizeRedesSettings(setting.redesSettings),
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
              redesSettings: EMPTY_REDES_SETTINGS,
              publishedAt: new Date().toISOString(),
            },
            populate: ['logo', 'favicon'],
          });
        }

        return ctx.send({
          data: {
            ...setting,
            redesSettings: sanitizeRedesSettings(setting?.redesSettings),
          },
        });
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
          redesSettings:
            payload.redesSettings !== undefined
              ? sanitizeRedesSettings(payload.redesSettings)
              : sanitizeRedesSettings(existing?.redesSettings),
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
