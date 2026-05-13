
export default {
    async afterCreate(event) {
        const { result } = event;
        if (result.documentId) {
            try {
                await strapi.documents('api::color.color').publish({
                    documentId: result.documentId
                });
                console.log(`[Color Lifecycle] Autopublicado tras creación: ${result.documentId}`);
            } catch (err) {
                // Silencioso si ya está publicado o hay error
            }
        }
    },
    async afterUpdate(event) {
        const { result } = event;
        if (result.documentId) {
            try {
                await strapi.documents('api::color.color').publish({
                    documentId: result.documentId
                });
                console.log(`[Color Lifecycle] Autopublicado tras actualización: ${result.documentId}`);
            } catch (err) {
                // Silencioso
            }
        }
    }
};
