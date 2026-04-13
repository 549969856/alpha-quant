"""
ml_engine/pipeline/feature_engine.py
─────────────────────────────────────
Computes features from raw OHLCV and packages them into
rolling-window arrays ready for model consumption.
"""
from __future__ import annotations
import numpy as np
import pandas as pd
import ta
from datetime import date


# ─────────────────────────────────────────────
# Feature compute functions (add new ones here)
# ─────────────────────────────────────────────
def _log_ret(df: pd.DataFrame, **_):
    return np.log(df["adj_close"] / df["adj_close"].shift(1))

def _bench_ret(df: pd.DataFrame, bench_df: pd.DataFrame, **_):
    return np.log(bench_df["adj_close"] / bench_df["adj_close"].shift(1))

def _excess_ret(df: pd.DataFrame, bench_df: pd.DataFrame, **_):
    return _log_ret(df) - _bench_ret(df, bench_df)

def _vol_change(df: pd.DataFrame, **_):
    return np.log((df["volume"] + 1) / (df["volume"].shift(1) + 1))

def _rsi(df: pd.DataFrame, window=14, **_):
    return ta.momentum.RSIIndicator(close=df["adj_close"], window=window).rsi()

def _vol_20d(df: pd.DataFrame, **_):
    return _log_ret(df).rolling(20).std()

def _atr_range(df: pd.DataFrame, **_):
    return (df["high"] - df["low"]) / df["adj_close"].shift(1)

def _macd_hist(df: pd.DataFrame, **_):
    m = ta.trend.MACD(close=df["adj_close"])
    return m.macd_diff()

def _bb_width(df: pd.DataFrame, **_):
    b = ta.volatility.BollingerBands(close=df["adj_close"])
    return (b.bollinger_hband() - b.bollinger_lband()) / (b.bollinger_mavg() + 1e-8)

def _obv(df: pd.DataFrame, **_):
    return ta.volume.OnBalanceVolumeIndicator(
        close=df["adj_close"], volume=df["volume"].astype(float)).on_balance_volume()

def _cci(df: pd.DataFrame, window=20, **_):
    return ta.trend.CCIIndicator(
        high=df["high"], low=df["low"], close=df["adj_close"], window=window).cci()

def _stoch_k(df: pd.DataFrame, **_):
    return ta.momentum.StochasticOscillator(
        high=df["high"], low=df["low"], close=df["adj_close"]).stoch()


# Registry: feature_name → compute_fn
FEATURE_FN_MAP = {
    "Stock_Ret":   _log_ret,
    "Bench_Ret":   _bench_ret,
    "Excess_Ret":  _excess_ret,
    "Vol_Change":  _vol_change,
    "RSI_14":      _rsi,
    "Vol_20d":     _vol_20d,
    "ATR_Range":   _atr_range,
    "MACD_Hist":   _macd_hist,
    "BB_Width":    _bb_width,
    "OBV":         _obv,
    "CCI_20":      _cci,
    "Stoch_K":     _stoch_k,
}


# ─────────────────────────────────────────────
# FeatureEngine
# ─────────────────────────────────────────────
class FeatureEngine:
    """
    Given raw OHLCV DataFrames and a list of feature names,
    produces a clean feature matrix and target arrays.
    """
    def __init__(self, feature_names: list[str], seq_length: int = 60):
        self.feature_names = feature_names
        self.seq_length    = seq_length

    def build(self, stock_df: pd.DataFrame,
              bench_df: pd.DataFrame) -> dict:
        """
        Returns:
            windows   : np.ndarray (N, seq_len, n_features)  — rolling-normalized
            next_ret  : np.ndarray (N,)
            bench_ret : np.ndarray (N,)
            vol_20d   : np.ndarray (N,)
            dates     : list[date]  — the T+1 target date for each window
        """
        df = stock_df.copy()
        # Compute each selected feature
        feat_dict = {}
        for name in self.feature_names:
            fn = FEATURE_FN_MAP.get(name)
            if fn is None:
                raise ValueError(f"Unknown feature: {name}")
            feat_dict[name] = fn(df, bench_df=bench_df)

        feat_df = pd.DataFrame(feat_dict, index=df.index)
        feat_df["_next_ret"]  = np.log(df["adj_close"] / df["adj_close"].shift(1)).shift(-1)
        feat_df["_bench_ret"] = np.log(bench_df["adj_close"] / bench_df["adj_close"].shift(1)).shift(-1)
        feat_df["_vol_20d"]   = np.log(df["adj_close"] / df["adj_close"].shift(1)).rolling(20).std()

        feat_df.replace([np.inf, -np.inf], np.nan, inplace=True)
        feat_df.dropna(inplace=True)

        raw   = feat_df[self.feature_names].values.astype(np.float32)
        nr    = feat_df["_next_ret"].values.astype(np.float32)
        br    = feat_df["_bench_ret"].values.astype(np.float32)
        v20   = feat_df["_vol_20d"].values.astype(np.float32)
        dates = list(feat_df.index)

        N     = len(raw) - self.seq_length
        windows   = np.zeros((N, self.seq_length, len(self.feature_names)), dtype=np.float32)
        next_ret  = np.zeros(N, dtype=np.float32)
        bench_ret = np.zeros(N, dtype=np.float32)
        vol_20d   = np.zeros(N, dtype=np.float32)
        target_dates = []

        for i in range(N):
            w            = raw[i : i + self.seq_length].copy()
            mean         = w.mean(axis=0)
            std          = w.std(axis=0) + 1e-8
            windows[i]   = (w - mean) / std
            t            = i + self.seq_length - 1
            next_ret[i]  = nr[t]
            bench_ret[i] = br[t]
            vol_20d[i]   = v20[t]
            target_dates.append(dates[t])

        return dict(
            windows=windows,
            next_ret=next_ret, bench_ret=bench_ret, vol_20d=vol_20d,
            dates=target_dates, feat_df=feat_df,
        )

    def build_last_window(self, stock_df: pd.DataFrame,
                          bench_df: pd.DataFrame) -> np.ndarray:
        """Returns the single normalized window for live inference (1, T, F)."""
        data = self.build(stock_df, bench_df)
        return data["windows"][[-1]]   # keep batch dim


