# AlphaQuant — Transformer 量化交易平台

全端量化交易研究平台，支援自由組合特徵、多模型訓練、完整回測報告與明日操作建議。

---

## 🏗️ 系統架構

```
┌──────────────┐    JWT     ┌───────────────────────────────────┐
│  React SPA   │ ◄────────► │       Django REST Framework        │
│  (Vite +     │  REST API  │   /api/experiments  /api/runs/...  │
│  Tailwind)   │            └──────────────┬────────────────────┘
└──────────────┘                           │
                                           ▼
                              ┌────────────────────────┐
                              │  Celery Worker         │
                              │  (ML Pipeline Tasks)   │
                              │  ┌──────────────────┐  │
                              │  │  FeatureEngine   │  │
                              │  │  Trainer         │  │
                              │  │  BacktestEngine  │  │
                              │  └──────────────────┘  │
                              └───────────┬────────────┘
                                          │
            ┌─────────────────────────────┼────────────────────┐
            ▼                             ▼                    ▼
     ┌─────────────┐            ┌──────────────────┐   ┌────────────┐
     │  PostgreSQL  │            │   TimescaleDB    │   │   Redis    │
     │  (Users,    │            │  (OHLCV Bars,    │   │  (Celery   │
     │   Models,   │            │   Features)      │   │   Broker)  │
     │   Results)  │            └──────────────────┘   └────────────┘
     └─────────────┘
```

---

## 📁 目錄結構

```
alpha-quant/
├── docker-compose.yml
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── config/
│   │   ├── settings.py          # Django 設定（DB、Celery、JWT）
│   │   ├── urls.py              # 路由總覽
│   │   └── celery_app.py        # Celery 配置
│   └── apps/
│       ├── users/               # 使用者、API憑證
│       ├── market_data/         # OHLCV、特徵目錄、預設組合
│       └── ml_engine/
│           ├── models.py        # 實驗、訓練Run、回測、預測
│           ├── views.py         # REST API endpoints
│           ├── tasks.py         # Celery 非同步任務
│           └── pipeline/
│               ├── trainer.py   # 所有模型訓練器
│               └── feature_engine.py  # 特徵計算 + 回測引擎
└── frontend/
    ├── Dockerfile
    ├── nginx.conf
    └── src/
        ├── pages/
        │   ├── LoginPage.jsx       # 登入 / 註冊
        │   ├── DashboardPage.jsx   # 實驗總覽
        │   ├── ExperimentPage.jsx  # 4步驟建立實驗
        │   ├── TrainingPage.jsx    # 訓練進度（即時輪詢）
        │   ├── BacktestPage.jsx    # 完整回測報告圖表
        │   └── PredictionPage.jsx  # 明日訊號卡片
        ├── components/
        │   ├── forms/
        │   │   └── FeatureSelector.jsx  # 特徵選擇 + 預設組合管理
        │   └── ui/
        │       ├── Layout.jsx       # 側邊欄導航
        │       └── MetricCard.jsx   # 指標卡片
        ├── store/authStore.js       # Zustand JWT 持久化
        └── api/client.js            # Axios + 自動 Token 刷新
```

---

## 🚀 快速啟動

### 方法一：Docker Compose（推薦）

```bash
git clone <repo>
cd alpha-quant

# 啟動所有服務
docker compose up -d

# 建立超級管理員（可選）
docker compose exec backend python manage.py createsuperuser

# 前端：http://localhost:3000
# 後端 API：http://localhost:8000/api/
# Swagger：http://localhost:8000/api/docs/
# Flower（Celery監控）：http://localhost:5555
```

### 方法二：本地開發

```bash
# Backend
cd backend
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_features    # 填充特徵目錄
python manage.py runserver

# Celery Worker（另開終端）
celery -A config worker -l info -Q training,prediction,data_fetch

# Frontend（另開終端）
cd frontend
npm install
npm run dev     # http://localhost:3000
```

---

## 📡 REST API 速查

