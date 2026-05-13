// import type { Core } from '@strapi/strapi';

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register({ strapi }) {
    const userAttributes = strapi.contentType('plugin::users-permissions.user').attributes;
    
    userAttributes.fullname = { type: 'string' };
    userAttributes.phone = { type: 'string' };
    userAttributes.address = { type: 'string' };
    userAttributes.city = { type: 'string' };
    userAttributes.state = { type: 'string' };
    userAttributes.ci = { type: 'string' };
    userAttributes.price_type = { type: 'string', default: 'detal' };
  },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  bootstrap(/* { strapi }: { strapi: Core.Strapi } */) {},
};
