export default {
    routes: [
        {
            method: 'POST',
            path: '/exchange-rate/sync',
            handler: 'api::exchange-rate.exchange-rate.sync',
            config: {
                auth: false,
            }
        }
    ]
}
