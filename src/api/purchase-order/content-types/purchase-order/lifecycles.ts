export default {
    async beforeUpdate(event) {
        // Mantenemos la captura del estado anterior por si se requiere en el futuro
        const { params } = event;
        const documentId = params.where?.documentId;
        const id = params.where?.id;
        
        let existingOrder = null;

        try {
            if (documentId) {
                existingOrder = await strapi.documents('api::purchase-order.purchase-order').findOne({
                    documentId: documentId,
                });
            } else if (id) {
                existingOrder = await strapi.db.query('api::purchase-order.purchase-order').findOne({
                    where: { id },
                });
            }
        } catch (error) {
            console.error("Error fetching existingOrder in beforeUpdate:", error);
        }
        
        event.state.existingOrder = existingOrder;
    },

    async afterCreate(event) {
        // La lógica de inventario ahora se maneja en el controlador transaccional processPurchaseOrderFull
    },

    async afterUpdate(event) {
        // La lógica de inventario ahora se maneja en el controlador transaccional processPurchaseOrderFull
    }
};
