export default {
    async beforeCreate(event) {
        const { data } = event.params;
        // Establecer fecha de pedido si no viene
        if (!data.orderPlaced) {
            data.orderPlaced = new Date().toISOString();
        }
        await processOrderItemsCosts(event);
    },
    async beforeUpdate(event) {
        await processOrderItemsCosts(event);
    },
    async afterCreate(event) {
        const { result } = event;
        await processDeliveryExpense(result);
        await processInventoryStock(result);
    },
    async afterUpdate(event) {
        const { result } = event;
        await processDeliveryExpense(result);
        await processInventoryStock(result);
    }
};

async function processInventoryStock(order) {
    const orderId = order.id || order.documentId;
    const isCancelled = order.orderStatus === 'cancelled';
    // Descontar stock si es un estado activo (incluyendo pending para apartar stock en pedidos manuales)
    const shouldDeduct = order.orderStatus === 'pending' || order.orderStatus === 'payment_confirmed' || order.orderStatus === 'delivered' || order.orderType === 'credit';
    
    // 1. Verificar movimientos existentes usando db.query para mayor precisión en tiempo real
    const saleReason = `Venta automática (Pedido #${orderId})`;
    const returnReason = `Devolución automática (Cancelación Pedido #${orderId})`;

    const existingSale = await strapi.db.query('api::inventory-movement.inventory-movement').findOne({
        where: { reason: saleReason, type: 'OUT' }
    });

    const existingReturn = await strapi.db.query('api::inventory-movement.inventory-movement').findOne({
        where: { reason: returnReason, type: 'IN' }
    });

    // CASO A: Cancelación (Devolver stock si se había descontado antes y no se ha devuelto ya)
    if (isCancelled && existingSale && !existingReturn) {
        let items = order.order;
        if (typeof items === 'string') try { items = JSON.parse(items); } catch (e) { return; }
        
        if (Array.isArray(items)) {
            for (const item of items) {
                if (item.colorId) {
                    await strapi.documents('api::inventory-movement.inventory-movement').create({
                        data: {
                            color: item.colorId,
                            quantity: Number(item.quantity),
                            type: 'IN',
                            reason: returnReason,
                            exchangeRate: order.exchangeRate || 1,
                            performedBy: order.performedBy?.id || order.performedBy || null,
                            date: new Date().toISOString()
                        }
                    });
                }
            }
        }
        return;
    }

    // CASO B: Descuento de stock (Solo si aplica y no se ha hecho antes)
    if (shouldDeduct && !existingSale) {
        let items = order.order;
        if (typeof items === 'string') try { items = JSON.parse(items); } catch (e) { return; }

        if (Array.isArray(items)) {
            for (const item of items) {
                if (item.colorId) {
                    await strapi.documents('api::inventory-movement.inventory-movement').create({
                        data: {
                            color: item.colorId,
                            quantity: Number(item.quantity),
                            type: 'OUT',
                            reason: saleReason,
                            exchangeRate: order.exchangeRate || 1,
                            performedBy: order.performedBy?.id || order.performedBy || null,
                            date: new Date().toISOString()
                        }
                    });
                }
            }
        }
    }
}

async function processOrderItemsCosts(event) {
    const { data } = event.params;
    
    if (data && data.order) {
        let items = data.order;
        if (typeof items === 'string') {
            try {
                items = JSON.parse(items);
            } catch (e) {
                // Ignorar error de parseo
            }
        }

        if (Array.isArray(items)) {
            // Buscamos los costos actuales de los productos uno por uno
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.productId && typeof item.unitCost === 'undefined') {
                    try {
                        const product = await strapi.documents('api::product.product').findOne({
                            documentId: item.productId.toString()
                        });

                        if (product) {
                            item.unitCost = product.costPrice || 0;
                        } else {
                            item.unitCost = 0;
                        }
                    } catch (error) {
                        item.unitCost = 0;
                    }
                }
            }
            if (typeof data.order === 'string') {
                event.params.data.order = JSON.stringify(items);
            } else {
                event.params.data.order = items;
            }
        }
    }
}

async function processDeliveryExpense(order) {
    const orderId = order.id || order.documentId;
    const reference = `Delivery de la Orden #${orderId}`;

    // Buscar si ya existe un gasto con esa referencia
    const existingExpenses = await strapi.documents('api::expense.expense').findMany({
        filters: { reference: { $eq: reference } }
    });

    if (order.deliveryMethod === 'delivery' && order.option && order.option !== 'Propio') {
        const expenseTitle = `Delivery - ${order.option} - ${order.adress || 'Sin dirección'}`;

        if (!existingExpenses || existingExpenses.length === 0) {
            await strapi.documents('api::expense.expense').create({
                data: {
                    title: expenseTitle,
                    amount: 0,
                    date: new Date(Date.now() - 4 * 3600000).toISOString().split('T')[0],
                    category: 'Operaciones',
                    reference: reference
                }
            });
        } else {
            const expense = existingExpenses[0];
            await strapi.documents('api::expense.expense').update({
                documentId: expense.documentId,
                data: {
                    title: expenseTitle,
                }
            });
        }
    } else {
        if (existingExpenses && existingExpenses.length > 0) {
            for (const exp of existingExpenses) {
                await strapi.documents('api::expense.expense').delete({
                    documentId: exp.documentId
                });
            }
        }
    }
}
