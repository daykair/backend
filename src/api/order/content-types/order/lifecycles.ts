export default {
    async afterCreate(event) {
        const { result } = event;
        await processDeliveryExpense(result);
    },
    async afterUpdate(event) {
        const { result } = event;
        await processDeliveryExpense(result);
    }
};

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
                }
            });
        } else {
            // Actualizar el título por si la dirección o agencia cambió
            const expense = existingExpenses[0];
            await strapi.documents('api::expense.expense').update({
                documentId: expense.documentId,
                data: {
                    title: expenseTitle,
                }
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
