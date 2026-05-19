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
        if (where) {
            const queryWhere: any = {};
            if (where.id) queryWhere.id = where.id;
            else if (where.documentId) queryWhere.documentId = where.documentId;
            else if (typeof where === 'string') queryWhere.documentId = where;
            else if (typeof where === 'number') queryWhere.id = where;

            if (Object.keys(queryWhere).length > 0) {
                const existing = await strapi.db.query('api::order.order').findOne({ 
                    where: queryWhere 
                });
                if (existing) {
                    event.state = { previousStatus: existing.orderStatus };
                }
            }
        }
        await processOrderItemsCosts(event);
    },
    async afterCreate(event) {
        const { result } = event;
        
        // SEGURIDAD: Solo procesar para la versión publicada, ignorar borradores (drafts)
        if (!result.publishedAt) return;

        await processDeliveryExpense(result);
        await processInventoryStock(result);
    },
    async afterUpdate(event) {
        const { result, state } = event;
        
        // SEGURIDAD: Solo procesar para la versión publicada, ignorar borradores (drafts)
        if (!result.publishedAt) return;

        let previousStatus = state?.previousStatus;
        
        if (previousStatus === undefined) {
            const updateData = event.params?.data;
            // Si orderStatus no se incluyó en la actualización, es seguro asumir que no cambió
            if (updateData && updateData.orderStatus === undefined) {
                previousStatus = result.orderStatus;
            }
        }
        
        // Solo procesar stock si el estado ha cambiado
        if (result.orderStatus !== previousStatus) {
            await processInventoryStock(result);
        }
        await processDeliveryExpense(result);
    }
};

async function processInventoryStock(order) {
    const orderId = order.documentId || order.id;
    console.log(`[Order Lifecycle] Procesando inventario para pedido #${orderId} (Estado: ${order.orderStatus})`);

    const isCancelled = order.orderStatus === 'cancelled' || order.orderStatus === 'returned';
    const shouldDeduct = order.orderStatus !== 'pending' && (order.orderStatus === 'payment_confirmed' || order.orderStatus === 'delivered' || order.orderType === 'credit' || order.orderType === 'apartado');
    
    const saleReason = `Venta automática por lote (Pedido #${orderId})`;
    const returnReason = `Devolución automática por lote (Cancelación/Devolución Pedido #${orderId})`;

    // Verificar movimientos existentes (ahora buscando por relación de orden o razón)
    const [existingSale, existingReturn] = await Promise.all([
        strapi.db.query('api::inventory-movement.inventory-movement').findOne({
            where: { 
                $or: [
                    { order: { id: order.id } },
                    { order: { documentId: order.documentId } },
                    { reason: { $contains: `Pedido #${orderId}` } }
                ],
                type: 'OUT' 
            }
        }),
        strapi.db.query('api::inventory-movement.inventory-movement').findOne({
            where: { 
                $or: [
                    { order: { id: order.id } },
                    { order: { documentId: order.documentId } },
                    { reason: { $contains: `Pedido #${orderId}` } }
                ],
                type: 'IN' 
            }
        })
    ]);

    let items = order.order;
    if (typeof items === 'string') try { items = JSON.parse(items); } catch (e) { return; }
    if (!Array.isArray(items)) {
        console.warn(`[Order Lifecycle] No se encontraron items válidos en el pedido #${orderId}`);
        return;
    }

    // CASO A: Cancelación/Devolución
    if (isCancelled && existingSale && !existingReturn) {
        console.log(`[Order Lifecycle] Creando movimiento de devolución por LOTE para pedido #${orderId}`);
        
        let totalQty = 0;
        const movementItems = items.map(item => {
            const qty = Number(item.quantity) || 0;
            totalQty += qty;
            return {
                colorId: item.colorId,
                productId: item.productId,
                title: item.title || 'Producto',
                colorName: item.selectedColor || 'N/A',
                quantity: qty
            };
        });

        await strapi.documents('api::inventory-movement.inventory-movement').create({
            data: {
                type: 'IN',
                reason: returnReason,
                order: order.documentId || order.id,
                items: movementItems,
                quantity: totalQty,
                date: new Date().toISOString(),
                performedBy: order.performedBy?.id || order.performedBy || null,
                exchangeRate: order.exchangeRate || 1
            }
        });
        
        console.log(`[Order Lifecycle] Devolución por lote registrada para pedido #${orderId}`);
        return;
    }

    // CASO B: Descuento de stock
    if (shouldDeduct && !existingSale) {
        console.log(`[Order Lifecycle] Creando movimiento de salida por LOTE para pedido #${orderId}`);
        
        let totalQty = 0;
        const movementItems = items.map(item => {
            const qty = Number(item.quantity) || 0;
            totalQty += qty;
            return {
                colorId: item.colorId,
                productId: item.productId,
                title: item.title || 'Producto',
                colorName: item.selectedColor || 'N/A',
                quantity: qty
            };
        });

        await strapi.documents('api::inventory-movement.inventory-movement').create({
            data: {
                type: 'OUT',
                reason: saleReason,
                order: order.documentId || order.id,
                items: movementItems,
                quantity: totalQty,
                date: new Date().toISOString(),
                performedBy: order.performedBy?.id || order.performedBy || null,
                exchangeRate: order.exchangeRate || 1
            }
        });

        console.log(`[Order Lifecycle] Descuento de stock por lote registrado para pedido #${orderId}`);
    } else if (shouldDeduct && existingSale) {
        console.log(`[Order Lifecycle] El pedido #${orderId} ya tiene un movimiento de salida. Omitiendo.`);
    } else if (!shouldDeduct) {
        console.log(`[Order Lifecycle] El estado '${order.orderStatus}' no requiere deducción de inventario.`);
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
    const idNum = order.id;
    const docId = order.documentId;
    const primaryRef = `Delivery de la Orden #${docId || idNum}`;

    // Buscar si ya existe un gasto con la referencia (por ID numérico o documentId)
    const filters: any[] = [];
    if (docId) filters.push({ reference: { $eq: `Delivery de la Orden #${docId}` } });
    if (idNum) filters.push({ reference: { $eq: `Delivery de la Orden #${idNum}` } });

    const existingExpenses = await strapi.documents('api::expense.expense').findMany({
        filters: { $or: filters }
    });

    if (order.deliveryMethod === 'delivery' && order.option && order.option !== 'Propio') {
        const expenseTitle = `Delivery - ${order.option} - ${order.adress || 'Sin dirección'}`;

        if (!existingExpenses || existingExpenses.length === 0) {
            await strapi.documents('api::expense.expense').create({
                data: {
                    title: expenseTitle,
                    amount: 0,
                    date: new Date().toISOString().split('T')[0],
                    category: 'Operaciones',
                    reference: primaryRef
                }
            });
        } else {
            // Actualizar el primer gasto existente
            const expense = existingExpenses[0];
            await strapi.documents('api::expense.expense').update({
                documentId: expense.documentId,
                data: {
                    title: expenseTitle,
                    reference: primaryRef // Normalizar a la referencia consistente
                }
            });

            // Limpieza Automática de Duplicados Preexistentes
            if (existingExpenses.length > 1) {
                for (let i = 1; i < existingExpenses.length; i++) {
                    await strapi.documents('api::expense.expense').delete({
                        documentId: existingExpenses[i].documentId
                    });
                }
            }
        }
    } else {
        // Eliminar gastos asociados si ya no aplica el delivery
        if (existingExpenses && existingExpenses.length > 0) {
            for (const exp of existingExpenses) {
                await strapi.documents('api::expense.expense').delete({
                    documentId: exp.documentId
                });
            }
        }
    }
}
