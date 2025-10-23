// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: [
    '@nuxt/eslint',
    '@nuxt/image',
    '@nuxt/scripts',
    // '@nuxt/ui'
    '@nuxt/test-utils',
    '@nuxtjs/tailwindcss',
    '@nuxt/fonts',
    '@nuxt/icon',
  ],
  nitro: {
    compressPublicAssets: true,
    storage: {
      fs: {
        driver: 'fs',
        base: './static',
      },
      /*  r2: {
         driver: 's3',
         accessKeyId: '',
         secretAccessKey: '',
         endpoint: '',
         bucket: '',
         region: '',
       }, */
    },
  },
  runtimeConfig: {
    app: {
      version: '',
      buildTime: '',
    },
    public: {
      siteUrl: '',
    },
    private: {
      r2AccessKeyId: '',
      r2SecretAccessKey: '',
      r2Endpoint: '',
      r2Bucket: '',
      r2Region: '',
      r2PublicUrl: '',
      cloudreveApiToken: '',
      cloudrevePublicUrl: '',
      cloudreveR2AccessKeyId: '',
      cloudreveR2SecretAccessKey: '',
      cloudreveR2Endpoint: '',
      cloudreveR2Bucket: '',
      cloudreveR2Region: '',
    },
  },
})