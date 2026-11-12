/**
 * product controller
 */

import { factories } from '@strapi/strapi';
import { buildAdminFindParams } from '../../../utils/adminQuery';
import { createAdminCrudHandlers } from '../../../utils/adminCrud';

function slugifySpanish(value: string): string {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');
}

async function resolveDocumentId(
    strapi: any,
    uid: string,
    idOrDocId: string | number | undefined | null
): Promise<string | null> {
    if (idOrDocId === undefined || idOrDocId === null || idOrDocId === '') return null;
    const raw = String(idOrDocId).trim();
    if (!raw) return null;

    if (!isNaN(Number(raw)) && !raw.includes('-')) {
        const entity = await strapi.documents(uid).findFirst({
            filters: { id: Number(raw) } as any
        });
        return entity?.documentId || null;
    }

    const entity = await strapi.documents(uid).findOne({ documentId: raw });
    return entity?.documentId || null;
}

async function resolveUniqueSlug(
    strapi: any,
    desiredSlug: string,
    excludeProductDocId?: string | null
): Promise<string> {
    const base = slugifySpanish(desiredSlug) || 'producto';
    let candidate = base;
    let suffix = 2;

    while (suffix <= 50) {
        const existing = await strapi.documents('api::product.product').findFirst({
            filters: {
                slug: candidate,
                ...(excludeProductDocId ? { documentId: { $ne: excludeProductDocId } } : {})
            } as any
        });
        if (!existing) return candidate;
        candidate = `${base}-${suffix}`;
        suffix += 1;
    }

    return `${base}-${Date.now()}`;
}

async function resolveTargetWarehouseDocId(
    strapi: any,
    preferredWarehouseId?: string | number | null
): Promise<string | null> {
    if (preferredWarehouseId) {
        const resolved = await resolveDocumentId(strapi, 'api::warehouse.warehouse', preferredWarehouseId);
        if (resolved) return resolved;
    }

    const mainActive = await strapi.documents('api::warehouse.warehouse').findFirst({
        filters: { code: 'MAIN', isActive: true } as any
    });
    if (mainActive?.documentId) return mainActive.documentId;

    const mainAny = await strapi.documents('api::warehouse.warehouse').findFirst({
        filters: { code: 'MAIN' } as any
    });
    if (mainAny?.documentId) return mainAny.documentId;

    const firstActive = await strapi.documents('api::warehouse.warehouse').findFirst({
        filters: { isActive: true } as any
    });
    return firstActive?.documentId || null;
}

async function resolveCategoryDocIds(strapi: any, rawCategories: any[]): Promise<string[]> {
    const resolved: string[] = [];
    for (const item of rawCategories) {
        if (!item) continue;
        const raw = typeof item === 'object' ? (item.documentId || item.id) : item;
        const docId = await resolveDocumentId(strapi, 'api::category.category', raw);
        if (docId && !resolved.includes(docId)) {
            resolved.push(docId);
        }
    }
    return resolved;
}

async function userHasExactPermission(strapi: any, user: any, action: string): Promise<boolean> {
    if (!user) return false;
    const roleType = String(user.role?.type || '').toLowerCase();
    const roleName = String(user.role?.name || '').toLowerCase();
    const isSuperAdmin = roleType === 'admin' || roleType.includes('admin') || roleName.includes('admin');
    if (isSuperAdmin) return true;

    const roleId = user.role?.id;
    if (!roleId) return false;

    const matched = await strapi.db.query('plugin::users-permissions.permission').findOne({
        where: { role: roleId, action }
    });
    return Boolean(matched);
}

async function removeMediaFilesSafely(strapi: any, mediaInput: any, skipMediaIds?: Set<number>) {
    if (!mediaInput) return;
    const files = Array.isArray(mediaInput) ? mediaInput : [mediaInput];
    const fileService = strapi.plugin('upload').service('upload');

    for (const img of files) {
        if (!img?.id) continue;
        if (skipMediaIds && skipMediaIds.has(Number(img.id))) continue;
        try {
            await fileService.remove(img);
        } catch (err) {
            console.error('[Product Controller] Error removing orphaned media:', err);
        }
    }
}

