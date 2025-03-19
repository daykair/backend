module.exports = (config, { strapi }) => {
  return async (ctx, next) => {
    const allowedOrigin = 'https://front-chi-jet.vercel.app';

    // Obtener IP y Origen/Referer del cliente
    const clientIP = ctx.request.ip;
    const origin = ctx.request.headers.origin || ctx.request.headers.referer;
    console.log(origin);
    // Validar si coincide con el origen o IP permitidos
    const isValidOrigin = origin?.startsWith(allowedOrigin);
  

    // Bloquear si no cumple
    if (!isValidOrigin) {
      return ctx.unauthorized('Acceso no autorizado.');
    }

    await next();
  };
};