"""
apps/market_data/management/commands/seed_features.py
Populates FeatureDefinition catalog and ModelRegistry.
Run via: python manage.py seed_features
"""
from django.core.management.base import BaseCommand


FEATURE_SEED = [
    # ── 裸K價量 ─────────────────────────────────────────────────────
    {
        "name": "Stock_Ret",     "display_name": "個股對數報酬率",
        "category": "price_volume",
        "description": "log(Close_t / Close_{t-1})，確保時間序列平穩性（Stationarity）",
        "params": {}, "compute_fn": "ml_engine.pipeline.feature_engine._log_ret",
    },
    {
        "name": "Vol_Change",    "display_name": "成交量對數變化率",
        "category": "price_volume",
        "description": "log((Vol_t+1)/(Vol_{t-1}+1))，捕捉資金進出動能",
        "params": {}, "compute_fn": "ml_engine.pipeline.feature_engine._vol_change",
    },
    {
        "name": "ATR_Range",     "display_name": "單日高低振幅（簡化ATR）",
        "category": "price_volume",
        "description": "(High - Low) / Close_{t-1}，衡量多空交戰激烈程度",
        "params": {}, "compute_fn": "ml_engine.pipeline.feature_engine._atr_range",
    },
    {
        "name": "OBV",           "display_name": "能量潮 (On-Balance Volume)",
        "category": "price_volume",
        "description": "累積量能指標，判斷資金流向與趨勢確認",
        "params": {}, "compute_fn": "ml_engine.pipeline.feature_engine._obv",
    },
    # ── 動能/均值回歸 ─────────────────────────────────────────────
    {
        "name": "RSI_14",        "display_name": "RSI 相對強弱指標 (14日)",
        "category": "momentum",
        "description": "0-100 標準化情緒指標，>70超買，<30超賣",
        "params": {"window": 14}, "compute_fn": "ml_engine.pipeline.feature_engine._rsi",
    },
    {
        "name": "Stoch_K",       "display_name": "隨機指標 %K",
        "category": "momentum",
        "description": "Stochastic Oscillator，偵測短線超買超賣區間",
        "params": {}, "compute_fn": "ml_engine.pipeline.feature_engine._stoch_k",
    },
    {
        "name": "CCI_20",        "display_name": "順勢指標 (CCI 20日)",
        "category": "momentum",
        "description": "商品通道指數，判斷價格偏離移動平均的程度",
        "params": {"window": 20}, "compute_fn": "ml_engine.pipeline.feature_engine._cci",
    },
    # ── 趨勢 ────────────────────────────────────────────────────────
    {
        "name": "MACD_Hist",     "display_name": "MACD 柱狀圖",
        "category": "trend",
        "description": "MACD Histogram = (EMA12-EMA26) - Signal，趨勢加速度（二階導數）",
        "params": {}, "compute_fn": "ml_engine.pipeline.feature_engine._macd_hist",
    },
    # ── 波動率 ──────────────────────────────────────────────────────
    {
        "name": "Vol_20d",       "display_name": "20日滾動波動率",
        "category": "volatility",
        "description": "個股日報酬的20日標準差，用於動態倉位縮放",
        "params": {}, "compute_fn": "ml_engine.pipeline.feature_engine._vol_20d",
    },
    {
        "name": "BB_Width",      "display_name": "布林通道寬度",
        "category": "volatility",
        "description": "(Upper-Lower)/Middle，偵測波動率壓縮→爆發前兆",
        "params": {}, "compute_fn": "ml_engine.pipeline.feature_engine._bb_width",
    },
    # ── 相對強弱 ────────────────────────────────────────────────────
    {
        "name": "Bench_Ret",     "display_name": "基準指數對數報酬率",
        "category": "relative",
        "description": "log(Bench_t / Bench_{t-1})，市場整體動向",
        "params": {}, "compute_fn": "ml_engine.pipeline.feature_engine._bench_ret",
    },
    {
        "name": "Excess_Ret",    "display_name": "超額報酬（相對基準）",
        "category": "relative",
        "description": "Stock_Ret - Bench_Ret，個股相對大盤的超額表現",
        "params": {}, "compute_fn": "ml_engine.pipeline.feature_engine._excess_ret",
    },
]

