
export default {
  async afterCreate(event) {
    const { result } = event;

    // En Strapi 5, las relaciones en el resultado suelen no venir pobladas
    // por lo que debemos buscar en event.params.data también.
    const colorId = result.color?.documentId || result.color?.id || result.color || event.params.data?.color;

    if (!colorId || result.quantity === undefined) {
      console.warn('Inventory Movement created without valid color or quantity. Skipping stock update.', { result, data: event.params.data });
      return;
    }

    try {
      // 1. Obtener el color usando el Document Service (v5)
      // Buscamos específicamente por documentId para ser consistentes con v5
      const color = await strapi.documents('api::color.color').findOne({
        documentId: colorId
      });

      if (!color) {
        console.error(`[Inventory] Color no encontrado para el movimiento: ${colorId}`);
        return;
      }

      // 2. Calcular nuevo stock
      const currentStock = Number(color.stock || 0);
      const movementQty = Number(result.quantity);
      const newStock = result.type === 'IN' 
        ? currentStock + movementQty 
        : currentStock - movementQty;

      // 3. Actualizar el stock del color usando el Document Service (v5)
      // Esto disparará otros lifecycles de color si existen y manejará estados de publicación
      await strapi.documents('api::color.color').update({
        documentId: colorId,
        data: { stock: newStock },
        status: 'published'
      });

      console.log(`[Inventory] Stock updated for Color ${colorId}: ${currentStock} -> ${newStock} (${result.type})`);
    } catch (error) {
      console.error(' [Inventory] Error in afterCreate lifecycle:', error);
      // Nota: En afterCreate el registro ya se guardó, por lo que lanzar un error aquí
      // no revertiría la creación del movimiento, pero sí alertaría en los logs.
    }
  }
};
