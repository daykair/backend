/**
 * order controller
 */

import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::order.order', ({ strapi }) => ({
    async findAdmin(ctx) {
        try {
            const orders = await strapi.documents('api::order.order').findMany({
                ...ctx.query,
                populate: {
                    ...((ctx.query.populate as any) || {}),
                    performedBy: true
                }
            })

            return ctx.send({ data: orders })
        } catch (err) {
            ctx.body = err;
        }
    },

    async processOrderFull(ctx) {
        return await strapi.db.transaction(async () => {
            try {
                const { orderData } = ctx.request.body.data;
                let savedOrder = null;

                // Aux para fecha Caracas (UTC-4)
                // Usamos UTC estándar para evitar desfases (el front se encarga de la zona horaria)
                const getStandardISO = () => new Date().toISOString();

                // 1. Save or Update Order
                let orderId = orderData.documentId || orderData.id;
                const { id: _oid, documentId: _odocId, ...cleanOrderData } = orderData;

                if (orderId) {
                    // Sincronizar monto pagado si vienen multipagos
                    if (cleanOrderData.payments && Array.isArray(cleanOrderData.payments)) {
                        cleanOrderData.amountPaid = cleanOrderData.payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
                        if (cleanOrderData.payments.length > 0) {
                            cleanOrderData.method = cleanOrderData.payments.length > 1 ? "Múltiple" : cleanOrderData.payments[0].method;
                        }
                    }

                    savedOrder = await strapi.documents('api::order.order').update({
                        documentId: orderId,
                        data: cleanOrderData,
                        status: 'published'
                    });
                } else {
                    // Sincronizar monto pagado si vienen multipagos
                    if (cleanOrderData.payments && Array.isArray(cleanOrderData.payments)) {
                        cleanOrderData.amountPaid = cleanOrderData.payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
                        if (cleanOrderData.payments.length > 0) {
                            cleanOrderData.method = cleanOrderData.payments.length > 1 ? "Múltiple" : cleanOrderData.payments[0].method;
                        }
                    }

                    savedOrder = await strapi.documents('api::order.order').create({
                        data: {
                            ...cleanOrderData,
                            orderPlaced: getStandardISO() // Aseguramos que la fecha de creación sea UTC
                        },
                        status: 'published'
                    });
                }

                return { data: savedOrder };
            } catch (err) {
                console.error("[OrderProcess] Error en transacción:", err);
                ctx.throw(500, err.message || "Error al procesar el pedido e inventario");
            }
        });
    }
}));
