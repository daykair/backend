import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::exchange-rate.exchange-rate', {
  config: {
    find: {
      auth: false,
    },
  },
});
