export default {
  async afterCreate(event) {
    const { result } = event;

    // 1. Extraer el almacén del movimiento
    const rawWarehouse = result.warehouse || event.params.data?.warehouse;
    let warehouseDocId = null;

    if (rawWarehouse) {
      if (typeof rawWarehouse === 'object') {
        const wrap = rawWarehouse.set || rawWarehouse.connect;
        if (wrap) {
          const first = Array.isArray(wrap) ? wrap[0] : wrap;
          warehouseDocId = typeof first === 'object' ? (first.documentId || first.id) : first;
        } else {
          warehouseDocId = rawWarehouse.documentId || rawWarehouse.id;
        }
      } else {
        warehouseDocId = rawWarehouse;
      }
    }

    // Resolver ID numérico a DocumentID si es necesario
    if (warehouseDocId && !isNaN(Number(warehouseDocId)) && !warehouseDocId.toString().includes('-')) {
      const whEntity = await strapi.db.query('api::warehouse.warehouse').findOne({
        where: { id: Number(warehouseDocId) },
        select: ['documentId']
      });
      if (whEntity) warehouseDocId = whEntity.documentId;
    }

    // Si no viene almacén especificado, buscar el almacén por defecto MAIN
    if (!warehouseDocId) {
      const mainWh = await strapi.db.query('api::warehouse.warehouse').findOne({
        where: { code: 'MAIN' },
        select: ['documentId']
      });
      if (mainWh) {
        warehouseDocId = mainWh.documentId;
      }
    }

    if (!warehouseDocId) {
      throw new Error('[Inventory Lifecycle] No se pudo determinar un almacén de destino/origen para el movimiento de inventario.');
    }

    // 2. Extraer el ID de color (individual) o los items del lote
    const rawColor = result.color || event.params.data?.color;
    const batchItems = result.items || event.params.data?.items;
    let colorId = null;

    if (rawColor) {
      if (typeof rawColor === 'object') {
        const wrap = rawColor.set || rawColor.connect;
        if (wrap) {
          const first = Array.isArray(wrap) ? wrap[0] : wrap;
          colorId = typeof first === 'object' ? (first.documentId || first.id) : first;
        } else {
          colorId = rawColor.documentId || rawColor.id;
        }
      } else {
        colorId = rawColor;
      }
    }

    const movementType = result.type; // 'IN' o 'OUT'

    // Aux para recalcular el stock total agregado de un Color
    const syncAggregateStock = async (effectiveColorDocId: string) => {
      const allWarehouseStocks = await strapi.documents('api::warehouse-stock.warehouse-stock').findMany({
        filters: { color: { documentId: effectiveColorDocId } } as any,
        limit: -1
      });
      const totalStock = allWarehouseStocks.reduce((sum, s) => sum + Number(s.stock || 0), 0);

      await strapi.db.query('api::color.color').updateMany({
        where: { documentId: effectiveColorDocId },
        data: { stock: totalStock }
      });
      console.log(`[Inventory Lifecycle] Stock global recalculado para variante ${effectiveColorDocId}: ${totalStock}`);
    };

    // CASO A: Procesamiento por Lote (Movimientos automáticos de pedidos / compras)
    if (batchItems && Array.isArray(batchItems)) {
      console.log(`[Inventory Lifecycle] Procesando LOTE de ${batchItems.length} items en almacén ${warehouseDocId}`);
      
      // Colección de colores actualizados para sincronizar agregados al final
      const updatedColors = new Set<string>();

      for (const item of batchItems) {
        const { colorId: itemColorId, quantity: itemQty, title: productTitle, colorName } = item;
        if (!itemColorId || itemQty === undefined) continue;

        // Resolver DocumentID de la variante si viene en formato numérico
        let effectiveDocId = itemColorId.toString();
        if (!isNaN(Number(itemColorId)) && !effectiveDocId.includes('-')) {
          const entity = await strapi.db.query('api::color.color').findOne({ 
            where: { id: Number(itemColorId) },
            select: ['documentId']
          });
          if (entity) effectiveDocId = entity.documentId;
        }

        // Buscar el stock existente en este almacén específico
        let warehouseStockRecord = await strapi.db.query('api::warehouse-stock.warehouse-stock').findOne({
          where: {
            color: { documentId: effectiveDocId },
            warehouse: { documentId: warehouseDocId }
          }
        }) as any;

        if (!warehouseStockRecord) {
          // Crear un registro inicial con stock 0
          warehouseStockRecord = await strapi.documents('api::warehouse-stock.warehouse-stock').create({
            data: {
              stock: 0,
              color: effectiveDocId,
              warehouse: warehouseDocId
            },
            status: 'published'
          });
        }

        const currentStock = Number(warehouseStockRecord.stock || 0);
        const qtyToChange = Number(itemQty);

        // Control Estricto de Stock Negativo
        if (movementType === 'OUT' && currentStock < qtyToChange) {
          const nameString = colorName ? ` (${colorName})` : '';
          const titleString = productTitle || 'Producto';
          throw new Error(`Stock insuficiente en almacén para el ítem '${titleString}${nameString}'. Solicitado: ${qtyToChange}, Disponible: ${currentStock}`);
        }

        const newStock = movementType === 'IN' ? currentStock + qtyToChange : currentStock - qtyToChange;

        // Actualizar el stock del almacén
        await strapi.db.query('api::warehouse-stock.warehouse-stock').updateMany({
          where: { documentId: warehouseStockRecord.documentId },
          data: { stock: newStock }
        });

        console.log(`[Inventory Lifecycle] Stock actualizado en almacén: Variante ${effectiveDocId} (${currentStock} -> ${newStock})`);
        updatedColors.add(effectiveDocId);
      }

      // Sincronizar stock total agregado en cada variante afectada
      for (const colorDocId of updatedColors) {
        await syncAggregateStock(colorDocId);
      }
      
      console.log(`[Inventory Lifecycle] Procesamiento de LOTE completado.`);
      return;
    }

    // CASO B: Procesamiento Individual (Movimientos manuales de inventario)
    if (!colorId || result.quantity === undefined) {
      console.warn('[Inventory Lifecycle] Movimiento creado sin variante (color), lote o cantidad válida.');
      return;
    }

    try {
      let effectiveColorDocId = colorId.toString();

      if (!isNaN(Number(colorId)) && !effectiveColorDocId.includes('-')) {
        const entity = await strapi.db.query('api::color.color').findOne({ 
          where: { id: Number(colorId) },
          select: ['documentId']
        });
        if (entity) effectiveColorDocId = entity.documentId;
      }

      console.log(`[Inventory Lifecycle] Procesando movimiento individual en almacén ${warehouseDocId} para variante: ${effectiveColorDocId}`);

      // Buscar o crear registro de stock en almacén
      let warehouseStockRecord = await strapi.db.query('api::warehouse-stock.warehouse-stock').findOne({
        where: {
          color: { documentId: effectiveColorDocId },
          warehouse: { documentId: warehouseDocId }
        }
      }) as any;

      if (!warehouseStockRecord) {
        warehouseStockRecord = await strapi.documents('api::warehouse-stock.warehouse-stock').create({
          data: {
            stock: 0,
            color: effectiveColorDocId,
            warehouse: warehouseDocId
          },
          status: 'published'
        });
      }

      const currentStock = Number(warehouseStockRecord.stock || 0);
      const qtyToChange = Number(result.quantity);

      // Control Estricto de Stock Negativo
      if (movementType === 'OUT' && currentStock < qtyToChange) {
        // Conseguir nombre descriptivo de la variante para el error
        const colorEntity = await strapi.documents('api::color.color').findOne({
          documentId: effectiveColorDocId,
          populate: ['product']
        }) as any;
        const nameString = colorEntity?.name ? ` (${colorEntity.name})` : '';
        const titleString = colorEntity?.product?.title || 'Producto';
        throw new Error(`Stock insuficiente en almacén para el ítem '${titleString}${nameString}'. Solicitado: ${qtyToChange}, Disponible: ${currentStock}`);
      }

      const newStock = movementType === 'IN' ? currentStock + qtyToChange : currentStock - qtyToChange;

      // Actualizar el stock del almacén
      await strapi.db.query('api::warehouse-stock.warehouse-stock').updateMany({
        where: { documentId: warehouseStockRecord.documentId },
        data: { stock: newStock }
      });

      console.log(`[Inventory Lifecycle] Stock individual actualizado en almacén: ${effectiveColorDocId} (${currentStock} -> ${newStock})`);

      // Sincronizar stock total agregado en la variante
      await syncAggregateStock(effectiveColorDocId);
    } catch (error: any) {
      console.error('[Inventory Lifecycle] Error crítico en procesamiento individual:', error.message);
      throw error; // Re-lanzar para propagar y abortar transacciones
    }
  }
};
