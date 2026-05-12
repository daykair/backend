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
        try {
            const { orderData, stockAdjustments } = ctx.request.body.data;
            let savedOrder = null;

            // 1. Save or Update Order
            let orderId = orderData.documentId || orderData.id;
            const { id: _oid, documentId: _odocId, ...cleanOrderData } = orderData;

            if (orderId) {
                savedOrder = await strapi.documents('api::order.order').update({
                    documentId: orderId,
                    data: cleanOrderData
                });
            } else {
                savedOrder = await strapi.documents('api::order.order').create({
                    data: cleanOrderData
                });
            }

            // 2. Process Stock Adjustments
            if (stockAdjustments && Array.isArray(stockAdjustments) && stockAdjustments.length > 0) {
                for (const adj of stockAdjustments) {
                    // Fetch color with product to get names for the reason using Document Service (v5)
                    const colorEntity = await strapi.documents('api::color.color').findOne({ 
                        documentId: adj.colorId,
                        populate: ['product']
                    }) as any;

                    if (colorEntity) {
                        // Enrich the reason with product and order details
                        const productTitle = colorEntity.product?.title || 'Producto';
                        const colorName = colorEntity.name || 'N/A';
                        const orderIdentifier = savedOrder.id || savedOrder.documentId;
                        
                        const enrichedReason = `${adj.reason.replace('undefined', orderIdentifier)} - Item: ${productTitle} (${colorName})`;

                        // Create inventory movement (Lifecycle will handle the stock update)
                        await strapi.documents('api::inventory-movement.inventory-movement').create({
                            data: {
                                color: colorEntity.documentId,
                                quantity: adj.quantity,
                                type: adj.type,
                                reason: enrichedReason,
                                date: new Date().toISOString(),
                                performedBy: adj.userId,
                                exchangeRate: adj.exchangeRate
                            }
                        });
                    } else {
                        console.error(`[OrderProcess] Could not find color with ID ${adj.colorId} for stock adjustment`);
                    }
                }
            }

            return ctx.send({ data: savedOrder });
        } catch (err) {
            ctx.throw(500, err);
        }
    }
}));
