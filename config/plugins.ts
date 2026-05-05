export default ({ env }) => ({
  upload: {
    config: {
      provider: 'aws-s3',
      providerOptions: {
        s3Options: {
          credentials: {
            accessKeyId: env('B2_KEY_ID'),
            secretAccessKey: env('B2_APP_KEY'),
          },
          region: env('B2_REGION'),
          endpoint: env('B2_ENDPOINT'),
          forcePathStyle: true,
          params: {
            Bucket: env('B2_BUCKET_NAME'),
          },
        },
      },
      actionOptions: {
        upload: {},
        uploadStream: {},
        delete: {},
      },
    },
  },
});

