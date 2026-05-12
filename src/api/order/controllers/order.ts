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
                const { orderData, stockAdjustments } = ctx.request.body.data;
                let savedOrder = null;

                // Aux para fecha Caracas (UTC-4)
                const getCaracasISO = () => new Date(Date.now() - 4 * 3600000).toISOString();

                // 1. Save or Update Order
                let orderId = orderData.documentId || orderData.id;
                const { id: _oid, documentId: _odocId, ...cleanOrderData } = orderData;

                if (orderId) {
                    savedOrder = await strapi.documents('api::order.order').update({
                        documentId: orderId,
                        data: cleanOrderData,
                        status: 'published'
                    });
                } else {
                    savedOrder = await strapi.documents('api::order.order').create({
                        data: {
                            ...cleanOrderData,
                            orderPlaced: getCaracasISO() // Aseguramos que la fecha de creación sea Caracas
                        },
                        status: 'published'
                    });
                }

                // 2. Process Stock Adjustments
                if (stockAdjustments && Array.isArray(stockAdjustments) && stockAdjustments.length > 0) {
                    for (const adj of stockAdjustments) {
                        const colorEntity = await strapi.documents('api::color.color').findOne({ 
                            documentId: adj.colorId,
                            populate: ['product']
                        }) as any;

                        if (!colorEntity) {
                            throw new Error(`Color con ID ${adj.colorId} no encontrado. Abortando para mantener consistencia.`);
                        }

                        const productTitle = colorEntity.product?.title || 'Producto';
                        const colorName = colorEntity.name || 'N/A';
                        const orderIdentifier = savedOrder.id || savedOrder.documentId;
                        
                        const enrichedReason = `${adj.reason.replace('undefined', orderIdentifier)} - Item: ${productTitle} (${colorName})`;

                        await strapi.documents('api::inventory-movement.inventory-movement').create({
                            data: {
                                color: colorEntity.documentId,
                                quantity: adj.quantity,
                                type: adj.type,
                                reason: enrichedReason,
                                date: getCaracasISO(),
                                performedBy: adj.userId,
                                exchangeRate: adj.exchangeRate
                            }
                        });
                    }
                }

                return { data: savedOrder };
            } catch (err) {
                console.error("[OrderProcess] Error en transacción:", err);
                ctx.throw(500, err.message || "Error al procesar el pedido e inventario");
            }
        });
    }
}));
