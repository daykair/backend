import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::inventory-movement.inventory-movement', {
  only: ['find', 'findOne', 'create'],
  config: {
    find: { policies: ['global::is-admin'] },
    findOne: { policies: ['global::is-admin'] },
    create: { policies: ['global::is-admin'] },
  },
});
