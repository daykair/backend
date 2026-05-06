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
            const product = await strapi.documents('api::product.product').findOne({
                documentId: ctx.params.id,
                ...ctx.query
            })
            return ctx.send({ data: product })
        } catch (err) {
            ctx.body = err;
        }
    },
    async saveFull(ctx) {
        const { productData, variantsData } = ctx.request.body.data;
        let productId = productData.id || productData.documentId;
        let isNewProduct = !productId;
        let savedProduct = null;

        try {
            // 1. Create or Update Product
            if (isNewProduct) {
                savedProduct = await strapi.documents('api::product.product').create({ data: productData });
                productId = savedProduct.documentId;
            } else {
                savedProduct = await strapi.documents('api::product.product').update({
                    documentId: productId,
                    data: productData
                });
            }

            // 2. Create or Update Variants
            if (variantsData && Array.isArray(variantsData) && variantsData.length > 0) {
                for (const variant of variantsData) {
                    if (variant.id) {
                        const { id, ...dataToUpdate } = variant;
                        await strapi.documents('api::color.color').update({
                            documentId: variant.id, // Using id as documentId for v5
                            data: dataToUpdate
                        });
                    } else {
                        const { id, ...dataToCreate } = variant;
                        await strapi.documents('api::color.color').create({
                            data: { ...dataToCreate, product: productId }
                        });
                    }
                }
            }

            return ctx.send({ success: true, data: savedProduct });
        } catch (error) {
            // Rollback only if it was a new product creation
            if (isNewProduct && savedProduct && savedProduct.documentId) {
                try {
                    await strapi.documents('api::product.product').delete({ documentId: savedProduct.documentId });
                } catch (e) {
                    console.error("Rollback failed:", e);
                }
            }
            return ctx.badRequest('Error saving product and variants' + " " + error.message);
        }
    }
}));