| 方法   | 端點                                    | 說明                         |
|--------|----------------------------------------|------------------------------|
| POST   | `/api/auth/register/`                  | 使用者註冊                   |
| POST   | `/api/auth/token/`                     | 取得 JWT（登入）             |
| POST   | `/api/auth/token/refresh/`             | 刷新 Access Token            |
| GET    | `/api/features/`                       | 所有可用特徵（按分類分組）   |
| GET    | `/api/feature-presets/`                | 使用者的特徵預設組合         |
| POST   | `/api/feature-presets/`                | 儲存新預設組合               |
| GET    | `/api/models/`                         | 可用模型架構列表             |
| GET    | `/api/experiments/`                    | 使用者所有實驗               |
| POST   | `/api/experiments/`                    | 建立新實驗                   |
| POST   | `/api/experiments/{id}/train/`         | 🚀 啟動訓練（非同步）        |
| GET    | `/api/runs/{id}/status/`               | 訓練進度輪詢                 |
| GET    | `/api/runs/{id}/backtest/`             | 完整回測報告                 |
| GET    | `/api/runs/{id}/prediction/`           | 明日操作建議                 |
| GET    | `/api/market/ohlcv/?ticker=2603.TW`    | 歷史OHLCV資料                |
| GET    | `/api/health/`                         | 系統健康檢查                 |

---

## 🧩 特徵目錄（可擴充）

| 分類       | 特徵              | 說明                          |
|------------|-------------------|-------------------------------|
| 裸K價量    | Stock_Ret         | 個股對數報酬率（無滯後）       |
| 裸K價量    | Vol_Change        | 成交量對數變化率               |
| 裸K價量    | ATR_Range         | 單日高低振幅                   |
| 裸K價量    | OBV               | 能量潮                         |
| 動能       | RSI_14            | 相對強弱指標 (14日)            |
| 動能       | Stoch_K           | 隨機指標 %K                    |
| 動能       | CCI_20            | 順勢指標                       |
| 趨勢       | MACD_Hist         | MACD 柱狀圖（趨勢加速度）      |
| 波動率     | Vol_20d           | 20日滾動波動率                 |
| 波動率     | BB_Width          | 布林通道寬度                   |
| 相對強弱   | Bench_Ret         | 基準指數報酬                   |
| 相對強弱   | Excess_Ret        | 個股超額報酬                   |

> 新增特徵：在 `feature_engine.py` 加入計算函數，在 `seed_features.py` 加入定義，執行 `seed_features` 指令即可。

---

## 🤖 支援模型

| 模型         | 架構說明                              | 適用場景             |
|--------------|--------------------------------------|----------------------|
| Transformer  | Encoder-only + Sinusoidal PE         | 長程時序依賴         |
| LSTM         | 雙層長短期記憶網路                    | 中長期模式記憶       |
| GRU          | 門控循環單元                          | 快速收斂             |
| TCN          | 因果擴張卷積（Temporal Conv Net）     | 可平行、感受野大     |
| XGBoost      | 梯度提升樹（特徵工程友善）            | 高維特徵+快速迭代    |
| LightGBM     | 微軟GBDT（葉節點分裂策略）            | 大資料集+速度優先    |

> 新增模型：繼承 `BaseTrainer`，實作 `fit / predict / save / load`，在 `get_trainer()` 工廠和 `seed_features` 中登記即可。

---

## 🗄️ 資料庫設計決策

| 資料類型      | 資料庫          | 原因                                        |
|---------------|-----------------|---------------------------------------------|
| 使用者/模型元資料 | PostgreSQL   | 強關聯性、ACID事務、UUID主鍵                |
| OHLCV 時序資料  | TimescaleDB  | 自動分區、時間範圍查詢比普通PG快100倍+       |
| 計算特徵快取    | TimescaleDB  | 避免重複計算，(ticker, feature, date) 索引  |
| Celery任務狀態  | Redis         | 低延遲消息佇列、LRU快取策略                |
| 訓練進度Log     | PostgreSQL   | 結構化查詢、與Run外鍵關聯                   |

---

## ⚠️ 免責聲明

本平台僅供量化研究與教育目的，所有預測訊號不構成任何投資建議。
金融市場存在不可預測風險，請自行評估後決策，操作風險自負。
