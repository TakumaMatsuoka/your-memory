# Your Memory デプロイ手順（Firebase Hosting + Railway）

この手順は、`frontend` を Firebase Hosting、`backend` を Railway に配置する前提です。

## 0. 前提

- GitHub にリポジトリがある
- ローカルで以下が通る
  - `frontend`: `npm run lint` / `npm run build`
  - `backend`: `node src/server.js` で起動、`/health` が `{"ok":true}`

## 1. Railway（バックエンド）を作成

1. Railway で `backend` フォルダを対象に新規プロジェクト作成
2. Start Command は通常 `npm start`（`package.json` の `start` を利用）
3. Railway 側で Environment Variables を設定

### Railway 環境変数（本番用の具体例）

```env
NODE_ENV=production
PORT=4000
JWT_SECRET=32文字以上のランダム文字列を設定
CORS_ORIGIN=https://<your-project-id>.web.app,https://<your-project-id>.firebaseapp.com,https://www.your-memory.com
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=300
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_RATE_LIMIT_MAX=10
```

4. デプロイ後に発行される URL（例: `https://your-memory-api-production.up.railway.app`）を控える
5. `https://<railway-url>/health` で `{"ok":true}` を確認

## 2. Firebase（フロントエンド）を作成

1. Firebase プロジェクトを作成（既存プロジェクトでも可）
2. Hosting を有効化
3. ローカルで `frontend` の環境変数を本番値に設定

### フロント環境変数（本番用の具体例）

`frontend/.env.production` を作成:

```env
VITE_API_URL=https://your-memory-api-production.up.railway.app
```

4. Firebase CLI でログイン

```bash
npm install -g firebase-tools
firebase login
```

5. プロジェクトルート（`Your Memory`）で Firebase プロジェクトを紐付け

```bash
firebase use --add
```

6. フロントをビルドして Hosting に公開

```bash
cd "/Users/erikomatsuoka/cursorprojects/Your Memory"
npm --prefix frontend run build
firebase deploy --only hosting
```

## 3. CORS 最終調整

- Firebase Hosting の本番ドメインが確定したら、Railway の `CORS_ORIGIN` を最終値に更新
- 例:
  - `https://<your-project-id>.web.app`
  - `https://<your-project-id>.firebaseapp.com`
  - 独自ドメインがある場合 `https://www.your-memory.com` も追加

## 4. 公開前チェックリスト

- [ ] Railway の `JWT_SECRET` が 32文字以上
- [ ] Railway の `NODE_ENV=production`
- [ ] Railway の `CORS_ORIGIN` が本番フロント URL のみ
- [ ] `frontend/.env.production` の `VITE_API_URL` が Railway 本番 URL
- [ ] フロントからログイン/新規登録/思い出登録が動作
- [ ] ノード表示、検索、期間切替、複数ラインの表示が崩れない
- [ ] ブラウザコンソールに致命的エラーが出ていない

## 5. トラブル時の確認ポイント

- CORS エラー: Railway の `CORS_ORIGIN` と Firebase 実際の URL が一致しているか
- 401/認証失敗: `JWT_SECRET` を変更後、既存トークンが無効化されていないか
- API に届かない: `frontend/.env.production` の `VITE_API_URL` が誤っていないか
- 429 が多い: `AUTH_RATE_LIMIT_MAX` / `RATE_LIMIT_MAX` を運用に合わせて調整

## 6. コピペ実行コマンド（そのまま使う用）

### 6-1. 本番API URLをセット

`<RAILWAY_API_URL>` を実URLに置換して実行:

```bash
cd "/Users/erikomatsuoka/cursorprojects/Your Memory"
cat > "frontend/.env.production" <<'EOF'
VITE_API_URL=<RAILWAY_API_URL>
EOF
```

### 6-2. Firebase 再認証（必要時）

```bash
firebase login --reauth
```

### 6-3. プロジェクト紐付け + ビルド + 公開

```bash
cd "/Users/erikomatsuoka/cursorprojects/Your Memory"
firebase use --add
npm --prefix frontend run build
firebase deploy --only hosting
```

### 6-4. 公開後に Railway の CORS_ORIGIN を更新

`<PROJECT_ID>` を置換して Railway 側に設定:

```env
CORS_ORIGIN=https://<PROJECT_ID>.web.app,https://<PROJECT_ID>.firebaseapp.com
```
