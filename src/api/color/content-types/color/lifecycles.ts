
export default {
    async afterCreate(event) {
        const { result } = event;
        if (Number(result.stock || 0) > 0) {
            try {
                // Evitar duplicación si ya existe un warehouse-stock creado explícitamente (ej. desde saveFull)
                const existingStock = await strapi.documents('api::warehouse-stock.warehouse-stock').findFirst({
                    filters: { color: { documentId: result.documentId } } as any
                });
                if (existingStock) {
                    return;
                }

                // Buscar almacén principal (MAIN) o el primer almacén activo disponible
                let targetWarehouse = await strapi.documents('api::warehouse.warehouse').findFirst({
                    filters: { code: 'MAIN', isActive: true } as any
                });
                if (!targetWarehouse) {
                    targetWarehouse = await strapi.documents('api::warehouse.warehouse').findFirst({
                        filters: { code: 'MAIN' } as any
                    });
                }
                if (!targetWarehouse) {
                    targetWarehouse = await strapi.documents('api::warehouse.warehouse').findFirst({
                        filters: { isActive: true } as any
                    });
                }

                if (targetWarehouse) {
                    await strapi.documents('api::warehouse-stock.warehouse-stock').create({
                        data: {
                            color: result.documentId,
                            warehouse: targetWarehouse.documentId,
                            stock: Number(result.stock)
                        },
                        status: 'published'
                    });
                }
            } catch (err) {
                console.error("Error linking initial stock to warehouse in color lifecycle:", err);
            }
        }
    },
    async afterUpdate(event) {
        // No auto-publicar aquí para evitar bloqueos de transacción (Deadlocks)
        // en operaciones masivas de inventario.
    }
};
