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
    },

    async auditData(ctx) {
        try {
            const results: any = {
                ordersWithoutMovements: [],
                movementsWithoutColor: [],
                movementsWithoutProduct: [],
                stockDiscrepancies: [],
                productsMissingDefaultColor: []
            };

            // 1. Órdenes sin movimientos (excluyendo canceladas)
            const activeOrders = await strapi.documents('api::order.order').findMany({
                filters: { orderStatus: { $notIn: ['cancelled', 'returned'] } }
            });

            for (const order of activeOrders) {
                const movements = await strapi.db.query('api::inventory-movement.inventory-movement').findMany({
                    where: { reason: { $contains: `Pedido #${order.documentId || order.id}` } }
                });

                if (movements.length === 0) {
                    results.ordersWithoutMovements.push({
                        id: order.id,
                        documentId: order.documentId,
                        client: order.clientName,
                        date: order.createdAt
                    });
                }
            }

            // 2. Movimientos huérfanos
            const movements = await strapi.documents('api::inventory-movement.inventory-movement').findMany({
                populate: ['color', 'color.product']
            });

            for (const mov of movements) {
                if (!mov.color) {
                    results.movementsWithoutColor.push(mov.id);
                } else if (!mov.color.product) {
                    results.movementsWithoutProduct.push({
                        movementId: mov.id,
                        colorName: mov.color.name,
                        colorId: mov.color.documentId
                    });
                }
            }

            // 3. Discrepancias de stock
            const colors = await strapi.documents('api::color.color').findMany({
                populate: ['inventory_movements']
            });

            for (const color of colors) {
                const movs = await strapi.db.query('api::inventory-movement.inventory-movement').findMany({
                    where: { color: { documentId: color.documentId } }
                });

                const calculatedStock = movs.reduce((acc, m) => {
                    return m.type === 'IN' ? acc + m.quantity : acc - m.quantity;
                }, 0);

                if (calculatedStock !== color.stock) {
                    results.stockDiscrepancies.push({
                        color: color.name,
                        documentId: color.documentId,
                        dbStock: color.stock,
                        calculatedStock: calculatedStock
                    });
                }
            }

            // 4. Productos sin colores
            const products = await strapi.documents('api::product.product').findMany({
                populate: ['colors']
            });

            for (const prod of products) {
                if (!prod.colors || prod.colors.length === 0) {
                    results.productsMissingDefaultColor.push({
                        id: prod.id,
                        title: prod.title
                    });
                }
            }

            return ctx.send({ data: results });
        } catch (err) {
            return ctx.badRequest('Error en auditoría: ' + err.message);
        }
    }
}));
