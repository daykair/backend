export default (config, { strapi }) => {
  return async (ctx, next) => {
    // Si no hay cabecera de autorización pero hay una cookie strapi_jwt,
    // inyectarla en la cabecera para que users-permissions la detecte.
    if (!ctx.request.header.authorization) {
      let token = ctx.cookies.get('strapi_jwt');
      
      if (!token && ctx.request.header.cookie) {
        const match = ctx.request.header.cookie.match(/(?:^|;\s*)strapi_jwt=([^;]*)/);
        if (match) {
          token = match[1];
        }
      }

      if (token) {
        ctx.request.header.authorization = `Bearer ${token}`;
      }
    }
    
    await next();
  };
};
