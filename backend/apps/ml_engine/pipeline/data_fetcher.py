from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd
import yfinance as yf


class DataFetcher:
    """Fetch OHLCV with local parquet TTL cache."""

    def __init__(self, cache_dir: str | Path, ttl_hours: int = 24):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.ttl = timedelta(hours=ttl_hours)

    def _cache_path(self, ticker: str, start: str, end: str) -> Path:
        safe = ticker.replace("^", "").replace("/", "_")
        return self.cache_dir / f"{safe}_{start}_{end}.parquet"

    def _fresh(self, path: Path) -> bool:
        if not path.exists():
            return False
        modified = datetime.fromtimestamp(path.stat().st_mtime)
        return (datetime.now() - modified) < self.ttl

    @staticmethod
    def _normalize(df: pd.DataFrame) -> pd.DataFrame:
        if isinstance(df.columns, pd.MultiIndex):
            # yfinance can return multi-index columns even for one ticker
            df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
        rename_map = {
            "Open": "open",
            "High": "high",
            "Low": "low",
            "Close": "close",
            "Adj Close": "adj_close",
            "Volume": "volume",
        }
        out = df.rename(columns=rename_map).copy()
        if "adj_close" not in out.columns and "close" in out.columns:
            out["adj_close"] = out["close"]
        out = out[["open", "high", "low", "close", "adj_close", "volume"]]
        out.index = pd.to_datetime(out.index).tz_localize(None)
        out = out.sort_index().dropna()
        return out

    def get_ohlcv(self, ticker: str, start: str, end: str, interval: str = "1d") -> pd.DataFrame:
        cache_path = self._cache_path(ticker, start, end)
        if self._fresh(cache_path):
            return pd.read_parquet(cache_path)

        df_raw = yf.download(
            ticker,
            start=start,
            end=end,
            interval=interval,
            auto_adjust=False,
            progress=False,
            actions=False,
        )
        if df_raw is None or df_raw.empty:
            raise ValueError(f"No market data downloaded for {ticker} ({start}~{end})")
        df = self._normalize(df_raw)
        df.to_parquet(cache_path)
        return df
