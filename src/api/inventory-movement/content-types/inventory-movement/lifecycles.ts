
export default {
  async afterCreate(event) {
    const { result } = event;

    // En Strapi 5, las relaciones en el resultado suelen no venir pobladas
    // por lo que debemos buscar en event.params.data también.
    let colorId = result.color?.documentId || result.color?.id || result.color || event.params.data?.color;

    if (!colorId || result.quantity === undefined) {
      console.warn('Inventory Movement created without valid color or quantity. Skipping stock update.', { result, data: event.params.data });
      return;
    }

    try {
      // 1. Resolver documentId si recibimos un ID numérico (Strapi 5 usa documentId en Document Service)
      let effectiveDocumentId = colorId;
      if (typeof colorId === 'number' || !isNaN(Number(colorId)) && !String(colorId).includes('-')) {
          // Si parece un ID numérico, buscamos su documentId
          const entity = await strapi.db.query('api::color.color').findOne({ 
              where: { id: Number(colorId) },
              select: ['documentId']
          });
          if (entity) {
              effectiveDocumentId = entity.documentId;
          }
      }

      // 2. Obtener el color (intentamos publicado primero, luego borrador si es necesario)
      let color = await strapi.documents('api::color.color').findOne({
        documentId: effectiveDocumentId,
        status: 'published'
      });

      // Fallback a borrador si no hay versión publicada (útil para nuevos productos no publicados aún)
      if (!color) {
        color = await strapi.documents('api::color.color').findOne({
          documentId: effectiveDocumentId,
          status: 'draft'
        });
      }

      if (!color) {
        console.error(`[Inventory] Color no encontrado para el movimiento: ${effectiveDocumentId} (Original ID: ${colorId})`);
        return;
      }

      // 3. Calcular nuevo stock
      const currentStock = Number(color.stock || 0);
      const movementQty = Number(result.quantity);
      const newStock = result.type === 'IN' 
        ? currentStock + movementQty 
        : currentStock - movementQty;

      // 4. Actualizar el stock del color
      // Usamos el documentId efectivo y forzamos publicación si el producto debe estar activo
      await strapi.documents('api::color.color').update({
        documentId: effectiveDocumentId,
        data: { stock: newStock },
        status: color.publishedAt ? 'published' : 'draft' // Mantenemos el estado actual pero actualizamos el valor
      });

      console.log(`[Inventory] Stock updated for Color ${effectiveDocumentId}: ${currentStock} -> ${newStock} (${result.type})`);
    } catch (error) {
      console.error(' [Inventory] Error in afterCreate lifecycle:', error);
    }
  }
};