# ─────────────────────────────────────────────
# Backtest Engine
# ─────────────────────────────────────────────
class BacktestEngine:
    def __init__(self, confidence_threshold=0.45, transaction_cost=0.002, directional_threshold=0.05):
        self.thr  = confidence_threshold
        self.cost = transaction_cost
        self.directional_threshold = directional_threshold

    def _target_position(self, p: np.ndarray) -> int:
        action = int(np.argmax(p))
        edge = float(p[2] - p[0])
        if action == 2 and edge >= self.directional_threshold:
            return 1
        if action == 0 and edge <= -self.directional_threshold:
            return -1
        return 0

    def run(self, probs: np.ndarray, actual_ret: np.ndarray,
            dates: list) -> dict:
        """
        probs      : (N, 3) [P_short, P_neutral, P_long]
        actual_ret : (N,) stock log returns for each T+1
        dates      : list of date objects length N
        """
        equity  = [1.0]
        bh      = [1.0]
        pos     = 0
        daily   = []
        pos_log = []
        eq_log  = [{"date": str(dates[0]), "value": 1.0}]
        bh_log  = [{"date": str(dates[0]), "value": 1.0}]

        for i, (p, r) in enumerate(zip(probs, actual_ret)):
            target = self._target_position(p)

            simple_ret = float(np.exp(r) - 1.0)
            cost  = self.cost if target != pos else 0.0
            pos   = target
            ret   = pos * simple_ret - cost
            daily.append(ret)
            pos_log.append({"date": str(dates[i]), "position": pos})

            eq_new = equity[-1] * (1 + ret)
            bh_new = bh[-1] * (1 + simple_ret)
            equity.append(eq_new)
            bh.append(bh_new)

            if i < len(dates):
                d = str(dates[i])
                eq_log.append({"date": d, "value": round(eq_new, 6)})
                bh_log.append({"date": d, "value": round(bh_new, 6)})

        rets    = np.array(daily)
        run_max = np.maximum.accumulate(equity)
        dd      = (np.array(equity) - run_max) / run_max
        dd_log  = [{"date": str(dates[min(i, len(dates)-1)]), "value": round(float(v)*100, 4)}
                   for i, v in enumerate(dd)]

        metrics = dict(
            total_return   = round(equity[-1] - 1, 6),
            bh_return      = round(bh[-1] - 1, 6),
            annualized_ret = round((equity[-1] ** (252 / max(len(rets),1))) - 1, 6),
            sharpe_ratio   = round(float(rets.mean() / (rets.std() + 1e-8) * np.sqrt(252)), 4),
            max_drawdown   = round(float(dd.min()), 6),
            win_rate       = round(float((rets > 0).mean()), 4),
            turnover_rate  = round(float(np.mean(np.diff([p["position"] for p in pos_log]) != 0)), 4),
            calmar_ratio   = 0.0,
        )
        if metrics["max_drawdown"] != 0:
            metrics["calmar_ratio"] = round(
                metrics["annualized_ret"] / abs(metrics["max_drawdown"]), 4)

        return dict(
            metrics=metrics,
            equity_curve=eq_log,
            bh_curve=bh_log,
            drawdown_curve=dd_log,
            position_log=pos_log,
        )

    def predict_tomorrow(self, probs: np.ndarray, feat_df: pd.DataFrame) -> dict:
        """Generate next-day trading recommendation."""
        p      = probs[0]
        target = self._target_position(p)
        if target == 1:
            signal = "LONG"
        elif target == -1:
            signal = "SHORT"
        else:
            signal = "NEUTRAL"

        latest  = feat_df.iloc[-1]
        rsi     = float(latest.get("RSI_14", np.nan))
        vol_20d = float(latest.get("Vol_20d", 0.01))
        excess  = float(latest.get("Excess_Ret", 0.0)) * 100
        edge    = float(p[2] - p[0])

        return dict(
            signal       = signal,
            prob_long    = round(float(p[2]), 4),
            prob_short   = round(float(p[0]), 4),
            prob_neutral = round(float(p[1]), 4),
            confidence   = round(float(abs(edge)) * 100, 2),
            directional_edge = round(edge, 4),
            rsi_14       = round(rsi, 2) if not np.isnan(rsi) else None,
            vol_ann      = round(vol_20d * np.sqrt(252) * 100, 2),
            excess_ret   = round(excess, 3),
            stop_loss_pct  = round(vol_20d * 2 * 100, 2),
            target_pct     = round(vol_20d * 3 * 100, 2),
        )
