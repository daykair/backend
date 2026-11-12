import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::size.size' as any, {
  config: {
    find: { policies: ['global::is-admin'] },
    findOne: { policies: ['global::is-admin'] },
    create: { policies: ['global::is-admin'] },
    update: { policies: ['global::is-admin'] },
    delete: { policies: ['global::is-admin'] },
  },
});

