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
    },
    async afterUpdate(event) {
        const { result } = event;
        await processDeliveryExpense(result);
    }
};

async function processOrderItemsCosts(event) {
    const { data } = event.params;
    
    if (data && data.order) {
        let items = data.order;
        if (typeof items === 'string') {
            try {
                items = JSON.parse(items);
            } catch (e) {
                // Ignorar error de parseo, no modificamos nada
            }
        }

        if (Array.isArray(items)) {
            // Buscamos los costos actuales de los productos
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                // Si el item tiene un productId y NO tiene ya un unitCost guardado
                if (item.productId && typeof item.unitCost === 'undefined') {
                    try {
                        const isNumericProduct = !isNaN(Number(item.productId));
                        let productQuery = null;

                        if (!isNumericProduct && typeof item.productId === 'string') {
                            productQuery = await strapi.documents('api::product.product').findOne({
                                documentId: item.productId
                            });
                        } else {
                            productQuery = await strapi.db.query('api::product.product').findOne({
                                where: { id: item.productId }
                            });
                        }

                        if (productQuery) {
                            // Snapshot: Congelamos el costo base actual al momento de la venta
                            item.unitCost = productQuery.costPrice || 0;
                        } else {
                            item.unitCost = 0;
                        }
                    } catch (error) {
                        console.error("Error fetching product cost for order item", error);
                        item.unitCost = 0; // Default fallback
                    }
                }
            }
            // Guardamos de vuelta el JSON modificado, si era string lo volvemos string
            if (typeof data.order === 'string') {
                event.params.data.order = JSON.stringify(items);
            } else {
                event.params.data.order = items;
            }
        }
    }
}

async function processDeliveryExpense(order) {
    const reference = `Delivery Order ${order.documentId || order.id}`;

    // Buscar si ya existe un gasto con esa referencia
    const existingExpenses = await strapi.documents('api::expense.expense').findMany({
        filters: { reference: { $eq: reference } }
    });

    // Si es delivery y la agencia no es "Propio"
    if (order.deliveryMethod === 'delivery' && order.option && order.option !== 'Propio') {
        const expenseTitle = `[Agregar precio] Delivery - ${order.option} - ${order.adress || 'Sin dirección'}`;

        if (!existingExpenses || existingExpenses.length === 0) {
            // Crear el gasto
            await strapi.documents('api::expense.expense').create({
                data: {
                    title: expenseTitle,
                    amount: 0, // Se inicializa en 0 para que el usuario "Agregue precio"
                    date: new Date().toISOString().split('T')[0],
                    category: 'Operaciones',
                    reference: reference
                },
                status: 'published' // Ensure Strapi 5 auto-publishes the expense
            });
        } else {
            // Actualizar el título por si la dirección o agencia cambió
            const expense = existingExpenses[0];
            await strapi.documents('api::expense.expense').update({
                documentId: expense.documentId,
                data: {
                    title: expenseTitle,
                },
                status: 'published'
            });
        }
    } else {
        // Si el usuario cambia a "Propio", a "Retiro", o se equivoca
        // debemos eliminar el gasto de delivery asociado si existe
        if (existingExpenses && existingExpenses.length > 0) {
            for (const exp of existingExpenses) {
                await strapi.documents('api::expense.expense').delete({
                    documentId: exp.documentId
                });
            }
        }
    }
}
