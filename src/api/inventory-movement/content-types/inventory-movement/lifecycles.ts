
export default {
  async afterCreate(event) {
    const { result } = event;

    // En Strapi 5, las relaciones en el resultado suelen no venir pobladas
    // por lo que debemos buscar en event.params.data también.
    // 1. Extraer el ID o la lista de items
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

    // CASO A: Procesamiento por Lote (Nuevo sistema Pro)
    if (batchItems && Array.isArray(batchItems)) {
      console.log(`[Inventory Lifecycle] Procesando LOTE de ${batchItems.length} items para movimiento #${result.documentId || result.id}`);
      
      for (const item of batchItems) {
        try {
          const { colorId: itemColorId, quantity: itemQty } = item;
          if (!itemColorId || itemQty === undefined) continue;

          // Resolver DocumentID si es necesario
          let effectiveDocId = itemColorId.toString();
          if (!isNaN(Number(itemColorId)) && !effectiveDocId.includes('-')) {
            const entity = await strapi.db.query('api::color.color').findOne({ 
              where: { id: Number(itemColorId) },
              select: ['documentId']
            });
            if (entity) effectiveDocId = entity.documentId;
          }

          // Obtener stock actual
          let color = await strapi.documents('api::color.color').findOne({
            documentId: effectiveDocId,
            status: 'published'
          }) || await strapi.documents('api::color.color').findOne({
            documentId: effectiveDocId,
            status: 'draft'
          });

          if (!color) {
            console.error(`[Inventory Lifecycle] Color no encontrado en lote: ${effectiveDocId}`);
            continue;
          }

          const currentStock = Number(color.stock || 0);
          const newStock = result.type === 'IN' ? currentStock + Number(itemQty) : currentStock - Number(itemQty);

          await strapi.db.query('api::color.color').updateMany({
            where: { documentId: effectiveDocId },
            data: { stock: newStock }
          });

          console.log(`[Inventory Lifecycle] Item lote sincronizado: ${effectiveDocId} (${currentStock} -> ${newStock})`);
        } catch (err) {
          console.error(`[Inventory Lifecycle] Error en item del lote:`, err);
        }
      }
      console.log(`[Inventory Lifecycle] Procesamiento de LOTE completado.`);
      return;
    }

    // CASO B: Procesamiento Individual (Legacy / Manual)
    if (!colorId || result.quantity === undefined) {
      console.warn('[Inventory Lifecycle] Movimiento creado sin color, lote o cantidad válida.');
      return;
    }

    try {
      let effectiveDocumentId = colorId.toString();

      if (!isNaN(Number(colorId)) && !effectiveDocumentId.includes('-')) {
          const entity = await strapi.db.query('api::color.color').findOne({ 
              where: { id: Number(colorId) },
              select: ['documentId']
          });
          if (entity) effectiveDocumentId = entity.documentId;
      }

      console.log(`[Inventory Lifecycle] Procesando movimiento individual para color: ${effectiveDocumentId}`);

      let color = await strapi.documents('api::color.color').findOne({
        documentId: effectiveDocumentId,
        status: 'published'
      }) || await strapi.documents('api::color.color').findOne({
        documentId: effectiveDocumentId,
        status: 'draft'
      });

      if (!color) {
        console.error(`[Inventory Lifecycle] Color no encontrado: ${effectiveDocumentId}`);
        return;
      }

      const currentStock = Number(color.stock || 0);
      const movementQty = Number(result.quantity);
      const newStock = result.type === 'IN' ? currentStock + movementQty : currentStock - movementQty;

      await strapi.db.query('api::color.color').updateMany({
        where: { documentId: effectiveDocumentId },
        data: { stock: newStock }
      });

      console.log(`[Inventory Lifecycle] Stock individual sincronizado: ${effectiveDocumentId} (${currentStock} -> ${newStock})`);
    } catch (error) {
      console.error('[Inventory Lifecycle] Error crítico en procesamiento individual:', error);
    }
  }
};
