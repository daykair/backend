export default {
    routes: [
        {
            method: 'GET',
            path: '/products-admin',
            handler: 'api::product.product.findAdmin',
            config: {
                auth: false,
                policies: [
                    {
                        name: 'global::is-admin',
                        config: { permission: 'api::product.product.find' }
                    }
                ]
            }
        },
        {
            method: 'GET',
            path: '/products-admin/:id',
            handler: 'api::product.product.findOneAdmin',
            config: {
                auth: false,
                policies: [
                    {
                        name: 'global::is-admin',
                        config: { permission: ['api::product.product.find', 'api::product.product.findOne'] }
                    }
                ]
            }
        },
        {
            method: 'POST',
            path: '/products-admin/save-full',
            handler: 'api::product.product.saveFull',
            config: {
                auth: false,
                policies: [
                    {
                        name: 'global::is-admin',
                        config: { permission: ['api::product.product.create', 'api::product.product.update'] }
                    }
                ]
            }
        },
        {
            method: 'POST',
            path: '/products-admin/validate-stock',
            handler: 'api::product.product.validateStock',
            config: {
                auth: false,
                policies: [
                    {
                        name: 'global::is-admin',
                        config: { permission: ['api::product.product.find', 'api::order.order.create'] }
                    }
                ]
            }
        },
        {
            method: 'POST',
            path: '/products-admin/upload',
            handler: 'api::product.product.uploadAdmin',
            config: {
                auth: false,
                policies: [
                    {
                        name: 'global::is-admin',
                        config: { permission: ['api::product.product.create', 'api::product.product.update', 'api::company-setting.company-setting.update'] }
                    }
                ]
            }
        }
    ]
}