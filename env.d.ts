interface ImportMetaEnv {
  readonly NODE_ENV: 'development' | 'production'
  readonly PLATFORM_ENV: 'native' | 'web'
  readonly HOSTNAME: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
