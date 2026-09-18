window.RS_CONFIG = {
  // GitHub Pages / Cloudflare Pages 部署時會把 output/app 複製到 site/data/
  // 本機預覽可先: cp -r ../output/app ./data
  DEFAULT_DATA_BASE: './data',
  STORAGE_KEYS: {
    dataBaseUrl: 'rs_web_data_base_url',
    trades: 'rs_web_trades_v1',
    settings: 'rs_web_settings_v1',
  },
  // Deploy workflow replaces this from GitHub secret CLERK_PUBLISHABLE_KEY.
  // Local: edit this file or set the same value in .dev.vars for Functions.
  CLERK_PUBLISHABLE_KEY: '__CLERK_PUBLISHABLE_KEY__',
  API_BASE: '',
  // Teaching page: only these Clerk emails (or publicMetadata.role = "owner") can create/edit.
  OWNER_EMAILS: ['smoli0725@gmail.com'],
};
