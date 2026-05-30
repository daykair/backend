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

    // 2. Migración / Inicialización Multi-Almacén
    try {
      console.log('[Migration] Verificando almacenes e inicializando migración...');
      let defaultWarehouse = await strapi.db.query('api::warehouse.warehouse').findOne({
        where: { code: 'MAIN' }
      }) as any;

      if (!defaultWarehouse) {
        console.log('[Migration] Creando almacén por defecto "Almacén Principal"...');
        defaultWarehouse = await strapi.documents('api::warehouse.warehouse').create({
          data: {
            name: 'Almacén Principal',
            code: 'MAIN',
            address: 'Sede Principal',
            isActive: true
          },
          status: 'published'
        });
      }

      // Migrar existencias globales de variantes de productos a este almacén
      const colors = await strapi.documents('api::color.color').findMany({
        limit: -1
      });

      const existingStocks = await strapi.documents('api::warehouse-stock.warehouse-stock').findMany({
        populate: ['color', 'warehouse'],
        limit: -1
      }) as any[];

      const existingSet = new Set(existingStocks.map(s => {
        const cId = s.color?.documentId || s.color?.id;
        const wId = s.warehouse?.documentId || s.warehouse?.id;
        return `${cId}_${wId}`;
      }));

      let migrationCount = 0;
      for (const color of colors) {
        const colorKey = `${color.documentId || color.id}_${defaultWarehouse.documentId || defaultWarehouse.id}`;
        if (!existingSet.has(colorKey)) {
          const initialStock = Number(color.stock || 0);
          await strapi.documents('api::warehouse-stock.warehouse-stock').create({
            data: {
              stock: initialStock,
              color: color.documentId || color.id,
              warehouse: defaultWarehouse.documentId || defaultWarehouse.id
            },
            status: 'published'
          });
          migrationCount++;
        }
      }

      if (migrationCount > 0) {
        console.log(`[Migration] Migradas existencias globales de ${migrationCount} variantes al almacén principal "MAIN".`);
      } else {
        console.log('[Migration] No se requirieron migraciones de stock; base de datos al día.');
      }
    } catch (err: any) {
      console.error('[Migration] Error crítico en la migración de inventarios:', err.message);
    }
    // 3. Programar la rutina diaria de raspado a las 12:00 AM (Medianoche) Hora de Caracas
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
