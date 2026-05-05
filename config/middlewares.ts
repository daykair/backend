export default [
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

	"strapi::cors",
	{ name: "strapi::poweredBy", config: { PoweredBy: "Saodi Development" } },
	"strapi::query",
	"strapi::body",
	"strapi::session",
	"strapi::favicon",
	"strapi::public",
];
