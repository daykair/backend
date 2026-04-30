export default {
    async beforeUpdate(event) {
        const { params } = event;
        // En Strapi 5, `where` puede incluir `documentId` en lugar de `id`
        const documentId = params.where?.documentId;
        const id = params.where?.id;
        
        let existingOrder = null;

        try {
            if (documentId) {
                existingOrder = await strapi.documents('api::purchase-order.purchase-order').findOne({
                    documentId: documentId,
                    populate: ['supplier']
                });
            } else if (id) {
                existingOrder = await strapi.db.query('api::purchase-order.purchase-order').findOne({
                    where: { id },
                    populate: ['supplier']
                });
            }
        } catch (error) {
            console.error("Error fetching existingOrder in beforeUpdate:", error);
        }
        
        event.state.existingOrder = existingOrder;
    },

    async afterCreate(event) {
        const { result } = event;
        await processPurchaseOrder(result, null);
    },

    async afterUpdate(event) {
        const { result, state } = event;
        const existingOrder = state?.existingOrder;
        await processPurchaseOrder(result, existingOrder);
    }
};

async function processPurchaseOrder(currentOrder, previousOrder) {
    // 1. Integración con Inventario y Costos
    const becameReceived = currentOrder.status === 'received' && (!previousOrder || previousOrder.status !== 'received');
    
    if (becameReceived) {
        let items = currentOrder.items || [];
        if (typeof items === 'string') {
            try {
                items = JSON.parse(items);
            } catch (e) {
                items = [];
            }
        }

        for (const item of items) {
            // Actualizar el stock del color (sumar)
            if (item.colorId) {
                const isNumeric = !isNaN(Number(item.colorId));
                let colorQuery = null;

                try {
                    if (!isNumeric && typeof item.colorId === 'string') {
                        colorQuery = await strapi.documents('api::color.color').findOne({
                            documentId: item.colorId
                        });
                    } else {
                        // Fallback
                        colorQuery = await strapi.db.query('api::color.color').findOne({
                            where: { id: item.colorId }
                        });
                    }
                } catch (err) {
                    console.error("Error finding color:", err);
                }

                if (colorQuery && colorQuery.documentId) {
                    const colorStock = colorQuery.stock || 0;
                    const newStock = colorStock + Number(item.quantity);

                    try {
                        // Strapi 5 Document Service - Usar status: 'published' para no dejarlo en draft/modified
                        await strapi.documents('api::color.color').update({
                            documentId: colorQuery.documentId,
                            data: { stock: newStock },
                            status: 'published'
                        });

                        // Generar Movimiento de Inventario
                        await strapi.documents('api::inventory-movement.inventory-movement').create({
                            data: {
                                color: colorQuery.documentId,
                                quantity: Number(item.quantity),
                                type: 'IN',
                                reason: `Orden de Compra #${currentOrder.documentId || currentOrder.id}`,
                                date: new Date().toISOString(),
                            },
                            status: 'published'
                        });
                    } catch (err) {
                        console.error("Error updating color stock or creating movement:", err);
                    }
                }
            }

            // Actualizar costo base del producto
            if (item.productId && item.unitCost) {
                const isNumericProduct = !isNaN(Number(item.productId));
                let productQuery = null;

                try {
                    if (!isNumericProduct && typeof item.productId === 'string') {
                        productQuery = await strapi.documents('api::product.product').findOne({
                            documentId: item.productId
                        });
                    } else {
                        productQuery = await strapi.db.query('api::product.product').findOne({
                            where: { id: item.productId }
                        });
                    }
                } catch (err) {
                    console.error("Error finding product:", err);
                }

                if (productQuery && productQuery.documentId) {
                    try {
                        await strapi.documents('api::product.product').update({
                            documentId: productQuery.documentId,
                            data: {
                                costPrice: Number(item.unitCost)
                            },
                            status: 'published'
                        });
                    } catch (err) {
                        console.error("Error updating product cost:", err);
                    }
                }
            }
        }
    }

    // 2. Eliminado: Ya no se crean Gastos (Expenses) automáticamente por Órdenes de Compra.
    // Esto asegura que la contabilidad del dashboard mantenga las compras de inventario separadas
    // de los gastos operativos (luz, alquiler, envíos, etc).
}

