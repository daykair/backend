export default () => ({upload: {
  config: {
    provider: '@strapi/upload',
    providerOptions: {
      // Configuración de tu proveedor (ej: AWS S3, Cloudinary, etc.)
    },
  },
},});
