export default ({ env }) => {
  const smtpPort = env.int('SMTP_PORT', 465);

  return {
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
    email: {
      config: {
        provider: 'nodemailer',
        providerOptions: {
          host: env('SMTP_HOST', 'smtp.gmail.com'),
          port: smtpPort,
          secure: env.bool('SMTP_SECURE', smtpPort === 465),
          auth: {
            user: env('SMTP_USERNAME'),
            pass: env('SMTP_PASSWORD'),
          },
        },
        settings: {
          defaultFrom: env('SMTP_DEFAULT_FROM', 'noreply@tutienda.com'),
          defaultReplyTo: env('SMTP_DEFAULT_REPLY_TO', 'soporte@tutienda.com'),
        },
      },
    },
  };
};

