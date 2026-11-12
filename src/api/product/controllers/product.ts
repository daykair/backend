/**
 * product controller
 */

import { factories } from '@strapi/strapi';
import { buildAdminFindParams } from '../../../utils/adminQuery';
import {
    createAdminCrudHandlers,
    mergePopulate,
    userHasExactPermission,
} from '../../../utils/adminCrud';

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
    skipMediaIds?: Set<number>,
    deferredMediaQueue?: any[]
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

    if (Array.isArray(deferredMediaQueue)) {
        if (Array.isArray(colorWithRelations.images)) {
            deferredMediaQueue.push(...colorWithRelations.images);
        } else if (colorWithRelations.images) {
            deferredMediaQueue.push(colorWithRelations.images);
        }
        if (colorWithRelations.colorImage) {
            deferredMediaQueue.push(colorWithRelations.colorImage);
        }
    } else {
        await removeMediaFilesSafely(strapi, colorWithRelations.images, skipMediaIds);
        await removeMediaFilesSafely(strapi, colorWithRelations.colorImage, skipMediaIds);
    }

    await strapi.documents('api::color.color').delete({ documentId: colorDocId });
}

export default factories.createCoreController('api::product.product', ({ strapi }) => {
    const crud = createAdminCrudHandlers(strapi, 'api::product.product', {
        defaultPopulate: ['categories', 'productImage'],
        allowedPopulateKeys: ['categories', 'productImage', 'colors'],
    });

    const ALLOWED_PRODUCT_POPULATE = ['categories', 'productImage', 'colors'];

    return {
    updateAdmin: crud.updateAdmin,

    async findAdmin(ctx) {
        try {
            const params = buildAdminFindParams(ctx.query);
            const populate = mergePopulate(
                ctx.query?.populate,
                { categories: true, productImage: true },
                ALLOWED_PRODUCT_POPULATE,
            );
            const products = await strapi.documents('api::product.product').findMany({
                ...params,
                ...(populate !== undefined ? { populate } : {}),
            });

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

            const defaultOnePopulate = {
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
                }
            };
            const populate = mergePopulate(
                ctx.query?.populate,
                defaultOnePopulate,
                ALLOWED_PRODUCT_POPULATE,
            );
            const product = await strapi.documents('api::product.product').findOne({
                documentId: targetDocId,
                populate,
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

        const performedById = ctx.state?.user?.documentId || ctx.state?.user?.id || null;

        try {
            const validIncomingVariants = Array.isArray(variantsData) ? variantsData : [];
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

            const deferredMediaQueue: any[] = [];

            const savedProduct = await strapi.db.transaction(async () => {
                let currentSavedProduct: any = null;

                // 1. Crear o actualizar producto (solo campos permitidos)
                if (isNewProduct) {
                    const createPayload = {
                        ...baseProductPayload,
                        ...(cleanCategories !== undefined ? { categories: cleanCategories } : {}),
                        ...(cleanProductImages !== undefined ? { productImage: cleanProductImages } : {})
                    };
                    currentSavedProduct = await strapi.documents('api::product.product').create({
                        data: createPayload
                    });
                    productId = currentSavedProduct.documentId;
                } else {
                    const updatePayload = {
                        ...baseProductPayload,
                        ...(cleanCategories !== undefined ? { categories: { set: cleanCategories } } : {}),
                        ...(cleanProductImages !== undefined ? { productImage: { set: cleanProductImages } } : {})
                    };
                    currentSavedProduct = await strapi.documents('api::product.product').update({
                        documentId: productId!,
                        data: updatePayload
                    });
                }

                // 2. Sincronizar variantes
                const currentVariants = (await strapi.documents('api::color.color').findMany({
                    filters: { product: { documentId: productId } } as any,
                    populate: ['images', 'colorImage']
                })) as any[];

                const incomingIds = new Set(
                    validIncomingVariants
                        .map((v: any) => v?.documentId || v?.id)
                        .filter(Boolean)
                        .map((id: any) => String(id))
                );

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
                        retainedMediaIds,
                        deferredMediaQueue
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

                    const rawVariantRef = variant.documentId || variant.id;
                    if (rawVariantRef) {
                        // Verificar que la variante pertenezca a este producto (anti-IDOR)
                        const matchedExisting = currentVariants.find(
                            (cv: any) =>
                                String(cv.documentId) === String(rawVariantRef) ||
                                String(cv.id) === String(rawVariantRef)
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

                return currentSavedProduct;
            });

            if (deferredMediaQueue.length > 0) {
                await removeMediaFilesSafely(strapi, deferredMediaQueue, retainedMediaIds);
            }

            return ctx.send({ success: true, data: savedProduct });
        } catch (error: any) {
            console.error('[saveFull Error]:', error);
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
        if (globalWarehouseId) {
            if (!resolvedGlobalWhDocId) {
                return ctx.badRequest('El almacén seleccionado no existe');
            }
            const globalWh = (await strapi.documents('api::warehouse.warehouse').findOne({
                documentId: resolvedGlobalWhDocId,
            })) as any;
            if (!globalWh || globalWh.isActive === false) {
                return ctx.badRequest('El almacén seleccionado está inactivo');
            }
        }

        const errors: string[] = [];
        const requestedByKey = new Map<
            string,
            {
                color: any;
                targetWhDocId: string | null;
                title: string;
                selectedColor: string;
                totalQty: number;
            }
        >();

        for (const item of items) {
            const parsedQty = Number(item?.quantity);
            if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
                errors.push(`Cantidad inválida para ${item?.title || 'Producto'}.`);
                continue;
            }

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

            let targetWhDocId = resolvedGlobalWhDocId;
            if (item.warehouseId) {
                const resolvedItemWhDocId = await resolveDocumentId(
                    strapi,
                    'api::warehouse.warehouse',
                    item.warehouseId,
                );
                const itemWh = resolvedItemWhDocId
                    ? ((await strapi.documents('api::warehouse.warehouse').findOne({
                          documentId: resolvedItemWhDocId,
                      })) as any)
                    : null;

                if (!itemWh || itemWh.isActive === false) {
                    errors.push(
                        `El almacén seleccionado para ${item.title} (${item.selectedColor || ''}) no existe o está inactivo.`,
                    );
                    continue;
                }
                targetWhDocId = resolvedItemWhDocId;
            }

            const key = `${color.documentId}::${targetWhDocId || 'GLOBAL'}`;
            const prev = requestedByKey.get(key);
            if (prev) {
                prev.totalQty = Number((prev.totalQty + parsedQty).toFixed(3));
            } else {
                requestedByKey.set(key, {
                    color,
                    targetWhDocId,
                    title: item.title || 'Producto',
                    selectedColor: item.selectedColor || '',
                    totalQty: Number(parsedQty.toFixed(3)),
                });
            }
        }

        for (const reqEntry of requestedByKey.values()) {
            const { color, targetWhDocId, title, selectedColor, totalQty } = reqEntry;
            if (targetWhDocId) {
                const whStock = await strapi.documents('api::warehouse-stock.warehouse-stock').findFirst({
                    filters: {
                        color: { documentId: color.documentId },
                        warehouse: { documentId: targetWhDocId }
                    } as any
                });
                const available = Number(whStock?.stock || 0);
                if (available < totalQty) {
                    errors.push(
                        `Stock insuficiente en el almacén para ${title} (${selectedColor}). Pedidos: ${totalQty}, Disponibles: ${available}.`
                    );
                }
            } else if (Number(color.stock || 0) < totalQty) {
                errors.push(`Stock insuficiente para ${title} (${selectedColor}). Pedidos: ${totalQty}, Disponibles: ${color.stock}.`);
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
            const ALLOWED_ROOT_FILTERS = new Set([
                'title',
                'slug',
                'productCode',
                'description',
                'price',
                'wholesalePrice',
                'isActive',
                'isWeighed',
                'isFeaturedNew',
                'isDiscounted',
                'discount',
                'hasVariants',
                'categories',
                'colors',
            ]);
            const ALLOWED_CATEGORY_FILTERS = new Set(['id', 'documentId', 'slug', 'categoryName']);
            const ALLOWED_COLOR_FILTERS = new Set(['id', 'documentId', 'name', 'code', 'stock', 'isDiscounted', 'discount']);
            const ALLOWED_OPERATORS = new Set([
                '$eq', '$eqi', '$ne', '$in', '$notIn', '$lt', '$lte', '$gt', '$gte',
                '$contains', '$containsi', '$notContains', '$notContainsi',
                '$startsWith', '$endsWith', '$null', '$notNull', '$between',
            ]);
            const ALLOWED_SORT_FIELDS = new Set([
                'createdAt', 'updatedAt', 'title', 'price', 'wholesalePrice',
                'isFeaturedNew', 'isDiscounted', 'discount',
            ]);

            const sanitizeOperatorNode = (node: any): any => {
                if (node === null || node === undefined) return undefined;
                if (typeof node !== 'object' || Array.isArray(node)) return node;
                const clean: Record<string, any> = {};
                for (const [op, val] of Object.entries(node)) {
                    if (ALLOWED_OPERATORS.has(op)) {
                        clean[op] = val;
                    }
                }
                return Object.keys(clean).length > 0 ? clean : undefined;
            };

            const sanitizeRelationFilter = (node: any, allowedFields: Set<string>): any => {
                if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined;
                const clean: Record<string, any> = {};
                for (const [k, v] of Object.entries(node)) {
                    if (!allowedFields.has(k)) continue;
                    const sanitized = sanitizeOperatorNode(v);
                    if (sanitized !== undefined) clean[k] = sanitized;
                }
                return Object.keys(clean).length > 0 ? clean : undefined;
            };

            const sanitizeFilterNode = (node: any): Record<string, any> => {
                if (!node || typeof node !== 'object' || Array.isArray(node)) return {};
                const clean: Record<string, any> = {};
                for (const [key, val] of Object.entries(node)) {
                    if ((key === '$or' || key === '$and') && Array.isArray(val)) {
                        const cleanGroup = val
                            .map((sub) => sanitizeFilterNode(sub))
                            .filter((sub) => Object.keys(sub).length > 0);
                        if (cleanGroup.length > 0) clean[key] = cleanGroup;
                        continue;
                    }
                    if (!ALLOWED_ROOT_FILTERS.has(key)) continue;
                    if (key === 'categories') {
                        const rel = sanitizeRelationFilter(val, ALLOWED_CATEGORY_FILTERS);
                        if (rel) clean.categories = rel;
                    } else if (key === 'colors') {
                        const rel = sanitizeRelationFilter(val, ALLOWED_COLOR_FILTERS);
                        if (rel) clean.colors = rel;
                    } else {
                        const op = sanitizeOperatorNode(val);
                        if (op !== undefined) clean[key] = op;
                    }
                }
                return clean;
            };

            const sanitizeSort = (rawSort: any): any => {
                if (!rawSort) return undefined;
                const items = Array.isArray(rawSort) ? rawSort : [rawSort];
                const clean = items
                    .filter((entry) => typeof entry === 'string')
                    .map((entry: string) => {
                        const [field, dir] = entry.split(':');
                        if (!ALLOWED_SORT_FIELDS.has(field)) return null;
                        const cleanDir = dir?.toLowerCase() === 'desc' ? 'desc' : 'asc';
                        return `${field}:${cleanDir}`;
                    })
                    .filter(Boolean);
                return clean.length > 0 ? clean : undefined;
            };

            const params = buildAdminFindParams(ctx.query);
            const rawFilters = sanitizeFilterNode(params.filters);

            if (ctx.query?.slug) {
                rawFilters.slug = { $eq: String(ctx.query.slug) };
            }
            if (ctx.query?.featured === 'true') {
                rawFilters.isFeaturedNew = { $eq: true };
            }

            rawFilters.isActive = { $eq: true };

            const requireInStock = Boolean(rawFilters?.colors?.stock?.$gt !== undefined);
            const requireDiscounted = String(ctx.query?.discounted || '').toLowerCase() === 'true';

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

            const safeSort = sanitizeSort(params.sort);
            const allMatching: any[] = await strapi.documents('api::product.product').findMany({
                filters: dbFilters,
                ...(safeSort ? { sort: safeSort } : {}),
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
                    if (requireInStock && !product.colors.some((color: any) => Number(color.stock || 0) > 0)) {
                        return false;
                    }
                    if (requireDiscounted) {
                        const prodDisc = product.isDiscounted && Number(product.discount || 0) > 0;
                        const varDisc = product.colors.some((c: any) => c.isDiscounted && Number(c.discount || 0) > 0);
                        const catDisc = Array.isArray(product.categories) &&
                            product.categories.some((cat: any) => Number(cat?.discount ?? cat?.Discount ?? 0) > 0);
                        if (!prodDisc && !varDisc && !catDisc) return false;
                    }
                    return true;
                });

            const total = sanitized.length;
            const start = Number.isFinite(Number(params.start)) && Number(params.start) >= 0 ? Number(params.start) : 0;
            const rawRequestedLimit = Number(params.limit);
            const hasRequestedLimit = Number.isFinite(rawRequestedLimit) && rawRequestedLimit > 0;
            const effectiveLimit = hasRequestedLimit ? Math.min(100, rawRequestedLimit) : Math.min(200, Math.max(total - start, 0));
            const paged = sanitized.slice(start, start + effectiveLimit);

            return ctx.send({
                data: paged,
                meta: {
                    pagination: {
                        start,
                        limit: hasRequestedLimit ? effectiveLimit : total,
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
