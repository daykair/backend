/**
 * product controller
 */

import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::product.product', ({ strapi }) => ({
    // ... tus métodos existentes ...
    async findAdmin(ctx) {
        try {
            const products = await strapi.documents('api::product.product').findMany({
                ...ctx.query
            })

            return ctx.send({ data: products })
        } catch (err) {
            ctx.body = err;
        }
    },
    async findOneAdmin(ctx) {
        try {
            let targetDocId = ctx.params.id;
            if (targetDocId && !isNaN(Number(targetDocId))) {
                const foundProduct = await strapi.documents('api::product.product').findFirst({
                    filters: { id: Number(targetDocId) } as any
                });
                if (foundProduct) {
                    targetDocId = foundProduct.documentId;
                }
            }

            const product = await strapi.documents('api::product.product').findOne({
                documentId: targetDocId,
                populate: {
                    categories: true,
                    colors: {
                        populate: {
                            images: true,
                            warehouse_stocks: {
                                populate: {
                                    warehouse: true
                                }
                            }
                        }
                    },
                    productImage: true,
                    ...((ctx.query.populate as any) || {})
                },
                ...ctx.query
            });
            return ctx.send({ data: product });
        } catch (err) {
            ctx.body = err;
        }
    },
    async saveFull(ctx) {
        const { productData, variantsData } = ctx.request.body.data;
        let productId = productData.documentId || productData.id;
        
        // Resolve numeric productId to documentId if necessary
        if (productId && !isNaN(Number(productId))) {
            const foundProduct = await strapi.documents('api::product.product').findFirst({
                filters: { id: Number(productId) } as any
            });
            if (foundProduct) {
                productId = foundProduct.documentId;
            }
        }

        let isNewProduct = !productId;
        let savedProduct = null;

        try {
            // 1. Create or Update Product
            const { id: _pid, documentId: _pdocId, ...cleanProductData } = productData;
            if (cleanProductData.productCode !== undefined) {
                cleanProductData.productCode = cleanProductData.productCode?.trim() || null;
            }

            if (isNewProduct) {
                savedProduct = await strapi.documents('api::product.product').create({ 
                    data: cleanProductData
                });
                productId = savedProduct.documentId;
            } else {
                const updateProductData: any = { ...cleanProductData };
                if (Array.isArray(updateProductData.categories)) {
                    updateProductData.categories = { set: updateProductData.categories };
                }
                savedProduct = await strapi.documents('api::product.product').update({
                    documentId: productId,
                    data: updateProductData
                });
            }

            // 2. Create or Update Variants
            const currentVariants = await strapi.documents('api::color.color').findMany({
                filters: { product: { documentId: productId } } as any
            });

            const variantsToKeep = variantsData
                .filter(v => v.id)
                .map(v => String(v.id));

            // Delete variants that are no longer in the list and their images
            const variantsToDelete = currentVariants.filter((cv: any) => 
                !variantsToKeep.includes(String(cv.documentId)) && !variantsToKeep.includes(String(cv.id))
            );
            for (const v of variantsToDelete) {
                // Fetch the variant to get attached images
                const variantWithImages = await strapi.documents('api::color.color').findOne({
                    documentId: v.documentId,
                    populate: ['images']
                }) as any;

                if (variantWithImages && variantWithImages.images) {
                    const fileService = strapi.plugin('upload').service('upload');
                    for (const img of variantWithImages.images) {
                        try {
                            await fileService.remove(img);
                        } catch (e) {
                            console.error("Error deleting orphaned image:", e);
                        }
                    }
                }

                await strapi.documents('api::color.color').delete({ documentId: v.documentId });
            }

            // Create or Update
            if (variantsData && Array.isArray(variantsData) && variantsData.length > 0) {
                for (const variant of variantsData) {
                    if (variant.id) {
                        const { id, images, ...dataToUpdate } = variant;
                        const updateData: any = { ...dataToUpdate };
                        
                        if (updateData.code) {
                            updateData.code = String(updateData.code).replace(/#/g, '').slice(0, 6) || '000000';
                        }
                        if (updateData.name) {
                            updateData.name = String(updateData.name).trim() || 'Estándar';
                        }
                        if (updateData.stock !== undefined) {
                            updateData.stock = Number(updateData.stock) || 0;
                        }

                        if (images !== undefined) {
                            const cleanImages = Array.isArray(images) 
                                ? images.filter(img => img !== null && img !== undefined && img !== '')
                                : images;
                            updateData.images = Array.isArray(cleanImages) ? { set: cleanImages } : cleanImages;
                        }

                        let targetVariantDocId = String(variant.id);
                        if (!isNaN(Number(targetVariantDocId))) {
                            const foundColor = await strapi.documents('api::color.color').findFirst({
                                filters: { id: Number(targetVariantDocId) } as any
                            });
                            if (foundColor) {
                                targetVariantDocId = foundColor.documentId;
                            }
                        }

                        await strapi.documents('api::color.color').update({
                            documentId: targetVariantDocId,
                            data: updateData
                        });
                    } else {
                        const { id, images, ...dataToCreate } = variant;
                        const createData: any = { ...dataToCreate, product: productId };
                        
                        if (createData.code) {
                            createData.code = String(createData.code).replace(/#/g, '').slice(0, 6) || '000000';
                        }
                        if (createData.name) {
                            createData.name = String(createData.name).trim() || 'Estándar';
                        }
                        if (createData.stock !== undefined) {
                            createData.stock = Number(createData.stock) || 0;
                        }

                        if (images !== undefined) {
                            const cleanImages = Array.isArray(images) 
                                ? images.filter(img => img !== null && img !== undefined && img !== '')
                                : images;
                            createData.images = cleanImages;
                        }

                        await strapi.documents('api::color.color').create({
                            data: createData
                        });
                    }
                }
            }

            return ctx.send({ success: true, data: savedProduct });
        } catch (error: any) {
            console.error('[saveFull Error]:', error);
            // Rollback only if it was a new product creation
            if (isNewProduct && savedProduct && savedProduct.documentId) {
                try {
                    await strapi.documents('api::product.product').delete({ documentId: savedProduct.documentId });
                } catch (e) {
                    console.error("Rollback failed:", e);
                }
            }
            return ctx.badRequest('Error saving product and variants: ' + (error.message || error));
        }
    },

    async validateStock(ctx) {
        const { items } = ctx.request.body.data || {};
        if (!items || !Array.isArray(items)) {
            return ctx.badRequest('Items array is required');
        }

        const errors = [];
        for (const item of items) {
            const color = await strapi.documents('api::color.color').findOne({
                documentId: item.colorId
            });

            if (!color) {
                errors.push(`La variante ${item.selectedColor || ''} del producto ${item.title} ya no existe.`);
                continue;
            }

            if (Number(color.stock) < Number(item.quantity)) {
                errors.push(`Stock insuficiente para ${item.title} (${item.selectedColor || ''}). Pedidos: ${item.quantity}, Disponibles: ${color.stock}.`);
            }
        }

        if (errors.length > 0) {
            return ctx.send({ success: false, errors });
        }

        return ctx.send({ success: true });
    }
}));