MODEL_SEED = [
    {
        "arch": "transformer",  "display_name": "Alpha Transformer",
        "description": "Encoder-only Transformer with sinusoidal PE，最適合捕捉長程時序依賴",
        "default_hparams": {
            "d_model": 32, "nhead": 4, "num_layers": 2, "dropout": 0.1,
            "epochs": 15, "batch_size": 64, "lr": 0.001,
            "seq_length": 60, "train_ratio": 0.8,
            "confidence_threshold": 0.45, "transaction_cost": 0.002,
        },
    },
    {
        "arch": "lstm",  "display_name": "LSTM",
        "description": "長短期記憶網路，善於記憶較長期的序列模式",
        "default_hparams": {
            "hidden": 64, "num_layers": 2, "dropout": 0.1,
            "epochs": 15, "batch_size": 64, "lr": 0.001,
            "seq_length": 60, "train_ratio": 0.8,
            "confidence_threshold": 0.45, "transaction_cost": 0.002,
        },
    },
    {
        "arch": "gru",   "display_name": "GRU",
        "description": "門控循環單元，訓練速度快於LSTM，效果相近",
        "default_hparams": {
            "hidden": 64, "num_layers": 2, "dropout": 0.1,
            "epochs": 15, "batch_size": 64, "lr": 0.001,
            "seq_length": 60, "train_ratio": 0.8,
            "confidence_threshold": 0.45, "transaction_cost": 0.002,
        },
    },
    {
        "arch": "tcn",   "display_name": "Temporal Conv Net (TCN)",
        "description": "因果擴張卷積，可平行訓練、感受野大，時序處理效率高",
        "default_hparams": {
            "channels": 32, "levels": 4, "kernel_size": 3,
            "epochs": 15, "batch_size": 64, "lr": 0.001,
            "seq_length": 60, "train_ratio": 0.8,
            "confidence_threshold": 0.45, "transaction_cost": 0.002,
        },
    },
    {
        "arch": "xgboost",  "display_name": "XGBoost",
        "description": "梯度提升樹，適合高維特徵工程，不需序列輸入",
        "default_hparams": {
            "n_estimators": 300, "max_depth": 5, "lr": 0.05, "subsample": 0.8,
            "seq_length": 60, "train_ratio": 0.8,
            "confidence_threshold": 0.45, "transaction_cost": 0.002,
        },
    },
    {
        "arch": "lightgbm",  "display_name": "LightGBM",
        "description": "微軟開源GBDT，訓練速度比XGBoost快3-5倍，適合大資料集",
        "default_hparams": {
            "n_estimators": 500, "max_depth": -1, "lr": 0.05, "num_leaves": 31,
            "seq_length": 60, "train_ratio": 0.8,
            "confidence_threshold": 0.45, "transaction_cost": 0.002,
        },
    },
]


class Command(BaseCommand):
    help = "Seed FeatureDefinition catalog and ModelRegistry"

    def handle(self, *args, **options):
        from apps.market_data.models import FeatureDefinition
        from apps.ml_engine.models import ModelRegistry

        created_f = updated_f = 0
        for f in FEATURE_SEED:
            _, c = FeatureDefinition.objects.update_or_create(
                name=f["name"], defaults=f)
            if c: created_f += 1
            else: updated_f += 1

        created_m = updated_m = 0
        for m in MODEL_SEED:
            _, c = ModelRegistry.objects.update_or_create(
                arch=m["arch"], defaults=m)
            if c: created_m += 1
            else: updated_m += 1

        self.stdout.write(self.style.SUCCESS(
            f"✅ Features: {created_f} created, {updated_f} updated  |  "
            f"Models: {created_m} created, {updated_m} updated"
        ))
