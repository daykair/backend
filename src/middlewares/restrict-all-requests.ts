module.exports = (config, { strapi }) => {
  return async (ctx, next) => {
    const allowedOrigin = 'https://front-saodi.vercel.app';
    const allowedIPs = ['100.64.0.5', '100.64.0.2', '100.64.0.3', '100.64.0.4'];

    // Obtener IP y Origen/Referer del cliente
    const clientIP = ctx.request.ip;
    const origin = ctx.request.headers.origin || ctx.request.headers.referer;
    console.log('Client Origin:', origin);
    console.log('Client IP:', clientIP);
    // Validar si coincide con el origen o IP permitidos
    const isValidOrigin = origin?.startsWith(allowedOrigin);
    const isValidIP = allowedIPs.includes(clientIP);
  

    // Bloquear si no cumple
    if (!isValidOrigin && !isValidIP) {
      return ctx.unauthorized('Acceso no autorizado.');
    }

    await next();
  };
};