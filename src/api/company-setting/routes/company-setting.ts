import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::company-setting.company-setting' as any, {
  config: {
    find: { policies: ['global::is-admin'] },
    update: { policies: ['global::is-admin'] },
    delete: { policies: ['global::is-admin'] },
  },
});
