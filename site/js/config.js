window.RS_CONFIG = {
  // GitHub Pages 部署時會把 output/app 複製到 site/data/
  // 本機預覽可先: cp -r ../output/app ./data
  DEFAULT_DATA_BASE: './data',
  STORAGE_KEYS: {
    dataBaseUrl: 'rs_web_data_base_url',
    trades: 'rs_web_trades_v1',
  },
};
