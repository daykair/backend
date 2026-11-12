import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::exchange-rate.exchange-rate', {
  config: {
    find: {
      auth: false,
    },
    update: { policies: ['global::is-admin'] },
    delete: { policies: ['global::is-admin'] },
  },
});
