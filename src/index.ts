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

    // 2.1 Publicar órdenes en borrador para evitar pérdida de datos antes de apagar draftAndPublish
    try {
      await publishDraftOrders(strapi);
    } catch (err: any) {
      throw new console.error('[Migration] Error al publicar órdenes en draft:', err.message);
    }

    // 2.2 Migración de órdenes JSON antiguo a nuevo JSON estructurado
    try {
      await migrateOrdersOldJsonToNewJson(strapi);
    } catch (err: any) {
      console.error('[Migration] Error al migrar formato JSON de órdenes:', err.message);
    }

    // 3. Programar la rutina diaria de raspado a las 12:00 AM (Medianoche) Hora de Caracas
    scheduleDailyBcvUpdate(strapi);
  },
};

async function publishDraftOrders(strapi: any) {
  console.log('[Migration] Verificando órdenes en borrador para su publicación...');
  
  // Strapi v5 document service
  if (!strapi.documents) return;
  
  try {
    const draftOrders = await strapi.documents('api::order.order').findMany({
      filters: { publishedAt: { $null: true } },
      status: 'draft'
    });

    if (!draftOrders || draftOrders.length === 0) {
      console.log('[Migration] No hay órdenes en borrador pendientes de publicación.');
      return;
    }

    let publishedCount = 0;
    for (const order of draftOrders) {
      await strapi.documents('api::order.order').publish({ documentId: order.documentId });
      publishedCount++;
    }
    
    console.log(`[Migration] Publicadas ${publishedCount} órdenes que estaban en borrador.`);
  } catch (e) {
    console.error('[Migration] Error publicando borradores (puede ser normal si draftAndPublish ya fue desactivado):', e);
  }
}

async function migrateOrdersOldJsonToNewJson(strapi: any) {
  console.log('[Migration] Verificando órdenes para migrar a nueva estructura JSON...');
  
  const orders = await strapi.db.query('api::order.order').findMany() as any[];

  let migratedCount = 0;

  for (const order of orders) {
    const hasComponentItems = order.orderItems && order.orderItems.length > 0;
    const hasComponentPayments = order.paymentRecords && order.paymentRecords.length > 0;

    if (hasComponentItems || hasComponentPayments) {
      continue;
    }

    // Intentar leer de JSON antiguos ('order', 'items', 'payments')
    let jsonItems: any[] = [];
    if (order.order) {
      if (typeof order.order === 'string') {
        try { jsonItems = JSON.parse(order.order); } catch (e) {}
      } else if (Array.isArray(order.order)) {
        jsonItems = order.order;
      }
    } else if (order.items) {
      if (typeof order.items === 'string') {
        try { jsonItems = JSON.parse(order.items); } catch (e) {}
      } else if (Array.isArray(order.items)) {
        jsonItems = order.items;
      }
    }

    let jsonPayments: any[] = [];
    if (order.payments && !Array.isArray(order.payments)) {
      if (typeof order.payments === 'string') {
        try { jsonPayments = JSON.parse(order.payments); } catch (e) {}
      }
    } else if (Array.isArray(order.payments) && order.payments.length > 0 && !order.payments[0].id) {
       // It's a raw JSON array
       jsonPayments = order.payments;
    }

    if (jsonItems.length === 0 && jsonPayments.length === 0) {
      continue;
    }

    const componentItems = [];
    for (const item of jsonItems) {
      let productDocId = item.productId || item.product;
      let colorDocId = item.colorId || item.color;
      
      componentItems.push({
        productName: item.title || item.productName || 'Producto',
        colorName: item.selectedColor || item.colorName || 'N/A',
        quantity: Number(item.quantity) || 1,
        unitPrice: Number(item.price || item.unitPrice || 0),
        unitCost: Number(item.unitCost || 0),
        product: productDocId || null,
        color: colorDocId || null,
      });
    }

    const componentPayments = [];
    for (const p of jsonPayments) {
      componentPayments.push({
        amount: Number(p.amount) || 0,
        method: p.method || 'Efectivo',
        reference: p.reference || '',
        status: p.status || 'confirmed',
      });
    }

    try {
      await strapi.db.query('api::order.order').update({
        where: { id: order.id },
        data: {
          orderItems: componentItems,
          paymentRecords: componentPayments
        }
      });
      migratedCount++;
      console.log(`[Migration] Orden #${order.id} migrada a nueva estructura JSON (${componentItems.length} ítems, ${componentPayments.length} pagos).`);
    } catch (err: any) {
      console.error(`[Migration] Error al actualizar JSON estructurado para orden #${order.id}:`, err.message);
    }
  }

  if (migratedCount > 0) {
    console.log(`[Migration] Migración de JSON completada. Se migraron ${migratedCount} órdenes.`);
  } else {
    console.log('[Migration] No se requirieron migraciones de JSON; base de datos al día.');
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
