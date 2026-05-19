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
   */
  async bootstrap({ strapi }: { strapi: any }) {
    // 1. Ejecutar una actualización inicial en segundo plano al arrancar si es necesario
    try {
      const existing = await strapi.documents('api::exchange-rate.exchange-rate').findFirst();
      if (!existing || !existing.rate) {
        console.log('[BCV Boot] No se encontró tasa configurada en la BD. Ejecutando raspado inicial de emergencia...');
        // Ejecutar de inmediato de forma asíncrona
        strapi.service('api::exchange-rate.exchange-rate').updateBcvRate().catch((err: any) => {
          console.error('[BCV Boot] Error en raspado inicial:', err.message);
        });
      } else {
        console.log(`[BCV Boot] Tasa de cambio actual cargada desde BD: Bs. ${existing.rate} (Origen: ${existing.source})`);
      }
    } catch (err: any) {
      console.error('[BCV Boot] Error al inicializar tasa en arranque:', err.message);
    }

    // 2. Programar la rutina diaria de raspado a las 12:00 AM (Medianoche) Hora de Caracas
    scheduleDailyBcvUpdate(strapi);
  },
};

function scheduleDailyBcvUpdate(strapi: any) {
  const runUpdate = async () => {
    try {
      console.log('[BCV Cron] Iniciando actualización diaria de la tasa...');
      await strapi.service('api::exchange-rate.exchange-rate').updateBcvRate();
    } catch (err: any) {
      console.error('[BCV Cron] Error en la rutina diaria de raspado:', err.message);
    } finally {
      // Reprogramar para el siguiente día
      scheduleNext();
    }
  };

  const scheduleNext = () => {
    const now = new Date();
    // Obtener la fecha y hora exacta convertida en la zona de Caracas
    const caracasTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Caracas" }));
    
    // Crear el objeto del próximo 12:00 AM (Medianoche) en la zona de Caracas
    const nextMidnight = new Date(caracasTime);
    nextMidnight.setHours(0, 0, 0, 0);

    // Si ya pasó la medianoche de hoy en Caracas, programar para mañana a la medianoche
    if (caracasTime >= nextMidnight) {
      nextMidnight.setDate(nextMidnight.getDate() + 1);
    }

    // Calcular la diferencia en milisegundos
    const delay = nextMidnight.getTime() - caracasTime.getTime();
    console.log(`[BCV Scheduler] Siguiente actualización programada para: ${nextMidnight.toLocaleString("es-VE", { timeZone: "America/Caracas" })} (en ${(delay / 3600000).toFixed(2)} horas)`);

    // Establecer el timer
    setTimeout(runUpdate, delay);
  };

  scheduleNext();
}
