/**
 * cash-register router
 *
 * Ruta custom que permite al rol 'authenticated' (vendedores)
 * crear y listar cierres de caja, además del rol 'admin'.
 */

export default {
    routes: [
        {
            method: 'GET',
            path: '/cash-registers',
            handler: 'cash-register.find',
            config: {
                policies: [],
                middlewares: [],
            },
        },
        {
            method: 'GET',
            path: '/cash-registers/:id',
            handler: 'cash-register.findOne',
            config: {
                policies: [],
                middlewares: [],
            },
        },
        {
            method: 'POST',
            path: '/cash-registers',
            handler: 'cash-register.create',
            config: {
                policies: [],
                middlewares: [],
            },
        },
        {
            method: 'PUT',
            path: '/cash-registers/:id',
            handler: 'cash-register.update',
            config: {
                policies: [],
                middlewares: [],
            },
        },
        {
            method: 'DELETE',
            path: '/cash-registers/:id',
            handler: 'cash-register.delete',
            config: {
                policies: [],
                middlewares: [],
            },
        },
    ],
};
