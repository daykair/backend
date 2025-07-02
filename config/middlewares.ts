export default [
	"strapi::logger",
	"strapi::errors",
	"strapi::security",
	"strapi::cors",
	{ name: "strapi::poweredBy", config: { PoweredBy: "Saodi Development" } },
	"strapi::query",
	"strapi::body",
	"strapi::session",
	"strapi::favicon",
	"strapi::public",
];
