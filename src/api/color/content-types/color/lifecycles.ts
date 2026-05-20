
export default {
    async afterCreate(event) {
        const { result } = event;
        if (Number(result.stock || 0) > 0) {
            try {
                // Buscar almacén principal (MAIN)
                const mainWarehouse = await strapi.documents('api::warehouse.warehouse').findFirst({
                    filters: { code: 'MAIN' } as any
                });
                
                if (mainWarehouse) {
                    // Crear registro en warehouse_stock para vincular el stock al almacén principal
                    await strapi.documents('api::warehouse-stock.warehouse-stock').create({
                        data: {
                            color: result.documentId,
                            warehouse: mainWarehouse.documentId,
                            stock: Number(result.stock)
                        }
                    });
                }
            } catch (err) {
                console.error("Error linking initial stock to MAIN warehouse in color lifecycle:", err);
            }
        }
    },
    async afterUpdate(event) {
        // No auto-publicar aquí para evitar bloqueos de transacción (Deadlocks)
        // en operaciones masivas de inventario.
    }
};
