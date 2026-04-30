# Your Memory

思い出を「一本の横線（タイムライン）」上にノードとして積み上げる Web サービスです。

## 機能（現状）

- メールアドレス + パスワードでの新規登録/ログイン
- 思い出登録（タイトル、写真URL任意、内容、人物、ラベル、日付）
- 年次 / 月次 / 週次切り替え
- キーワード検索（タイトル・内容・人物）
- ラベル絞り込み
- SQLite への永続保存

未決定の方針や今後の検討は [`TODO.md`](./TODO.md) にまとめています。

## 起動方法

### 1) バックエンド

```bash
cd "/Users/erikomatsuoka/cursorprojects/Your Memory/backend"
npm install
npm run dev
```

API: `http://localhost:4000`

### 2) フロントエンド

別ターミナルで:

```bash
cd "/Users/erikomatsuoka/cursorprojects/Your Memory/frontend"
npm install
npm run dev
```

Web: `http://localhost:5173`

**注意:** フロントは API を `http://localhost:4000` に向けています。バックエンドを先に起動しておくとエラーが出にくいです。

## 動作確認の流れ

1. **バックエンド起動**  
   上記 `backend` で `npm run dev`。ターミナルに `Your Memory API listening on http://localhost:4000` が出ることを確認。

2. **API の生存確認（任意）**  
   ブラウザまたはターミナルで `http://localhost:4000/health` を開き、`{"ok":true}` が返ることを確認。

3. **フロント起動**  
   上記 `frontend` で `npm run dev`。ブラウザで `http://localhost:5173` を開く。

4. **アカウント**  
   「新規登録」でメールとパスワード（8文字以上）を登録するか、「ログイン」で既存アカウントを使う。

5. **思い出の登録**  
   画面下部のフォームで、タイトル・日付（カレンダー）・内容は必須。人物・ラベル（カンマ区切り）・写真URLは任意。送信後、タイムラインにノードが増えることを確認。

6. **タイムラインと検索**  
   「年次 / 月次 / 週次」切り替え、キーワード検索、ラベルプルダウンで表示が絞り込まれることを確認。

7. **永続化**  
   一度ログアウトして同じアカウントで再ログインし、登録した思い出が残っていることを確認（同一マシン上の `backend/your-memory.db` に保存）。

## 品質チェック（開発者向け）

```bash
cd "/Users/erikomatsuoka/cursorprojects/Your Memory/frontend"
npm run lint
npm run build
```

## 本番向け設定（必須）

### バックエンド環境変数

`backend/.env.example` をコピーして `backend/.env` を作成:

```bash
cd "/Users/erikomatsuoka/cursorprojects/Your Memory/backend"
cp .env.example .env
```

重要:

- `JWT_SECRET` は必ず32文字以上の強い値に変更
- `CORS_ORIGIN` は本番フロントURLのみ許可
- 認証/APIのレート制限値は運用に応じて調整

### フロントエンド環境変数

`frontend/.env.example` をコピーして `frontend/.env` を作成:

```bash
cd "/Users/erikomatsuoka/cursorprojects/Your Memory/frontend"
cp .env.example .env
```

`VITE_API_URL` に本番APIのURLを設定してください。

## 関連ドキュメント

- [TODO.md](./TODO.md) … 収益化・未決定事項・今後のタスク
- [DEPLOY.md](./DEPLOY.md) … Firebase Hosting + Railway 前提の本番公開手順
