# 市場結構大挑戰｜HKDSE Economics

這是獨立的課堂遊戲網站，與其他 PED 或經濟科網站分開維護。

## 網站入口

- 學生遊戲：網站首頁 `/`
- 老師登入及管理：`/admin.html`

網站由 **GitHub Pages** 發布；**Firebase** 只負責 Authentication 和 Cloud Firestore 資料，不使用 Firebase Hosting、Cloud Functions、Firebase CLI 或 Blaze 付費方案。

## 自動發布

每次把變更推送到 `main` 分支，GitHub Actions 會檢查 JavaScript 語法並自動發布 `site/` 資料夾到 GitHub Pages。亦可在 GitHub 的 Actions 頁面手動執行發布 Workflow。

## GitHub Pages 首次啟用（只需一次）

因 GitHub Actions 的預設 `GITHUB_TOKEN` 不能替 Repository 建立 Pages 網站，Repository 擁有人需要先在 GitHub 網頁設定一次：

1. 開啟 Repository → **Settings** → **Pages**。
2. 在 **Build and deployment** 的 **Source** 選擇 **GitHub Actions**。
3. 不用選 branch，也不用建立另一個 workflow；本 Repository 已有 `.github/workflows/deploy-pages.yml`。

完成後，往後提交 `site/` 內的網站更新便會自動發布。此設定與 Firebase Authentication 的 Authorized domains 是兩回事。

## Firebase 設定

- Firebase 專案：`monopoly-test-88b65`
- 網頁端設定在 `site/firebase-config.js`。Firebase Web API key 是公開的前端識別設定，不是服務帳戶私鑰。
- Firestore Rules 參考檔在 Repository 根目錄的 `firestore.rules`。Rules 必須在 Firebase Console 的 Firestore Rules 頁面發布。
- Firebase Authentication 的 Authorized domains 必須加入 `mrmalv.github.io`，否則匿名學生登入及老師登入可能被拒絕。
- 學生使用 Anonymous sign-in；老師使用 Email/Password sign-in。老師帳戶 UID 已寫入 `firestore.rules`。

## 老師使用

1. 開啟網站的 `/admin.html` 並使用老師帳戶登入。
2. 在「新增學生名單」只輸入兩項資料：班級及學生真實姓名，逐位新增。
3. 建立新場次。
4. 學生開啟首頁，選擇班級及自己的真實姓名，再自行輸入或擲骰選擇遊戲花名。公開排行榜只顯示花名及班別。

**不要把真實學生名單或其他個人資料提交到 GitHub。** 請只在老師後台匯入名單，並先取得學校對名單讀取方式的批准。

## 遊戲內容與限制

- 中英雙語；學生選擇班級及名單中的真實姓名，再自行設定遊戲花名。
- 四個計分部分：第一關 30 分、第二關分類 16 分、第二關快問快答 30 分、第三關案例 24 分；基本總分 100，另有最高 +3 連勝獎勵。
- 整場挑戰限時 20 分鐘；開啟知識腦圖時暫停計時。超過 20 分鐘仍可繼續作答，完成紀錄及排行榜會保存總用時和超時時長。
- 有總分及分關排行榜；老師後台可查看嘗試紀錄、分關分數和時間、超時時長、匯出 CSV，以及建立新場次。
- 此版本使用 Firebase Spark，不含可信任的伺服器端計分。分數和計時由瀏覽器計算，因此適合課堂練習，不應當作防作弊考試系統。
- 學生名單選擇流程需要已登入學生讀取名單資料；此設計可能讓學生查閱其他班別的名單。請勿放入敏感資料，並先確認學校政策。
- 學生刷新或關閉頁面後，未完成進度不會自動恢復。

## 專案結構

- `site/`：GitHub Pages 發布的網站檔案（學生頁、老師頁、JS、CSS）。
- `firestore.rules`：Firestore 安全規則參考檔。
- `roster-template.csv`：空白名單格式範本；不可放入真實學生資料。
- `.github/workflows/deploy-pages.yml`：語法檢查及 GitHub Pages 自動發布。
