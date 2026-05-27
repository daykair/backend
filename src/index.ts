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

    // 2.2 Migración de órdenes JSON a relacional
    try {
      await migrateOrdersJsonToRelational(strapi);
    } catch (err: any) {
      console.error('[Migration] Error al migrar órdenes JSON a relacional:', err.message);
    }

    // 3. Programar la rutina diaria de raspado a las 12:00 AM (Medianoche) Hora de Caracas
    scheduleDailyBcvUpdate(strapi);
  },
};

async function migrateOrdersJsonToRelational(strapi: any) {
  console.log('[Migration] Verificando órdenes para migración de JSON a relacional...');
  
  // Buscar todas las órdenes de la BD. Usamos db.query para traer los campos directos de la BD.
  const orders = await strapi.db.query('api::order.order').findMany({
    populate: ['orderItems', 'payments']
  }) as any[];

  let migratedCount = 0;

  for (const order of orders) {
    const hasItems = order.orderItems && order.orderItems.length > 0;
    const hasPayments = order.payments && order.payments.length > 0;

    // Si ya tiene ítems o pagos relacionados, omitimos para evitar duplicación
    if (hasItems || hasPayments) {
      continue;
    }

    // Parsear items desde order.order (JSON)
    let jsonItems: any[] = [];
    if (order.order) {
      if (typeof order.order === 'string') {
        try {
          jsonItems = JSON.parse(order.order);
        } catch (e: any) {
          console.error(`[Migration] Error al parsear order JSON para orden #${order.id}:`, e.message);
        }
      } else if (Array.isArray(order.order)) {
        jsonItems = order.order;
      }
    }

    // Parsear pagos desde order.payments (JSON)
    let jsonPayments: any[] = [];
    if (order.payments) {
      if (typeof order.payments === 'string') {
        try {
          jsonPayments = JSON.parse(order.payments);
        } catch (e: any) {
          console.error(`[Migration] Error al parsear payments JSON para orden #${order.id}:`, e.message);
        }
      } else if (Array.isArray(order.payments)) {
        jsonPayments = order.payments;
      }
    }

    if (jsonItems.length === 0 && jsonPayments.length === 0) {
      continue;
    }

    try {
      await strapi.db.transaction(async (trx) => {
        // 1. Migrar ítems
        for (const item of jsonItems) {
          let productDocId = item.productId;
          if (productDocId && !isNaN(Number(productDocId))) {
            const prod = await strapi.db.query('api::product.product').findOne({
              where: { id: Number(productDocId) },
              select: ['documentId'],
              transacting: trx,
            });
            if (prod) productDocId = prod.documentId;
          }

          let colorDocId = item.colorId;
          if (colorDocId && !isNaN(Number(colorDocId))) {
            const col = await strapi.db.query('api::color.color').findOne({
              where: { id: Number(colorDocId) },
              select: ['documentId'],
              transacting: trx,
            });
            if (col) colorDocId = col.documentId;
          }

          await strapi.db.query('api::order-item.order-item').create({
            data: {
              productName: item.title || item.productName || 'Producto',
              colorName: item.selectedColor || 'N/A',
              quantity: Number(item.quantity) || 1,
              unitPrice: Number(item.price || item.unitPrice || 0),
              unitCost: Number(item.unitCost || 0),
              order: order.id,
              product: productDocId || null,
              color: colorDocId || null,
            },
            transacting: trx,
          });
        }

        // 2. Migrar pagos
        for (const p of jsonPayments) {
          await strapi.db.query('api::payment.payment').create({
            data: {
              amount: Number(p.amount) || 0,
              method: p.method || 'Efectivo',
              reference: p.reference || '',
              status: p.status || 'confirmed',
              order: order.id,
            },
            transacting: trx,
          });
        }

        migratedCount++;
        console.log(`[Migration] Orden #${order.id} migrada exitosamente (${jsonItems.length} ítems, ${jsonPayments.length} pagos).`);
      });
    } catch (txErr: any) {
      console.error(`[Migration] Error al procesar transacción para orden #${order.id}:`, txErr.message);
    }
  }

  if (migratedCount > 0) {
    console.log(`[Migration] Migración relacional completada. Se migraron ${migratedCount} órdenes.`);
  } else {
    console.log('[Migration] No se requirieron migraciones de órdenes; base de datos al día.');
  }
}

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
