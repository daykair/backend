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
            let orderId = orderData.id || orderData.documentId;
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
                    // Try to find the color by documentId or integer id
                    let colorEntity = null;
                    if (typeof adj.colorId === 'string' && isNaN(Number(adj.colorId))) {
                        colorEntity = await strapi.db.query('api::color.color').findOne({ where: { documentId: adj.colorId } });
                    } else {
                        colorEntity = await strapi.db.query('api::color.color').findOne({ where: { id: adj.colorId } });
                    }

                    if (colorEntity) {
                        const newStock = adj.type === 'IN' ? colorEntity.stock + adj.quantity : colorEntity.stock - adj.quantity;
                        
                        // Update stock directly using db.query (bypassing REST/draft checks)
                        await strapi.db.query('api::color.color').update({
                            where: { id: colorEntity.id },
                            data: { stock: newStock }
                        });

                        // Create inventory movement
                        await strapi.documents('api::inventory-movement.inventory-movement').create({
                            data: {
                                color: colorEntity.documentId,
                                quantity: adj.quantity,
                                type: adj.type,
                                reason: adj.reason,
                                date: new Date().toISOString(),
                                performedBy: adj.userId,
                                exchangeRate: adj.exchangeRate
                            }
                        });
                    }
                }
            }

            return ctx.send({ data: savedOrder });
        } catch (err) {
            ctx.throw(500, err);
        }
    }
}));
