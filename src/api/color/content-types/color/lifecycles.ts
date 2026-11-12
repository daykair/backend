export default {
    async afterCreate(event: any) {
        const { result, params } = event;
        const initialStock = Number(result.stock || 0);
        if (initialStock > 0) {
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
                    const colorWithProd = (await strapi.documents('api::color.color').findOne({
                        documentId: result.documentId,
                        populate: ['product']
                    })) as any;

                    const prodDocId = colorWithProd?.product?.documentId || null;
                    const prodTitle = colorWithProd?.product?.title || 'Producto';

                    // Registrar movimiento IN para dejar trazabilidad en el kardex;
                    // inventory-movement lifecycle crea el warehouse-stock inicial y sincroniza el agregado.
                    await strapi.documents('api::inventory-movement.inventory-movement').create({
                        data: {
                            type: 'IN',
                            quantity: initialStock,
                            color: result.documentId,
                            ...(prodDocId ? { product: prodDocId } : {}),
                            warehouse: targetWarehouse.documentId,
                            reason: `Stock inicial de variante: ${prodTitle} (${result.name || 'Estándar'})`,
                            date: new Date().toISOString(),
                        } as any,
                    });
                }
            } catch (err) {
                console.error('Error linking initial stock to warehouse in color lifecycle:', err);
            }
        }
    },
    async afterUpdate() {
        // No auto-publicar aquí para evitar bloqueos de transacción (Deadlocks)
        // en operaciones masivas de inventario.
    }
};
