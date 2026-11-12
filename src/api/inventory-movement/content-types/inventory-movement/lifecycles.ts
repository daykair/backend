const roundQty = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(3)) : NaN;
};

const extractRelationDocId = async (rawRef: any, uid: string): Promise<string | null> => {
  if (!rawRef) return null;
  let resolved: any = null;
  if (typeof rawRef === 'object') {
    const wrap = rawRef.set || rawRef.connect;
    if (wrap) {
      const first = Array.isArray(wrap) ? wrap[0] : wrap;
      resolved = typeof first === 'object' ? (first.documentId || first.id) : first;
    } else {
      resolved = rawRef.documentId || rawRef.id;
    }
  } else {
    resolved = rawRef;
  }

  if (resolved === null || resolved === undefined) return null;
  const resolvedStr = String(resolved);
  if (/^\d+$/.test(resolvedStr)) {
    const entity = await strapi.db.query(uid).findOne({
      where: { id: Number(resolvedStr) },
      select: ['documentId'],
    });
    return entity?.documentId || resolvedStr;
  }
  return resolvedStr;
};

export default {
  async beforeCreate(event) {
    const data = event.params?.data || {};
    const movementType = data.type;
    if (movementType !== 'IN' && movementType !== 'OUT') {
      throw new Error(`Tipo de movimiento de inventario inválido: '${String(movementType || '')}'.`);
    }

    if (Array.isArray(data.items) && data.items.length > 0) {
      for (const item of data.items) {
        const qty = roundQty(item?.quantity);
        if (!item?.colorId || !Number.isFinite(qty) || qty <= 0) {
          throw new Error('Todos los ítems del movimiento deben incluir colorId y cantidad mayor a 0.');
        }
      }
      return;
    }

    if (data.quantity !== undefined && data.quantity !== null) {
      const qty = roundQty(data.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error('La cantidad del movimiento de inventario debe ser mayor a 0.');
      }
    }
  },

  async afterCreate(event) {
    const { result } = event;
    const movementType = result?.type;

    if (movementType !== 'IN' && movementType !== 'OUT') {
      throw new Error(`[Inventory Lifecycle] Tipo de movimiento inválido: '${String(movementType || '')}'.`);
    }

    await strapi.db.transaction(async ({ trx }) => {
      // 1. Extraer el almacén del movimiento
      let warehouseDocId = await extractRelationDocId(
        result.warehouse || event.params.data?.warehouse,
        'api::warehouse.warehouse',
      );

      // Si no viene almacén especificado, buscar el almacén por defecto MAIN
      if (!warehouseDocId) {
        const mainWh = await strapi.db.query('api::warehouse.warehouse').findOne({
          where: { code: 'MAIN' },
          select: ['documentId'],
        });
        if (mainWh) {
          warehouseDocId = mainWh.documentId;
        }
      }

      if (!warehouseDocId) {
        throw new Error('[Inventory Lifecycle] No se pudo determinar un almacén de destino/origen para el movimiento de inventario.');
      }

      const rawColor = result.color || event.params.data?.color;
      const batchItems = result.items || event.params.data?.items;

      // Aux para recalcular el stock total agregado de un Color dentro de la misma transacción
      const syncAggregateStock = async (effectiveColorDocId: string) => {
        const allWarehouseStocks = (await strapi.db
          .query('api::warehouse-stock.warehouse-stock')
          .findMany({
            where: { color: { documentId: effectiveColorDocId } },
            select: ['stock'],
          })) as any[];

        const totalStock = Number(
          allWarehouseStocks.reduce((sum, s) => sum + Number(s.stock || 0), 0).toFixed(3),
        );

        await strapi.db.query('api::color.color').updateMany({
          where: { documentId: effectiveColorDocId },
          data: { stock: totalStock },
        });
        console.log(`[Inventory Lifecycle] Stock global recalculado para variante ${effectiveColorDocId}: ${totalStock}`);
      };

      const applyAtomicWarehouseStockChange = async (
        effectiveColorDocId: string,
        qtyRaw: unknown,
        labelTitle?: string,
        labelColor?: string,
      ) => {
        const qtyToChange = roundQty(qtyRaw);
        if (!Number.isFinite(qtyToChange) || qtyToChange <= 0) {
          throw new Error('[Inventory Lifecycle] La cantidad de movimiento debe ser un número positivo.');
        }

        let warehouseStockRecord = (await strapi.db
          .query('api::warehouse-stock.warehouse-stock')
          .findOne({
            where: {
              color: { documentId: effectiveColorDocId },
              warehouse: { documentId: warehouseDocId },
            },
            select: ['id', 'documentId', 'stock'],
          })) as any;

        if (!warehouseStockRecord) {
          if (movementType === 'OUT') {
            const colorEntity = (await strapi.documents('api::color.color').findOne({
              documentId: effectiveColorDocId,
              populate: ['product'],
            })) as any;
            const titleString = labelTitle || colorEntity?.product?.title || 'Producto';
            const rawColorName = labelColor || colorEntity?.name || '';
            const nameString = rawColorName ? ` (${rawColorName})` : '';
            throw new Error(
              `Stock insuficiente en almacén para el ítem '${titleString}${nameString}'. Solicitado: ${qtyToChange}, Disponible: 0`,
            );
          }

          warehouseStockRecord = await strapi.documents('api::warehouse-stock.warehouse-stock').create({
            data: {
              stock: 0,
              color: effectiveColorDocId,
              warehouse: warehouseDocId,
            },
            status: 'published',
          });
        }

        if (movementType === 'IN') {
          await trx('warehouse_stocks')
            .where('id', warehouseStockRecord.id)
            .update({
              stock: trx.raw('ROUND(COALESCE(stock, 0) + ?, 3)', [qtyToChange]),
            });
          return;
        }

        // OUT atómico con condición SQL condicional (evita race conditions y stock negativo)
        const updatedRows = await trx('warehouse_stocks')
          .where('id', warehouseStockRecord.id)
          .andWhereRaw('ROUND(COALESCE(stock, 0), 3) >= ?', [qtyToChange])
          .update({
            stock: trx.raw('ROUND(COALESCE(stock, 0) - ?, 3)', [qtyToChange]),
          });

        if (!updatedRows || Number(updatedRows) === 0) {
          const freshRow = await trx('warehouse_stocks')
            .where('id', warehouseStockRecord.id)
            .first('stock');
          const available = Number(freshRow?.stock ?? 0);
          let titleString = labelTitle || 'Producto';
          let rawColorName = labelColor || '';
          if (!labelTitle || !labelColor) {
            const colorEntity = (await strapi.documents('api::color.color').findOne({
              documentId: effectiveColorDocId,
              populate: ['product'],
            })) as any;
            titleString = labelTitle || colorEntity?.product?.title || 'Producto';
            rawColorName = labelColor || colorEntity?.name || '';
          }
          const nameString = rawColorName ? ` (${rawColorName})` : '';
          throw new Error(
            `Stock insuficiente en almacén para el ítem '${titleString}${nameString}'. Solicitado: ${qtyToChange}, Disponible: ${available}`,
          );
        }
      };

      // CASO A: Procesamiento por Lote (Movimientos automáticos de pedidos / compras / transferencias)
      if (batchItems && Array.isArray(batchItems)) {
        console.log(`[Inventory Lifecycle] Procesando LOTE de ${batchItems.length} items en almacén ${warehouseDocId}`);
        const updatedColors = new Set<string>();

        for (const item of batchItems) {
          if (!item?.colorId || item?.quantity === undefined) {
            throw new Error('[Inventory Lifecycle] Ítem de lote inválido en movimiento de inventario.');
          }

          const effectiveDocId = await extractRelationDocId(item.colorId, 'api::color.color');
          if (!effectiveDocId) {
            throw new Error('[Inventory Lifecycle] No se pudo resolver la variante del ítem en el movimiento.');
          }

          await applyAtomicWarehouseStockChange(
            effectiveDocId,
            item.quantity,
            item.title,
            item.colorName,
          );
          updatedColors.add(effectiveDocId);
        }

        for (const colorDocId of updatedColors) {
          await syncAggregateStock(colorDocId);
        }

        console.log('[Inventory Lifecycle] Procesamiento de LOTE completado.');
        return;
      }

      // CASO B: Procesamiento Individual (Movimientos manuales de inventario)
      const effectiveColorDocId = await extractRelationDocId(rawColor, 'api::color.color');
      if (!effectiveColorDocId || result.quantity === undefined) {
        console.warn('[Inventory Lifecycle] Movimiento creado sin variante (color), lote o cantidad válida.');
        return;
      }

      console.log(
        `[Inventory Lifecycle] Procesando movimiento individual en almacén ${warehouseDocId} para variante: ${effectiveColorDocId}`,
      );
      await applyAtomicWarehouseStockChange(effectiveColorDocId, result.quantity);
      await syncAggregateStock(effectiveColorDocId);
    });
  },
};
