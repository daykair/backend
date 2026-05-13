export default {
    async beforeCreate(event) {
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
    if (!order) return;
    const orderId = order.id || order.documentId;
    if (!orderId) return;

    const isCancelled = order.orderStatus === 'cancelled';
    const shouldDeduct = order.orderStatus === 'payment_confirmed' || order.orderStatus === 'delivered' || order.orderType === 'credit';
    
    // 1. Verificar si ya existen movimientos para esta orden
    // Usamos db.query que a veces es más rápido para filtros simples en lifecycles
    const existingMovements = await strapi.db.query('api::inventory-movement.inventory-movement').findMany({
        where: { reason: { $contains: `Pedido #${orderId}` } }
    });

    const hasOutMovements = existingMovements.some(m => m.type === 'OUT');
    const hasInMovements = existingMovements.some(m => m.type === 'IN');

    // CASO A: Cancelación (Devolver stock si se había descontado antes)
    if (isCancelled && hasOutMovements && !hasInMovements) {
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
                            reason: `Devolución automática (Cancelación Pedido #${orderId})`,
                            exchangeRate: order.exchangeRate || 1,
                            performedBy: order.performedBy || null,
                            date: new Date().toISOString()
                        }
                    });
                }
            }
        }
        return;
    }

    // CASO B: Descuento de stock (Solo si aplica y no se ha hecho antes)
    if (shouldDeduct && !hasOutMovements) {
        let items = order.order;
        if (typeof items === 'string') try { items = JSON.parse(items); } catch (e) { return; }

        if (Array.isArray(items)) {
            for (const item of items) {
                if (item.colorId) {
                    try {
                        await strapi.documents('api::inventory-movement.inventory-movement').create({
                            data: {
                                color: item.colorId,
                                quantity: Number(item.quantity),
                                type: 'OUT',
                                reason: `Venta automática (Pedido #${orderId})`,
                                exchangeRate: order.exchangeRate || 1,
                                performedBy: order.performedBy || null,
                                date: new Date().toISOString()
                            }
                        });
                    } catch (error) {
                        console.error(`Error al descontar stock para item ${item.colorId} en pedido #${orderId}`, error);
                    }
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
            try { items = JSON.parse(items); } catch (e) { return; }
        }

        if (Array.isArray(items)) {
            // 1. Recolectar IDs
            const productIds = items
                .filter(item => item.productId && typeof item.unitCost === 'undefined')
                .map(item => item.productId.toString());

            if (productIds.length > 0) {
                try {
                    // 2. Buscar productos
                    const products = await strapi.db.query('api::product.product').findMany({
                        where: {
                            $or: [
                                { id: { $in: productIds.filter(id => !isNaN(Number(id))).map(Number) } },
                                { documentId: { $in: productIds.filter(id => isNaN(Number(id))) } }
                            ]
                        },
                        select: ['id', 'documentId', 'costPrice']
                    });

                    // 3. Mapa de costos
                    const costMap: Record<string, number> = {};
                    products.forEach(p => {
                        if (p.id) costMap[p.id.toString()] = p.costPrice || 0;
                        if (p.documentId) costMap[p.documentId] = p.costPrice || 0;
                    });

                    // 4. Asignar
                    items.forEach(item => {
                        if (item.productId && typeof item.unitCost === 'undefined') {
                            item.unitCost = costMap[item.productId.toString()] || 0;
                        }
                    });
                } catch (error) {
                    console.error("Error batch fetching costs", error);
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
    if (!order) return;
    const orderId = order.id || order.documentId;
    const reference = `Delivery de la Orden #${orderId}`;

    const existingExpenses = await strapi.db.query('api::expense.expense').findMany({
        where: { reference: reference }
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
                documentId: expense.documentId || expense.id,
                data: { title: expenseTitle }
            });
        }
    } else if (existingExpenses && existingExpenses.length > 0) {
        for (const exp of existingExpenses) {
            await strapi.documents('api::expense.expense').delete({
                documentId: exp.documentId || exp.id
            });
        }
    }
}
