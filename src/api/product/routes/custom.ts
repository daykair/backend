export default {
    routes: [
        {
            method: 'GET',
            path: '/products-admin',
            handler: 'api::product.product.findAdmin',
            config: {
                auth: false,
                policies: ['global::is-admin']
            }
        },
        {
            method: 'GET',
            path: '/products-admin/:id',
            handler: 'api::product.product.findOneAdmin',
            config: {
                auth: false,
                policies: ['global::is-admin']
            }
        },
        {
            method: 'POST',
            path: '/products-admin/save-full',
            handler: 'api::product.product.saveFull',
            config: {
                auth: false,
                policies: ['global::is-admin']
            }
        }
    ]
}