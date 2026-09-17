# taiwan_rs_app（閃電選股 · FlashPick）

台股 RS 選股 Flutter App。資料預設讀 [TradingVenator `/data`](https://tradingvenator.pages.dev/data)。

## 開發

```bash
flutter pub get
flutter test
flutter build apk --debug
```

Debug APK（debug 簽名，可直接 sideload，無 Play 上傳金鑰）：

```bash
flutter build apk --debug --split-per-abi
```

- 多數手機（arm64）：`build/app/outputs/flutter-apk/app-arm64-v8a-debug.apk`
- 全 ABI：`build/app/outputs/flutter-apk/app-debug.apk`

安裝：把 APK 傳到 Android 手機 → 允許「未知來源」→ 開啟檔案安裝。

設定頁可覆寫資料來源 URL；恢復預設會清掉本機覆寫。
