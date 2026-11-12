import { factories } from '@strapi/strapi';
import { buildAdminFindParams } from '../../../utils/adminQuery';
import {
    createAdminCrudHandlers,
    mergePopulate,
    resolveEntityDocumentId,
} from '../../../utils/adminCrud';

export default factories.createCoreController('api::purchase-order.purchase-order', ({ strapi }) => {
    const crud = createAdminCrudHandlers(strapi, 'api::purchase-order.purchase-order', {
        defaultPopulate: ['supplier', 'warehouse'],
        allowedPopulateKeys: ['supplier', 'warehouse'],
    });

    return {
    findOneAdmin: crud.findOneAdmin,
    updateAdmin: crud.updateAdmin,
    deleteAdmin: crud.deleteAdmin,

    async findAdmin(ctx) {
        try {
            const params = buildAdminFindParams(ctx.query);
            const populate = mergePopulate(
                ctx.query?.populate,
                { supplier: true, warehouse: true },
                ['supplier', 'warehouse'],
            );
            const orders = await strapi.documents('api::purchase-order.purchase-order').findMany({
                ...params,
                populate: populate as any,
                sort: params.sort || 'date:desc',
            });

            return ctx.send({ data: orders });
        } catch (err: any) {
            console.error('[PurchaseOrder findAdmin Error]:', err);
            return ctx.internalServerError(err?.message || 'Error al obtener órdenes de compra');
        }
    },

    async processPurchaseOrderFull(ctx) {
        try {
            return await strapi.db.transaction(async () => {
                const payloadData = ctx.request.body?.data || ctx.request.body || {};
                const { orderData, stockAdjustments } = payloadData;
                if (!orderData || typeof orderData !== 'object') {
                    const badErr: any = new Error('Se requieren los datos de la orden de compra.');
                    badErr.status = 400;
                    throw badErr;
                }

                let savedOrder = null;
                const getStandardISO = () => new Date().toISOString();
                const performedById = ctx.state?.user?.id || null;

                // 1. Save or Update Purchase Order
                const rawOrderRef = orderData.documentId || orderData.id;
                const orderId = rawOrderRef
                    ? await resolveEntityDocumentId(strapi, 'api::purchase-order.purchase-order', rawOrderRef)
                    : null;
                if (rawOrderRef && !orderId) {
                    const notFoundErr: any = new Error('La orden de compra indicada no existe.');
                    notFoundErr.status = 404;
                    throw notFoundErr;
                }

                const { id: _oid, documentId: _odocId, ...cleanOrderData } = orderData;

                if (cleanOrderData.warehouse !== undefined) {
                    cleanOrderData.warehouse = cleanOrderData.warehouse
                        ? await resolveEntityDocumentId(strapi, 'api::warehouse.warehouse', cleanOrderData.warehouse)
                        : null;
                }

                if (cleanOrderData.supplier !== undefined && cleanOrderData.supplier !== null && cleanOrderData.supplier !== '') {
                    const resolvedSupplier = await resolveEntityDocumentId(
                        strapi,
                        'api::supplier.supplier',
                        cleanOrderData.supplier,
                    );
                    if (resolvedSupplier) {
                        cleanOrderData.supplier = resolvedSupplier;
                    }
                }

                let previousOrder: any = null;
                if (orderId) {
                    previousOrder = await strapi.documents('api::purchase-order.purchase-order').findOne({
                        documentId: orderId,
                        populate: ['warehouse', 'supplier'] as any,
                    });
                    if (!previousOrder) {
                        const notFoundErr: any = new Error('La orden de compra indicada no existe.');
                        notFoundErr.status = 404;
                        throw notFoundErr;
                    }
                }

                // Sincronizar monto pagado si vienen multipagos validando montos positivos
                if (cleanOrderData.payments && Array.isArray(cleanOrderData.payments)) {
                    cleanOrderData.amountPaid = Number(
                        cleanOrderData.payments
                            .reduce((acc: number, p: any) => acc + Math.max(0, Number(p?.amount) || 0), 0)
                            .toFixed(2),
                    );
                }

                if (orderId) {
                    savedOrder = await strapi.documents('api::purchase-order.purchase-order').update({
                        documentId: orderId,
                        data: cleanOrderData,
                        populate: ['warehouse', 'supplier'] as any,
                        status: 'published',
                    });
                } else {
                    savedOrder = await strapi.documents('api::purchase-order.purchase-order').create({
                        data: {
                            ...cleanOrderData,
                        },
                        populate: ['warehouse', 'supplier'] as any,
                        status: 'published',
                    });
                }

                const defaultOrderWarehouseDocId =
                    (savedOrder as any)?.warehouse?.documentId ||
                    (cleanOrderData.warehouse
                        ? await resolveEntityDocumentId(strapi, 'api::warehouse.warehouse', cleanOrderData.warehouse)
                        : null);

                // Idempotencia: evitar doble ingreso de stock IN si la orden ya estaba recibida antes
                const wasAlreadyReceived = previousOrder?.status === 'received';

                // 2. Process Stock Adjustments and Product Costs
                if (stockAdjustments && Array.isArray(stockAdjustments) && stockAdjustments.length > 0) {
                    let parsedItems: any[] = [];
                    if (Array.isArray(cleanOrderData.items)) {
                        parsedItems = cleanOrderData.items;
                    } else if (typeof cleanOrderData.items === 'string') {
                        try {
                            const tmp = JSON.parse(cleanOrderData.items);
                            if (Array.isArray(tmp)) parsedItems = tmp;
                        } catch {
                            parsedItems = [];
                        }
                    }

                    for (const adj of stockAdjustments) {
                        const adjType = adj?.type === 'OUT' ? 'OUT' : 'IN';
                        const adjQty = Number(adj?.quantity);
                        if (!adj?.colorId || !Number.isFinite(adjQty) || adjQty <= 0) {
                            const badErr: any = new Error('Todos los ajustes de stock de compra deben tener colorId y cantidad mayor a 0.');
                            badErr.status = 400;
                            throw badErr;
                        }

                        if (adjType === 'IN' && wasAlreadyReceived) {
                            continue;
                        }

                        const colorDocId = await resolveEntityDocumentId(strapi, 'api::color.color', adj.colorId);
                        const colorEntity = colorDocId
                            ? ((await strapi.documents('api::color.color').findOne({
                                  documentId: colorDocId,
                                  populate: ['product'],
                              })) as any)
                            : null;

                        if (!colorEntity) {
                            const missingErr: any = new Error(
                                `Color con ID ${adj.colorId} no encontrado. Abortando para mantener consistencia.`,
                            );
                            missingErr.status = 400;
                            throw missingErr;
                        }

                        const targetWarehouseDocId =
                            (adj.warehouseId
                                ? await resolveEntityDocumentId(strapi, 'api::warehouse.warehouse', adj.warehouseId)
                                : null) || defaultOrderWarehouseDocId;

                        const productTitle = colorEntity.product?.title || 'Producto';
                        const colorName = colorEntity.name || 'N/A';
                        const orderIdentifier = savedOrder.reference || savedOrder.id || savedOrder.documentId;

                        let baseReason = adj.reason || 'Ajuste de Inventario';
                        baseReason = baseReason.replace('{order_id}', orderIdentifier);
                        baseReason = baseReason.replace('#undefined', `#${orderIdentifier}`);

                        const enrichedReason = `${baseReason} - Item: ${productTitle} (${colorName})`;

                        // A. Crear Movimiento de Inventario
                        await strapi.documents('api::inventory-movement.inventory-movement').create({
                            data: {
                                color: colorEntity.documentId,
                                product: colorEntity.product?.documentId || null,
                                ...(targetWarehouseDocId ? { warehouse: targetWarehouseDocId } : {}),
                                quantity: Number(adjQty.toFixed(3)),
                                type: adjType,
                                reason: enrichedReason,
                                date: getStandardISO(),
                                performedBy: performedById || adj.userId || null,
                                exchangeRate: adj.exchangeRate,
                            },
                            status: 'published',
                        });

                        // B. Actualizar Costo del Producto solo cuando entra stock positivo
                        if (adjType === 'IN') {
                            const itemData = parsedItems.find(
                                (i: any) =>
                                    i.colorId === colorEntity.documentId ||
                                    i.colorId === adj.colorId ||
                                    i.productId === colorEntity.product?.documentId,
                            );
                            const unitCost = Number(itemData?.unitCost);
                            if (Number.isFinite(unitCost) && unitCost > 0 && colorEntity.product?.documentId) {
                                await strapi.db.query('api::product.product').updateMany({
                                    where: { documentId: colorEntity.product.documentId },
                                    data: {
                                        costPrice: Number(unitCost.toFixed(4)),
                                    },
                                });
                            }
                        }
                    }
                }

                return { data: savedOrder };
            });
        } catch (err: any) {
            console.error('[PurchaseOrderProcess] Error en transacción:', err);
            const status = err?.status || err?.statusCode || 500;
            if (status >= 400 && status < 500) {
                return ctx.throw(status, err.message || 'Error validando orden de compra');
            }
            return ctx.internalServerError(err?.message || 'Error al procesar la orden de compra e inventario');
        }
    }
    };
});
