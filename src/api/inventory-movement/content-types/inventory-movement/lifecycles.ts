
export default {
  async afterCreate(event) {
    const { result } = event;

    // En Strapi 5, las relaciones en el resultado suelen no venir pobladas
    // por lo que debemos buscar en event.params.data también.
    // 1. Extraer el ID de forma ultra-segura (evitar pasar objetos a las consultas)
    const rawColor = result.color || event.params.data?.color;
    let colorId = null;

    if (rawColor) {
      if (typeof rawColor === 'object') {
        // Manejar estructuras de Strapi 5 como { set: [...] } o { connect: [...] }
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

    if (!colorId || result.quantity === undefined) {
      console.warn('[Inventory] Movimiento creado sin color o cantidad válida.', { result, data: event.params.data });
      return;
    }

    try {
      // 2. Normalizar a DocumentId (Strapi 5 prefiere strings para el Document Service)
      let effectiveDocumentId = colorId.toString();

      // Si es un número puro, resolver el documentId primero usando db.query
      if (!isNaN(Number(colorId)) && !effectiveDocumentId.includes('-')) {
          const entity = await strapi.db.query('api::color.color').findOne({ 
              where: { id: Number(colorId) },
              select: ['documentId']
          });
          if (entity) {
              effectiveDocumentId = entity.documentId;
          }
      }

      // 3. Obtener el color (intentamos publicado primero, luego borrador)
      let color = await strapi.documents('api::color.color').findOne({
        documentId: effectiveDocumentId,
        status: 'published'
      });

      if (!color) {
        color = await strapi.documents('api::color.color').findOne({
          documentId: effectiveDocumentId,
          status: 'draft'
        });
      }

      if (!color) {
        console.error(`[Inventory] Color no encontrado: ${effectiveDocumentId}`);
        return;
      }

      // 4. Calcular nuevo stock
      const currentStock = Number(color.stock || 0);
      const movementQty = Number(result.quantity);
      const newStock = result.type === 'IN' 
        ? currentStock + movementQty 
        : currentStock - movementQty;

      // 5. Actualizar el stock preservando el estado de publicación
      await strapi.documents('api::color.color').update({
        documentId: effectiveDocumentId,
        data: { stock: newStock },
        status: color.publishedAt ? 'published' : 'draft'
      });

      console.log(`[Inventory] Stock actualizado para ${effectiveDocumentId}: ${currentStock} -> ${newStock} (${result.type})`);
    } catch (error) {
      console.error('[Inventory] Error crítico en lifecycle afterCreate:', error);
    }
  }
};