async function deleteVariantWithStockCleanup(
    strapi: any,
    colorDocId: string,
    reason: string,
    performedById?: string | number | null,
    skipMediaIds?: Set<number>
) {
    const colorWithRelations = await strapi.documents('api::color.color').findOne({
        documentId: colorDocId,
        populate: {
            images: true,
            colorImage: true,
            warehouse_stocks: {
                populate: {
                    warehouse: true
                }
            }
        }
    }) as any;

    if (!colorWithRelations) return;

    const warehouseStocks = Array.isArray(colorWithRelations.warehouse_stocks)
        ? colorWithRelations.warehouse_stocks
        : [];

    for (const ws of warehouseStocks) {
        const qty = Number(ws?.stock || 0);
        const whDocId = ws?.warehouse?.documentId;
        if (qty > 0 && whDocId) {
            try {
                await strapi.documents('api::inventory-movement.inventory-movement').create({
                    data: {
                        type: 'OUT',
                        quantity: qty,
                        color: colorDocId,
                        warehouse: whDocId,
                        reason,
                        date: new Date().toISOString(),
                        ...(performedById ? { performedBy: performedById } : {})
                    } as any
                });
            } catch (movErr) {
                console.error('[Product Controller] Error logging OUT movement on variant delete:', movErr);
            }
        }
    }

    for (const ws of warehouseStocks) {
        if (ws?.documentId) {
            try {
                await strapi.documents('api::warehouse-stock.warehouse-stock').delete({
                    documentId: ws.documentId
                });
            } catch (wsErr) {
                console.error('[Product Controller] Error deleting warehouse-stock:', wsErr);
            }
        }
    }

    await removeMediaFilesSafely(strapi, colorWithRelations.images, skipMediaIds);
    await removeMediaFilesSafely(strapi, colorWithRelations.colorImage, skipMediaIds);

    await strapi.documents('api::color.color').delete({ documentId: colorDocId });
}

