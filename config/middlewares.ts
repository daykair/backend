export default [
	"strapi::logger",
	"strapi::errors",
	{
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https:'],
          'img-src': [
            "'self'",
            'data:',
            'blob:',
            'dl.airtable.com',
            '*.backblazeb2.com', // Autoriza las imágenes alojadas en B2
          ],
          'media-src': [
            "'self'",
            'data:',
            'blob:',
            'dl.airtable.com',
            '*.backblazeb2.com', // Autoriza videos/audios alojados en B2
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
