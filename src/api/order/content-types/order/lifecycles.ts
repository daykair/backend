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
    const orderId = order.id || order.documentId;
    const isCancelled = order.orderStatus === 'cancelled';
    const shouldDeduct = order.orderStatus === 'payment_confirmed' || order.orderStatus === 'delivered' || order.orderType === 'credit';
    
    // 1. Verificar si ya existen movimientos para esta orden usando db.query
    const existingMovements = await strapi.db.query('api::inventory-movement.inventory-movement').findMany({
        where: { reason: { $contains: `Pedido #${orderId}` } }
    });

    const hasOutMovements = existingMovements && existingMovements.some(m => m.type === 'OUT');
    const hasInMovements = existingMovements && existingMovements.some(m => m.type === 'IN');

    // CASO A: Cancelación (Devolver stock si se había descontado antes)
    if (isCancelled && hasOutMovements && !hasInMovements) {
        let items = order.order;
        if (typeof items === 'string') try { items = JSON.parse(items); } catch (e) { return; }
        
        if (Array.isArray(items)) {
            for (const item of items) {
                if (item.colorId) {
                    await strapi.db.query('api::inventory-movement.inventory-movement').create({
                        data: {
                            color: item.colorId,
                            quantity: Number(item.quantity),
                            type: 'IN',
                            reason: `Devolución automática (Cancelación Pedido #${orderId})`,
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
    if (shouldDeduct && !hasOutMovements) {
        let items = order.order;
        if (typeof items === 'string') try { items = JSON.parse(items); } catch (e) { return; }

        if (Array.isArray(items)) {
            for (const item of items) {
                if (item.colorId) {
                    await strapi.db.query('api::inventory-movement.inventory-movement').create({
                        data: {
                            color: item.colorId,
                            quantity: Number(item.quantity),
                            type: 'OUT',
                            reason: `Venta automática (Pedido #${orderId})`,
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
                        const product = await strapi.db.query('api::product.product').findOne({
                            where: { 
                                $or: [
                                    { documentId: item.productId.toString() },
                                    { id: !isNaN(Number(item.productId)) ? Number(item.productId) : -1 }
                                ]
                            }
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

    // Buscar si ya existe un gasto con esa referencia usando db.query
    const existingExpenses = await strapi.db.query('api::expense.expense').findMany({
        where: { reference: reference }
    });

    if (order.deliveryMethod === 'delivery' && order.option && order.option !== 'Propio') {
        const expenseTitle = `Delivery - ${order.option} - ${order.adress || 'Sin dirección'}`;

        if (!existingExpenses || existingExpenses.length === 0) {
            await strapi.db.query('api::expense.expense').create({
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
            await strapi.db.query('api::expense.expense').update({
                where: { id: expense.id },
                data: {
                    title: expenseTitle,
                }
            });
        }
    } else {
        if (existingExpenses && existingExpenses.length > 0) {
            for (const exp of existingExpenses) {
                await strapi.db.query('api::expense.expense').delete({
                    where: { id: exp.id }
                });
            }
        }
    }
}
