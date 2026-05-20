export default {
    routes: [
        {
            method: 'GET',
            path: '/expenses-admin',
            handler: 'api::expense.expense.findAdmin',
            config: {
                auth: false,
                policies: [
                    {
                        name: 'global::is-admin',
                        config: { roles: ['admin'] }
                    }
                ]
            }
        },
        {
            method: 'POST',
            path: '/expenses-admin',
            handler: 'api::expense.expense.createAdmin',
            config: {
                auth: false,
                policies: [
                    {
                        name: 'global::is-admin',
                        config: { roles: ['admin'] }
                    }
                ]
            }
        },
        {
            method: 'PUT',
            path: '/expenses-admin/:id',
            handler: 'api::expense.expense.updateAdmin',
            config: {
                auth: false,
                policies: [
                    {
                        name: 'global::is-admin',
                        config: { roles: ['admin'] }
                    }
                ]
            }
        },
        {
            method: 'DELETE',
            path: '/expenses-admin/:id',
            handler: 'api::expense.expense.deleteAdmin',
            config: {
                auth: false,
                policies: [
                    {
                        name: 'global::is-admin',
                        config: { roles: ['admin'] }
                    }
                ]
            }
        }
    ]
}
