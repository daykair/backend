module.exports = (config, { strapi }) => {
  return async (ctx, next) => {
    const allowedOrigins = ['https://front-saodi.vercel.app', 'http://localhost:3000'];
    const allowedIPs = ['100.64.0.5', '100.64.0.2', '100.64.0.3', '100.64.0.4', '100.64.0.6', '100.64.0.7', '100.64.0.8', '100.64.0.9'];

    // Obtener IP y Origen/Referer del cliente
    const clientIP = ctx.request.ip;
    const origin = ctx.request.headers.origin || ctx.request.headers.referer;
    console.log('Client Origin:', origin);
    console.log('Client IP:', clientIP);
    // Validar si coincide con el origen o IP permitidos
    const isValidOrigin = allowedOrigins.some((allowedOrigin) => allowedOrigin.startsWith(origin));
    const isValidIP = allowedIPs.includes(clientIP);
  

    // Bloquear si no cumple
    if (!isValidOrigin && !isValidIP) {
      return ctx.unauthorized('Acceso no autorizado.');
    }

    await next();
  };
};