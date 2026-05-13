
export default {
    async afterCreate(event) {
        // El color se crea como borrador por defecto en Strapi 5
        // Se recomienda publicarlo manualmente o mediante una acción controlada
    },
    async afterUpdate(event) {
        // No auto-publicar aquí para evitar bloqueos de transacción (Deadlocks)
        // en operaciones masivas de inventario.
    }
};
