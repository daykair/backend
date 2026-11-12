import { factories } from '@strapi/strapi';
import { buildAdminFindParams } from '../../../utils/adminQuery';

export default factories.createCoreController('api::purchase-order.purchase-order', ({ strapi }) => ({
    async findAdmin(ctx) {
        try {
            const params = buildAdminFindParams(ctx.query);
            const orders = await strapi.documents('api::purchase-order.purchase-order').findMany({
                ...params,
                populate: {
                    ...((ctx.query.populate as any) || {}),
                    supplier: true,
                    warehouse: true
                } as any,
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

                // Helper para resolver documentId de un almacén desde id numérico o documentId
                const resolveWarehouseDocId = async (rawWh: any): Promise<string | null> => {
                    if (!rawWh) return null;
                    const rawVal = typeof rawWh === 'object' ? (rawWh.documentId || rawWh.id) : rawWh;
                    if (!rawVal) return null;
                    const str = String(rawVal).trim();
                    if (!str) return null;
                    if (!isNaN(Number(str)) && !str.includes('-')) {
                        const wh = await strapi.documents('api::warehouse.warehouse').findFirst({
                            filters: { id: Number(str) } as any
                        });
                        return wh?.documentId || null;
                    }
                    const wh = await strapi.documents('api::warehouse.warehouse').findOne({ documentId: str });
                    return wh?.documentId || null;
                };

                // 1. Save or Update Purchase Order
                let orderId = orderData.documentId || orderData.id;
                const { id: _oid, documentId: _odocId, ...cleanOrderData } = orderData;

                if (cleanOrderData.warehouse !== undefined) {
                    cleanOrderData.warehouse = await resolveWarehouseDocId(cleanOrderData.warehouse);
                }

                if (orderId) {
                    // Sincronizar monto pagado si vienen multipagos
                    if (cleanOrderData.payments && Array.isArray(cleanOrderData.payments)) {
                        cleanOrderData.amountPaid = cleanOrderData.payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
                    }

                    savedOrder = await strapi.documents('api::purchase-order.purchase-order').update({
                        documentId: orderId,
                        data: cleanOrderData,
                        populate: ['warehouse', 'supplier'] as any,
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
                        populate: ['warehouse', 'supplier'] as any,
                        status: 'published'
                    });
                }

                const defaultOrderWarehouseDocId =
                    (savedOrder as any)?.warehouse?.documentId ||
                    (await resolveWarehouseDocId(cleanOrderData.warehouse));

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

                        const targetWarehouseDocId =
                            (await resolveWarehouseDocId(adj.warehouseId)) ||
                            defaultOrderWarehouseDocId;

                        const productTitle = colorEntity.product?.title || 'Producto';
                        const colorName = colorEntity.name || 'N/A';
                        const orderIdentifier = savedOrder.reference || savedOrder.id || savedOrder.documentId;
                        
                        // Si el front manda un placeholder explícito como {order_id}, lo reemplazamos. 
                        // Si no, simplemente anexamos el ID de la orden.
                        let baseReason = adj.reason || 'Ajuste de Inventario';
                        baseReason = baseReason.replace('{order_id}', orderIdentifier);
                        baseReason = baseReason.replace('#undefined', `#${orderIdentifier}`); // Fallback for old frontend behavior

                        const enrichedReason = `${baseReason} - Item: ${productTitle} (${colorName})`;

                        // A. Crear Movimiento de Inventario
                        // El lifecycle de inventory-movement se encargará de sumar el stock al color y al warehouse
                        await strapi.documents('api::inventory-movement.inventory-movement').create({
                            data: {
                                color: colorEntity.documentId,
                                product: colorEntity.product?.documentId || null,
                                ...(targetWarehouseDocId ? { warehouse: targetWarehouseDocId } : {}),
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