export default factories.createCoreController('api::product.product', ({ strapi }) => {
    const crud = createAdminCrudHandlers(strapi, 'api::product.product', {
        defaultPopulate: ['categories', 'productImage'],
    });

    return {
    updateAdmin: crud.updateAdmin,

    async findAdmin(ctx) {
        try {
            const params = buildAdminFindParams(ctx.query);
            const products = await strapi.documents('api::product.product').findMany(params);

            return ctx.send({ data: products });
        } catch (err: any) {
            console.error('[findAdmin Error]:', err);
            return ctx.internalServerError(err?.message || 'Error al obtener productos');
        }
    },

    async findOneAdmin(ctx) {
        try {
            const targetDocId = await resolveDocumentId(strapi, 'api::product.product', ctx.params.id);
            if (!targetDocId) {
                return ctx.notFound('Producto no encontrado');
            }

            const queryPopulate = (ctx.query?.populate as any) || {};
            const product = await strapi.documents('api::product.product').findOne({
                ...ctx.query,
                documentId: targetDocId,
                populate: {
                    categories: true,
                    productImage: true,
                    colors: {
                        populate: {
                            images: true,
                            colorImage: true,
                            warehouse_stocks: {
                                populate: {
                                    warehouse: true
                                }
                            }
                        }
                    },
                    ...queryPopulate
                }
            });

            if (!product) {
                return ctx.notFound('Producto no encontrado');
            }

            return ctx.send({ data: product });
        } catch (err: any) {
            console.error('[findOneAdmin Error]:', err);
            return ctx.internalServerError(err?.message || 'Error al obtener el producto');
        }
    },

    async saveFull(ctx) {
        const bodyData = ctx.request.body?.data;
        if (!bodyData || !bodyData.productData) {
            return ctx.badRequest('Se requieren los datos del producto (productData).');
        }

        const { productData: rawProduct, variantsData = [] } = bodyData;
        const rawProductId = rawProduct.documentId || rawProduct.id;
        let productId: string | null = null;

        if (rawProductId) {
            productId = await resolveDocumentId(strapi, 'api::product.product', rawProductId);
            if (!productId) {
                return ctx.notFound('El producto a editar no existe.');
            }
        }

        const isNewProduct = !productId;
        const authStrategy = ctx.state?.auth?.strategy?.name;

        // Validar permiso específico de la operación (creación vs actualización)
        if (authStrategy !== 'api-token') {
            const requiredPerm = isNewProduct ? 'api::product.product.create' : 'api::product.product.update';
            const allowed = await userHasExactPermission(strapi, ctx.state?.user, requiredPerm);
            if (!allowed) {
                return ctx.forbidden(
                    isNewProduct
                        ? 'No tienes permisos para crear productos.'
                        : 'No tienes permisos para actualizar productos.'
                );
            }
        }

        const title = String(rawProduct.title || '').trim();
        if (!title) {
            return ctx.badRequest('El nombre del producto es obligatorio.');
        }

        const cleanProductCode =
            rawProduct.productCode !== undefined && rawProduct.productCode !== null
                ? String(rawProduct.productCode).trim() || null
                : null;

        if (cleanProductCode) {
            const duplicateSku = await strapi.documents('api::product.product').findFirst({
                filters: {
                    productCode: cleanProductCode,
                    ...(productId ? { documentId: { $ne: productId } } : {})
                } as any
            });
            if (duplicateSku) {
                return ctx.badRequest(`Ya existe otro producto con el código SKU "${cleanProductCode}".`);
            }
        }

        const cleanIsDiscounted = Boolean(rawProduct.isDiscounted);
        const cleanDiscount = cleanIsDiscounted
            ? Number(Math.min(100, Math.max(0, Number(rawProduct.discount) || 0)).toFixed(2))
            : 0;

        const cleanPrice = Math.max(0, Number(rawProduct.price) || 0);
        const cleanWholesalePrice = Math.max(0, Number(rawProduct.wholesalePrice) || 0);
        const cleanCostPrice = Math.max(0, Number(rawProduct.costPrice) || 0);

        const desiredSlug = rawProduct.slug ? String(rawProduct.slug).trim() : title;
        const uniqueSlug = await resolveUniqueSlug(strapi, desiredSlug, productId);

        const cleanCategories = Array.isArray(rawProduct.categories)
            ? await resolveCategoryDocIds(strapi, rawProduct.categories)
            : undefined;

        const cleanProductImages = Array.isArray(rawProduct.productImage)
            ? rawProduct.productImage
                  .map((img: any) => (typeof img === 'object' ? Number(img?.id) : Number(img)))
                  .filter((id: number) => Number.isFinite(id) && id > 0)
            : undefined;

        const baseProductPayload: any = {
            title,
            slug: uniqueSlug,
            productCode: cleanProductCode,
            description: rawProduct.description !== undefined ? String(rawProduct.description || '') : '',
            price: cleanPrice,
            wholesalePrice: cleanWholesalePrice,
            costPrice: cleanCostPrice,
            isActive: rawProduct.isActive !== undefined ? Boolean(rawProduct.isActive) : true,
            isWeighed: Boolean(rawProduct.isWeighed),
            isFeaturedNew: Boolean(rawProduct.isFeaturedNew),
            isDiscounted: cleanIsDiscounted,
            discount: cleanDiscount,
            hasVariants: rawProduct.hasVariants !== undefined ? Boolean(rawProduct.hasVariants) : true,
        };

        let savedProduct: any = null;
        const createdVariantDocIds: string[] = [];
        const performedById = ctx.state?.user?.documentId || ctx.state?.user?.id || null;

        try {
            // 1. Crear o actualizar producto (solo campos permitidos)
            if (isNewProduct) {
                const createPayload = {
                    ...baseProductPayload,
                    ...(cleanCategories !== undefined ? { categories: cleanCategories } : {}),
                    ...(cleanProductImages !== undefined ? { productImage: cleanProductImages } : {})
                };
                savedProduct = await strapi.documents('api::product.product').create({
                    data: createPayload
                });
                productId = savedProduct.documentId;
            } else {
                const updatePayload = {
                    ...baseProductPayload,
                    ...(cleanCategories !== undefined ? { categories: { set: cleanCategories } } : {}),
                    ...(cleanProductImages !== undefined ? { productImage: { set: cleanProductImages } } : {})
                };
                savedProduct = await strapi.documents('api::product.product').update({
                    documentId: productId!,
                    data: updatePayload
                });
            }

            // 2. Sincronizar variantes
            const currentVariants = (await strapi.documents('api::color.color').findMany({
                filters: { product: { documentId: productId } } as any,
                populate: ['images', 'colorImage']
            })) as any[];

            const validIncomingVariants = Array.isArray(variantsData) ? variantsData : [];
            const incomingIds = new Set(
                validIncomingVariants.filter((v: any) => v?.id).map((v: any) => String(v.id))
            );

            // Recolectar imágenes aún referenciadas por variantes que permanecen
            const retainedMediaIds = new Set<number>();
            for (const v of validIncomingVariants) {
                if (Array.isArray(v?.images)) {
                    for (const imgId of v.images) {
                        const num = Number(imgId);
                        if (Number.isFinite(num) && num > 0) retainedMediaIds.add(num);
                    }
                }
                if (v?.colorImage) {
                    const num = Number(v.colorImage);
                    if (Number.isFinite(num) && num > 0) retainedMediaIds.add(num);
                }
            }

            // Eliminar variantes removidas
            const variantsToDelete = currentVariants.filter(
                (cv: any) =>
                    !incomingIds.has(String(cv.documentId)) && !incomingIds.has(String(cv.id))
            );
            for (const cv of variantsToDelete) {
                await deleteVariantWithStockCleanup(
                    strapi,
                    cv.documentId,
                    `Variante eliminada al actualizar "${title}"`,
                    performedById,
                    retainedMediaIds
                );
            }

            // Crear o actualizar variantes activas
            for (const variant of validIncomingVariants) {
                if (!variant) continue;

                const variantName = String(variant.name || '').trim() || 'Estándar';
                const variantCode = String(variant.code || '000000').replace(/#/g, '').slice(0, 6) || '000000';
                const vIsDiscounted = Boolean(variant.isDiscounted);
                const vDiscount = vIsDiscounted
                    ? Number(Math.min(100, Math.max(0, Number(variant.discount) || 0)).toFixed(2))
                    : 0;

                const cleanImages = Array.isArray(variant.images)
                    ? variant.images
                          .map((img: any) => (typeof img === 'object' ? Number(img?.id) : Number(img)))
                          .filter((id: number) => Number.isFinite(id) && id > 0)
                    : undefined;

                let cleanColorImage: number | null | undefined = undefined;
                if (variant.colorImage === null) {
                    cleanColorImage = null;
                } else if (variant.colorImage !== undefined) {
                    const num = typeof variant.colorImage === 'object'
                        ? Number(variant.colorImage?.id)
                        : Number(variant.colorImage);
                    if (Number.isFinite(num) && num > 0) {
                        cleanColorImage = num;
                    }
                }

                if (variant.id) {
                    // Verificar que la variante pertenezca a este producto (anti-IDOR)
                    const matchedExisting = currentVariants.find(
                        (cv: any) =>
                            String(cv.documentId) === String(variant.id) ||
                            String(cv.id) === String(variant.id)
                    );
                    if (!matchedExisting) {
                        throw new Error(`La variante "${variantName}" no pertenece a este producto.`);
                    }

                    // No sobrescribir `stock` en variantes existentes para no perder movimientos concurrentes
                    const updateData: any = {
                        name: variantName,
                        code: variantCode,
                        isDiscounted: vIsDiscounted,
                        discount: vDiscount,
                        ...(cleanImages !== undefined ? { images: { set: cleanImages } } : {}),
                        ...(cleanColorImage !== undefined ? { colorImage: cleanColorImage } : {})
                    };

                    await strapi.documents('api::color.color').update({
                        documentId: matchedExisting.documentId,
                        data: updateData
                    });
                } else {
                    const initialStock = Math.max(0, Number(variant.stock) || 0);
                    const targetWhDocId =
                        initialStock > 0
                            ? await resolveTargetWarehouseDocId(strapi, variant.initialWarehouseId)
                            : null;

                    // Si hay almacén, crear la variante con stock: 0 para que el movimiento IN inicial
                    // genere warehouse_stock + historial de movimientos + stock agregado sin doble conteo
                    const createData: any = {
                        product: productId,
                        name: variantName,
                        code: variantCode,
                        stock: initialStock > 0 && !targetWhDocId ? initialStock : 0,
                        isDiscounted: vIsDiscounted,
                        discount: vDiscount,
                        ...(cleanImages !== undefined ? { images: cleanImages } : {}),
                        ...(cleanColorImage ? { colorImage: cleanColorImage } : {})
                    };

                    const createdColor = await strapi.documents('api::color.color').create({
                        data: createData
                    });
                    createdVariantDocIds.push(createdColor.documentId);

                    if (initialStock > 0 && targetWhDocId) {
                        await strapi.documents('api::inventory-movement.inventory-movement').create({
                            data: {
                                type: 'IN',
                                quantity: initialStock,
                                color: createdColor.documentId,
                                product: productId,
                                warehouse: targetWhDocId,
                                reason: `Stock inicial de catálogo: ${title} (${variantName})`,
                                date: new Date().toISOString(),
                                ...(performedById ? { performedBy: performedById } : {})
                            } as any
                        });
                    }
                }
            }

            return ctx.send({ success: true, data: savedProduct });
        } catch (error: any) {
            console.error('[saveFull Error]:', error);

            // Rollback limpio si falló durante creación inicial
            if (isNewProduct && savedProduct?.documentId) {
                for (const createdColorDocId of createdVariantDocIds) {
                    try {
                        await deleteVariantWithStockCleanup(
                            strapi,
                            createdColorDocId,
                            'Rollback de creación de producto'
                        );
                    } catch (rollbackColorErr) {
                        console.error('Error rolling back variant:', rollbackColorErr);
                    }
                }
                try {
                    await strapi.documents('api::product.product').delete({
                        documentId: savedProduct.documentId
                    });
                } catch (rollbackProdErr) {
                    console.error('Rollback failed:', rollbackProdErr);
                }
            }

            return ctx.badRequest('Error guardando producto y variantes: ' + (error?.message || error));
        }
    },

    async deleteAdmin(ctx) {
        try {
            const targetDocId = await resolveDocumentId(strapi, 'api::product.product', ctx.params.id);
            if (!targetDocId) {
                return ctx.notFound('Producto no encontrado');
            }

            const product = (await strapi.documents('api::product.product').findOne({
                documentId: targetDocId,
                populate: {
                    productImage: true,
                    colors: true
                }
            })) as any;

            if (!product) {
                return ctx.notFound('Producto no encontrado');
            }

            const performedById = ctx.state?.user?.documentId || ctx.state?.user?.id || null;
            const colors = Array.isArray(product.colors) ? product.colors : [];

            for (const color of colors) {
                if (color?.documentId) {
                    await deleteVariantWithStockCleanup(
                        strapi,
                        color.documentId,
                        `Producto eliminado del catálogo: "${product.title}" (${color.name || 'Estándar'})`,
                        performedById
                    );
                }
            }

            await removeMediaFilesSafely(strapi, product.productImage);
            await strapi.documents('api::product.product').delete({ documentId: targetDocId });

            return ctx.send({ success: true, data: { documentId: targetDocId } });
        } catch (error: any) {
            console.error('[deleteAdmin Error]:', error);
            return ctx.internalServerError('Error eliminando producto: ' + (error?.message || error));
        }
    },

    async validateStock(ctx) {
        const { items, warehouseId: globalWarehouseId } = ctx.request.body.data || {};
        if (!items || !Array.isArray(items)) {
            return ctx.badRequest('Items array is required');
        }

        const resolvedGlobalWhDocId = globalWarehouseId
            ? await resolveDocumentId(strapi, 'api::warehouse.warehouse', globalWarehouseId)
            : null;
        if (globalWarehouseId && !resolvedGlobalWhDocId) {
            return ctx.badRequest('El almacén seleccionado no existe');
        }

        const errors = [];
        for (const item of items) {
            const colorDocId = await resolveDocumentId(strapi, 'api::color.color', item.colorId);
            const color = colorDocId
                ? await strapi.documents('api::color.color').findOne({
                      documentId: colorDocId
                  })
                : null;

            if (!color) {
                errors.push(`La variante ${item.selectedColor || ''} del producto ${item.title} ya no existe.`);
                continue;
            }

            const itemWhInput = item.warehouseId || globalWarehouseId;
            const targetWhDocId = item.warehouseId
                ? await resolveDocumentId(strapi, 'api::warehouse.warehouse', item.warehouseId)
                : resolvedGlobalWhDocId;

            if (itemWhInput && targetWhDocId) {
                const whStock = await strapi.documents('api::warehouse-stock.warehouse-stock').findFirst({
                    filters: {
                        color: { documentId: color.documentId },
                        warehouse: { documentId: targetWhDocId }
                    } as any
                });
                const available = Number(whStock?.stock || 0);
                if (available < Number(item.quantity)) {
                    errors.push(
                        `Stock insuficiente en el almacén para ${item.title} (${item.selectedColor || ''}). Pedidos: ${item.quantity}, Disponibles: ${available}.`
                    );
                }
            } else if (Number(color.stock) < Number(item.quantity)) {
                errors.push(`Stock insuficiente para ${item.title} (${item.selectedColor || ''}). Pedidos: ${item.quantity}, Disponibles: ${color.stock}.`);
            }
        }

        if (errors.length > 0) {
            return ctx.send({ success: false, errors });
        }

        return ctx.send({ success: true });
    },

    async uploadAdmin(ctx, next) {
        try {
            console.log('[uploadAdmin] Recibida solicitud de subida de archivo para personal administrativo');
            const files = (ctx.request as any).files?.files;
            console.log('[uploadAdmin] Archivos recibidos:', {
                hasFiles: Boolean(files),
                isArray: Array.isArray(files),
                count: Array.isArray(files) ? files.length : (files ? 1 : 0),
                fileName: Array.isArray(files) ? files[0]?.name : files?.name,
                fileSize: Array.isArray(files) ? files[0]?.size : files?.size
            });

            await (strapi.plugin('upload').controller('content-api') as any).upload(ctx, next);
            console.log('[uploadAdmin] Subida completada exitosamente. Status:', ctx.status);
            return ctx.body;
        } catch (err: any) {
            console.error('[uploadAdmin] Error procesando subida de archivo:', {
                message: err?.message,
                name: err?.name,
                status: err?.status,
                stack: err?.stack,
                details: err?.details
            });
            throw err;
        }
    },

    /**
     * Endpoint público para el storefront: omite costPrice y aplica stock del almacén web si está configurado.
     */
    async findStorefront(ctx) {
        try {
            const params = buildAdminFindParams(ctx.query);
            const rawFilters = params.filters && typeof params.filters === 'object' ? { ...params.filters } : {};

            if (ctx.query?.slug) {
                rawFilters.slug = { $eq: String(ctx.query.slug) };
            }
            if (ctx.query?.featured === 'true') {
                rawFilters.isFeaturedNew = { $eq: true };
            }

            rawFilters.isActive = { $eq: true };

            const requireInStock = Boolean(rawFilters?.colors?.stock?.$gt !== undefined);

            const companySetting = await (strapi.documents('api::company-setting.company-setting' as any) as any)
                .findFirst()
                .catch(() => null);
            const configuredWhId = companySetting?.logisticsSettings?.webWarehouseId || null;

            let webWhDocId: string | null = null;
            if (configuredWhId) {
                const candidateDocId = await resolveDocumentId(strapi, 'api::warehouse.warehouse', configuredWhId);
                if (candidateDocId) {
                    const wh = await strapi.documents('api::warehouse.warehouse').findOne({
                        documentId: candidateDocId
                    }) as any;
                    if (wh && wh.isActive !== false) {
                        webWhDocId = wh.documentId;
                    }
                }
            }

            const dbFilters: any = { ...rawFilters };
            if (webWhDocId && dbFilters.colors && typeof dbFilters.colors === 'object') {
                const { stock: _ignoredStockFilter, ...restColorFilters } = dbFilters.colors;
                if (Object.keys(restColorFilters).length > 0) {
                    dbFilters.colors = restColorFilters;
                } else {
                    delete dbFilters.colors;
                }
            }

            const storefrontPopulate = {
                categories: true,
                productImage: true,
                colors: {
                    populate: {
                        images: true,
                        colorImage: true
                    }
                }
            };

            const allMatching: any[] = await strapi.documents('api::product.product').findMany({
                filters: dbFilters,
                ...(params.sort ? { sort: params.sort } : {}),
                populate: storefrontPopulate,
                limit: 5000
            });

            const stockByColorDocId = new Map<string, number>();
            if (webWhDocId) {
                const whStocks: any[] = await strapi.documents('api::warehouse-stock.warehouse-stock').findMany({
                    filters: { warehouse: { documentId: webWhDocId } } as any,
                    populate: { color: true },
                    limit: 20000
                });
                for (const ws of whStocks) {
                    const cDocId = ws?.color?.documentId;
                    if (cDocId) {
                        stockByColorDocId.set(String(cDocId), Number(ws.stock || 0));
                    }
                }
            }

            const sanitized = allMatching
                .map((product) => {
                    const { costPrice: _hiddenCostPrice, ...safeProduct } = product;
                    const colors = Array.isArray(safeProduct.colors)
                        ? safeProduct.colors.map((color: any) => ({
                              ...color,
                              stock: webWhDocId
                                  ? stockByColorDocId.get(String(color.documentId)) ?? 0
                                  : Number(color.stock ?? 0)
                          }))
                        : [];
                    return {
                        ...safeProduct,
                        colors
                    };
                })
                .filter((product) => {
                    if (!requireInStock) return true;
                    return product.colors.some((color: any) => Number(color.stock || 0) > 0);
                });

            const total = sanitized.length;
            const start = Number.isFinite(Number(params.start)) && Number(params.start) >= 0 ? Number(params.start) : 0;
            const requestedLimit = Number(params.limit);
            const paged =
                Number.isFinite(requestedLimit) && requestedLimit > 0
                    ? sanitized.slice(start, start + requestedLimit)
                    : sanitized.slice(start);

            return ctx.send({
                data: paged,
                meta: {
                    pagination: {
                        start,
                        limit: Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : total,
                        total
                    }
                }
            });
        } catch (err: any) {
            console.error('[findStorefront Error]:', err);
            return ctx.internalServerError(err?.message || 'Error al obtener catálogo del storefront');
        }
    },

    /**
     * Consulta pública de disponibilidad en tiempo real de una o todas las variantes respetando el almacén web.
     */
    async findStorefrontColorStock(ctx) {
        try {
            const companySetting = await (strapi.documents('api::company-setting.company-setting' as any) as any)
                .findFirst()
                .catch(() => null);
            const configuredWhId = companySetting?.logisticsSettings?.webWarehouseId || null;

            let webWhDocId: string | null = null;
            if (configuredWhId) {
                const candidateWhDocId = await resolveDocumentId(strapi, 'api::warehouse.warehouse', configuredWhId);
                if (candidateWhDocId) {
                    const wh = await strapi.documents('api::warehouse.warehouse').findOne({
                        documentId: candidateWhDocId
                    }) as any;
                    if (wh && wh.isActive !== false) {
                        webWhDocId = wh.documentId;
                    }
                }
            }

            if (!ctx.params?.id) {
                const colors: any[] = await strapi.documents('api::color.color').findMany({
                    limit: 20000
                });

                const stockByColorDocId = new Map<string, number>();
                if (webWhDocId) {
                    const whStocks: any[] = await strapi.documents('api::warehouse-stock.warehouse-stock').findMany({
                        filters: { warehouse: { documentId: webWhDocId } } as any,
                        populate: { color: true },
                        limit: 20000
                    });
                    for (const ws of whStocks) {
                        const cDocId = ws?.color?.documentId;
                        if (cDocId) {
                            stockByColorDocId.set(String(cDocId), Number(ws.stock || 0));
                        }
                    }
                }

                return ctx.send({
                    data: colors.map((color) => ({
                        id: color.id,
                        documentId: color.documentId,
                        name: color.name,
                        stock: webWhDocId
                            ? stockByColorDocId.get(String(color.documentId)) ?? 0
                            : Number(color.stock ?? 0)
                    }))
                });
            }

            const colorDocId = await resolveDocumentId(strapi, 'api::color.color', ctx.params.id);
            if (!colorDocId) {
                return ctx.notFound('Variante no encontrada');
            }

            const color = await strapi.documents('api::color.color').findOne({
                documentId: colorDocId
            }) as any;
            if (!color) {
                return ctx.notFound('Variante no encontrada');
            }

            let effectiveStock = Number(color.stock ?? 0);
            if (webWhDocId) {
                const whStock = await strapi.documents('api::warehouse-stock.warehouse-stock').findFirst({
                    filters: {
                        color: { documentId: color.documentId },
                        warehouse: { documentId: webWhDocId }
                    } as any
                });
                effectiveStock = Number(whStock?.stock ?? 0);
            }

            return ctx.send({
                data: {
                    id: color.id,
                    documentId: color.documentId,
                    name: color.name,
                    stock: effectiveStock
                }
            });
        } catch (err: any) {
            console.error('[findStorefrontColorStock Error]:', err);
            return ctx.internalServerError(err?.message || 'Error al consultar stock de variante');
        }
    },

    /**
     * Endpoint público para consultar la paleta de colores activos en el catálogo sin exponer campos privados.
     */
    async findStorefrontColors(ctx) {
        try {
            const colors: any[] = await strapi.documents('api::color.color').findMany({
                populate: {
                    colorImage: true,
                    images: true
                },
                limit: 20000
            });

            return ctx.send({
                data: colors.map((c) => ({
                    id: c.id,
                    documentId: c.documentId,
                    name: c.name,
                    code: c.code,
                    discount: c.discount ?? 0,
                    isDiscounted: Boolean(c.isDiscounted),
                    colorImage: c.colorImage || null,
                    images: c.images || null
                }))
            });
        } catch (err: any) {
            console.error('[findStorefrontColors Error]:', err);
            return ctx.internalServerError(err?.message || 'Error al consultar colores');
        }
    }
    };
});
