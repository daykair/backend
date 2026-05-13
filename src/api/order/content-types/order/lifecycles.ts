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
        // Capturar el estado anterior para detectar cambios de estado
        const { where } = event.params;
        if (where && (where.id || where.documentId)) {
            const existing = await strapi.db.query('api::order.order').findOne({ 
                where: where.id ? { id: where.id } : { documentId: where.documentId }
            });
            if (existing) {
                event.state = { previousStatus: existing.orderStatus };
            }
        }
        await processOrderItemsCosts(event);
    },
    async afterCreate(event) {
        const { result } = event;
        await processDeliveryExpense(result);
        await processInventoryStock(result);
    },
    async afterUpdate(event) {
        const { result, state } = event;
        const previousStatus = state?.previousStatus;
        
        // Solo procesar stock si el estado ha cambiado
        if (result.orderStatus !== previousStatus) {
            await processInventoryStock(result);
        }
        await processDeliveryExpense(result);
    }
};

async function processInventoryStock(order) {
    // Usamos documentId porque en Strapi 5 el ID numérico puede cambiar entre versiones (draft/published)
    const orderId = order.documentId || order.id;
    const isCancelled = order.orderStatus === 'cancelled' || order.orderStatus === 'returned';
    
    // Descontar stock si es un estado activo
    const shouldDeduct = order.orderStatus === 'pending' || order.orderStatus === 'payment_confirmed' || order.orderStatus === 'delivered' || order.orderType === 'credit';
    
    // Usamos el documentId en la razón para que sea consistente en todas las versiones del documento
    const saleReason = `Venta automática (Pedido #${orderId})`;
    const returnReason = `Devolución automática (Cancelación/Devolución Pedido #${orderId})`;

    // 1. Verificar movimientos existentes de forma paralela
    const [existingSale, existingReturn] = await Promise.all([
        strapi.db.query('api::inventory-movement.inventory-movement').findOne({
            where: { reason: { $contains: `Pedido #${orderId}` }, type: 'OUT' }
        }),
        strapi.db.query('api::inventory-movement.inventory-movement').findOne({
            where: { reason: { $contains: `Pedido #${orderId}` }, type: 'IN' }
        })
    ]);

    // CASO A: Cancelación/Devolución (Devolver stock si se había descontado antes y no se ha devuelto ya)
    if (isCancelled && existingSale && !existingReturn) {
        let items = order.order;
        if (typeof items === 'string') try { items = JSON.parse(items); } catch (e) { return; }
        
        if (Array.isArray(items)) {
            const promises = items.map(item => {
                if (item.colorId) {
                    return strapi.documents('api::inventory-movement.inventory-movement').create({
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
                return null;
            }).filter(Boolean);
            await Promise.all(promises);
        }
        return;
    }

    // CASO B: Descuento de stock (Solo si aplica y no se ha hecho antes)
    if (shouldDeduct && !existingSale) {
        let items = order.order;
        if (typeof items === 'string') try { items = JSON.parse(items); } catch (e) { return; }

        if (Array.isArray(items)) {
            const promises = items.map(item => {
                if (item.colorId) {
                    return strapi.documents('api::inventory-movement.inventory-movement').create({
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
                return null;
            }).filter(Boolean);
            await Promise.all(promises);
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
            // Recolectar todos los IDs de productos que necesitan costo
            const productIds = [...new Set(items
                .filter(item => item.productId && typeof item.unitCost === 'undefined')
                .map(item => item.productId.toString())
            )];

            if (productIds.length > 0) {
                // Buscar todos los productos de una sola vez usando db.query para evitar errores de tipos con documentId
                const products = await strapi.db.query('api::product.product').findMany({
                    where: { documentId: { $in: productIds } },
                    select: ['documentId', 'costPrice']
                });

                const costMap = products.reduce((acc, p) => {
                    acc[p.documentId] = p.costPrice || 0;
                    return acc;
                }, {});

                // Asignar costos
                items.forEach(item => {
                    if (item.productId && typeof item.unitCost === 'undefined') {
                        item.unitCost = costMap[item.productId.toString()] || 0;
                    }
                });
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
