/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_MODE?: 'qa' | 'prod'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
