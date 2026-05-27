export default [
  "global::cookie-to-bearer",
  {
    name: "strapi::cors",
    config: {
      origin: [
        'http://localhost:4321',
        'http://127.0.0.1:4321',
        'https://front-saodi.vercel.app',
        'http://localhost:3000'
      ],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
      headers: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
      keepHeaderOnError: true,
    },
  },
  "strapi::logger",
  "strapi::errors",
  {
    name: "strapi::security",
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "connect-src": ["'self'", "https:"],
          "img-src": [
            "'self'",
            "data:",
            "blob:",
            "market-assets.strapi.io",
            "s3.us-east-005.backblazeb2.com",
            "saodi-strapi.s3.us-east-005.backblazeb2.com",
          ],
          "media-src": [
            "'self'",
            "data:",
            "blob:",
            "market-assets.strapi.io",
            "s3.us-east-005.backblazeb2.com",
            "saodi-strapi.s3.us-east-005.backblazeb2.com",
          ],
          upgradeInsecureRequests: null,
        },
      },
    },
  },

  { name: "strapi::poweredBy", config: { PoweredBy: "Saodi Development" } },
  "strapi::query",
  "strapi::body",
  "strapi::session",
  "strapi::favicon",
  "strapi::public",
];
