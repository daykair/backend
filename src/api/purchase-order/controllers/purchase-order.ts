import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::purchase-order.purchase-order', ({ strapi }) => ({
    async findAdmin(ctx) {
        try {
            const orders = await strapi.documents('api::purchase-order.purchase-order').findMany({
                ...ctx.query,
                populate: {
                    ...((ctx.query.populate as any) || {}),
                    supplier: true
                },
                sort: 'date:desc'
            });

            return ctx.send({ data: orders });
        } catch (err) {
            ctx.body = err;
        }
    },

    async processPurchaseOrderFull(ctx) {
        return await strapi.db.transaction(async () => {
            try {
                const { orderData, stockAdjustments } = ctx.request.body.data;
                let savedOrder = null;

                // Aux para fecha Caracas (UTC-4)
                // Usamos UTC estándar para evitar desfases (el front se encarga de la zona horaria)
                const getStandardISO = () => new Date().toISOString();

                // 1. Save or Update Purchase Order
                let orderId = orderData.documentId || orderData.id;
                const { id: _oid, documentId: _odocId, ...cleanOrderData } = orderData;

                if (orderId) {
                    // Sincronizar monto pagado si vienen multipagos
                    if (cleanOrderData.payments && Array.isArray(cleanOrderData.payments)) {
                        cleanOrderData.amountPaid = cleanOrderData.payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
                    }

                    savedOrder = await strapi.documents('api::purchase-order.purchase-order').update({
                        documentId: orderId,
                        data: cleanOrderData,
                        status: 'published'
                    });
                } else {
                    // Sincronizar monto pagado si vienen multipagos
                    if (cleanOrderData.payments && Array.isArray(cleanOrderData.payments)) {
                        cleanOrderData.amountPaid = cleanOrderData.payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
                    }

                    savedOrder = await strapi.documents('api::purchase-order.purchase-order').create({
                        data: {
                            ...cleanOrderData,
                        },
                        status: 'published'
                    });
                }

                // 2. Process Stock Adjustments and Product Costs
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
                        const orderIdentifier = savedOrder.reference || savedOrder.id || savedOrder.documentId;
                        
                        const enrichedReason = `${adj.reason.replace('undefined', orderIdentifier)} - Item: ${productTitle} (${colorName})`;

                        // A. Crear Movimiento de Inventario
                        // El lifecycle de inventory-movement se encargará de sumar el stock al color
                        await strapi.documents('api::inventory-movement.inventory-movement').create({
                            data: {
                                color: colorEntity.documentId,
                                product: colorEntity.product?.documentId || null,
                                quantity: adj.quantity,
                                type: adj.type,
                                reason: enrichedReason,
                                date: getStandardISO(),
                                performedBy: adj.userId,
                                exchangeRate: adj.exchangeRate
                            },
                            status: 'published'
                        });

                        // B. Actualizar Costo del Producto (si viene en el ajuste o podemos sacarlo de los items)
                        // Buscamos el unitCost en la data original de la orden para este item
                        let items = cleanOrderData.items || [];
                        if (typeof items === 'string') items = JSON.parse(items);
                        
                        const itemData = items.find((i: any) => i.colorId === adj.colorId || i.productId === colorEntity.product?.documentId);
                        
                        if (itemData && itemData.unitCost && colorEntity.product) {
                            await strapi.db.query('api::product.product').updateMany({
                                where: { documentId: colorEntity.product.documentId },
                                data: {
                                    costPrice: Number(itemData.unitCost)
                                }
                            });
                        }
                    }
                }

                return { data: savedOrder };
            } catch (err) {
                console.error("[PurchaseOrderProcess] Error en transacción:", err);
                ctx.throw(500, err.message || "Error al procesar la orden de compra e inventario");
            }
        });
    }
}));
