/**
 * product router
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::product.product', {
  config: {
    find: { policies: ['global::is-admin'] },
    findOne: { policies: ['global::is-admin'] },
    create: { policies: ['global::is-admin'] },
    update: { policies: ['global::is-admin'] },
    delete: { policies: ['global::is-admin'] },
  },
});
