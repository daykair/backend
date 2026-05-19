import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::exchange-rate.exchange-rate', ({ strapi }) => ({
    async sync(ctx) {
        try {
            console.log('[BCV Controller] Forzando sincronización a demanda desde el panel administrativo...');
            const result = await strapi.service('api::exchange-rate.exchange-rate').updateBcvRate();
            return ctx.send({ success: true, data: result });
        } catch (err: any) {
            console.error('[BCV Controller] Error en sincronización a demanda:', err.message);
            return ctx.badRequest('No se pudo sincronizar la tasa en tiempo real: ' + err.message);
        }
    }
}));
