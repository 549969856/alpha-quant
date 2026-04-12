"""
ml_engine/pipeline/trainer.py
─────────────────────────────
Unified training pipeline.  Supports:
  • transformer  — AlphaTransformer (original architecture)
  • lstm / gru   — Sequence RNN models
  • tcn          — Temporal Convolutional Network
  • xgboost      — Gradient Boosted Trees (scikit-learn style)
  • lightgbm     — LightGBM (fast GBDT)

All models expose the same interface:
    trainer = get_trainer(arch, hparams)
    trainer.fit(X_train, y_train)
    preds   = trainer.predict(X_test)       # returns probs (N, 3)
    trainer.save(path) / trainer.load(path)
"""

from __future__ import annotations
import math, os, logging, random
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import TensorDataset, DataLoader

log = logging.getLogger(__name__)


def set_global_seed(seed: int = 42) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


# ─────────────────────────────────────────────
#  Shared Alpha Loss
# ─────────────────────────────────────────────
def alpha_profit_loss(probs: torch.Tensor,
                      next_ret: torch.Tensor,
                      bench_ret: torch.Tensor,
                      vol_20d: torch.Tensor,
                      cost: float = 0.002,
                      lambda_turnover: float = 0.05,
                      lambda_entropy: float = 0.001) -> torch.Tensor:
    pos = probs[:, 2] - probs[:, 0]
    alpha = (next_ret - bench_ret) / (vol_20d + 1e-6)

    prev_pos = torch.roll(pos, shifts=1, dims=0)
    prev_pos[0] = 0.0
    turnover = torch.abs(pos - prev_pos)

    gross = pos * alpha
    fee = turnover * cost
    net = gross - fee

    entropy = -torch.sum(probs * torch.log(probs + 1e-8), dim=1)
    return -torch.mean(net) + lambda_turnover * torch.mean(turnover) - lambda_entropy * torch.mean(entropy)


# ─────────────────────────────────────────────
#  Positional Encoding
# ─────────────────────────────────────────────
class SinusoidalPE(nn.Module):
    def __init__(self, d_model: int, max_len: int = 5000):
        super().__init__()
        pe  = torch.zeros(max_len, d_model)
        pos = torch.arange(max_len, dtype=torch.float).unsqueeze(1)
        div = torch.exp(torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model))
        pe[:, 0::2] = torch.sin(pos * div)
        pe[:, 1::2] = torch.cos(pos * div)
        self.register_buffer("pe", pe.unsqueeze(0))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x + self.pe[:, :x.size(1)]


# ─────────────────────────────────────────────
#  Neural Network Architectures
# ─────────────────────────────────────────────
class _AlphaTransformerNet(nn.Module):
    def __init__(self, input_dim: int, d_model=32, nhead=4, num_layers=2, dropout=0.1):
        super().__init__()
        self.proj    = nn.Linear(input_dim, d_model)
        self.pe      = SinusoidalPE(d_model)
        enc          = nn.TransformerEncoderLayer(d_model, nhead, d_model*4, dropout, batch_first=True)
        self.encoder = nn.TransformerEncoder(enc, num_layers=num_layers)
        self.head    = nn.Sequential(
            nn.LayerNorm(d_model), nn.Linear(d_model, 16), nn.GELU(),
            nn.Linear(16, 3), nn.Softmax(dim=-1),
        )

    def forward(self, x):
        return self.head(self.encoder(self.pe(self.proj(x)))[:, -1])


class _LSTMNet(nn.Module):
    def __init__(self, input_dim: int, hidden=64, num_layers=2, dropout=0.1):
        super().__init__()
        self.lstm = nn.LSTM(input_dim, hidden, num_layers,
                            batch_first=True, dropout=dropout, bidirectional=False)
        self.head = nn.Sequential(
            nn.LayerNorm(hidden), nn.Linear(hidden, 32), nn.GELU(),
            nn.Linear(32, 3), nn.Softmax(dim=-1),
        )

    def forward(self, x):
        out, _ = self.lstm(x)
        return self.head(out[:, -1])


class _GRUNet(nn.Module):
    def __init__(self, input_dim: int, hidden=64, num_layers=2, dropout=0.1):
        super().__init__()
        self.gru  = nn.GRU(input_dim, hidden, num_layers, batch_first=True, dropout=dropout)
        self.head = nn.Sequential(
            nn.LayerNorm(hidden), nn.Linear(hidden, 32), nn.GELU(),
            nn.Linear(32, 3), nn.Softmax(dim=-1),
        )

    def forward(self, x):
        out, _ = self.gru(x)
        return self.head(out[:, -1])


class _TCNBlock(nn.Module):
    """Single residual TCN block with causal dilated conv."""
    def __init__(self, in_ch, out_ch, kernel_size, dilation):
        super().__init__()
        pad = (kernel_size - 1) * dilation
        self.conv1 = nn.Conv1d(in_ch, out_ch, kernel_size, padding=pad, dilation=dilation)
        self.conv2 = nn.Conv1d(out_ch, out_ch, kernel_size, padding=pad, dilation=dilation)
        self.relu  = nn.GELU()
        self.drop  = nn.Dropout(0.1)
        self.res   = nn.Conv1d(in_ch, out_ch, 1) if in_ch != out_ch else nn.Identity()
        self._trim = pad

    def forward(self, x):
        h = self.relu(self.conv1(x)[:, :, :-self._trim])
        h = self.drop(self.relu(self.conv2(h)[:, :, :-self._trim]))
        return h + self.res(x)


class _TCNNet(nn.Module):
    def __init__(self, input_dim: int, channels=32, levels=4, kernel_size=3):
        super().__init__()
        layers = []
        in_ch  = input_dim
        for i in range(levels):
            layers.append(_TCNBlock(in_ch, channels, kernel_size, dilation=2**i))
            in_ch = channels
        self.network = nn.Sequential(*layers)
        self.head    = nn.Sequential(
            nn.AdaptiveAvgPool1d(1),
        )
        self.fc = nn.Sequential(
            nn.LayerNorm(channels), nn.Linear(channels, 32), nn.GELU(),
            nn.Linear(32, 3), nn.Softmax(dim=-1),
        )

    def forward(self, x):
        # x: (B, T, F) → (B, F, T) for Conv1d
        h = self.network(x.transpose(1, 2))   # (B, C, T)
        h = h[:, :, -1]                        # take last timestep
        return self.fc(h)


# ─────────────────────────────────────────────
#  Trainer Abstraction
# ─────────────────────────────────────────────
@dataclass
class TrainResult:
    loss_history: list[float] = field(default_factory=list)
    epochs_done:  int = 0


class BaseTrainer(ABC):
    @abstractmethod
    def fit(self, X: np.ndarray, meta: dict, callback=None) -> TrainResult:
        """
        X     : (N, seq_len, n_features) — normalized windows
        meta  : {"next_ret": array, "bench_ret": array, "vol_20d": array}
        callback(epoch, loss) — optional progress hook
        """

    @abstractmethod
    def predict(self, X: np.ndarray) -> np.ndarray:
        """Returns (N, 3) probability array [P_short, P_neutral, P_long]."""

    @abstractmethod
    def save(self, path: str) -> None: ...

    @abstractmethod
    def load(self, path: str) -> None: ...


# ─────────────────────────────────────────────
#  PyTorch Trainer (Transformer / LSTM / GRU / TCN)
# ─────────────────────────────────────────────
class TorchTrainer(BaseTrainer):
    def __init__(self, net: nn.Module, hparams: dict):
        self.net    = net
        self.hp     = hparams
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.net.to(self.device)
        self.use_amp = self.device.type == "cuda"

    def fit(self, X: np.ndarray, meta: dict, callback=None) -> TrainResult:
        epochs     = self.hp.get("epochs", 15)
        batch_size = self.hp.get("batch_size", 64)
        lr         = self.hp.get("lr", 1e-3)
        cost       = self.hp.get("transaction_cost", 0.002)

        X_t   = torch.tensor(X, dtype=torch.float32)
        nr_t  = torch.tensor(meta["next_ret"],  dtype=torch.float32)
        nb_t  = torch.tensor(meta["bench_ret"], dtype=torch.float32)
        v_t   = torch.tensor(meta["vol_20d"],   dtype=torch.float32)

        ds     = TensorDataset(X_t, nr_t, nb_t, v_t)
        loader = DataLoader(
            ds,
            batch_size=batch_size,
            shuffle=True,
            drop_last=True,
            pin_memory=self.use_amp,
        )

        opt   = optim.Adam(self.net.parameters(), lr=lr, weight_decay=1e-4)
        sched = optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)
        scaler = torch.cuda.amp.GradScaler(enabled=self.use_amp)

        result = TrainResult()
        self.net.train()
        for epoch in range(epochs):
            total = 0.0
            for xb, yr, yb, yv in loader:
                xb, yr, yb, yv = (t.to(self.device) for t in (xb, yr, yb, yv))
                opt.zero_grad()
                with torch.cuda.amp.autocast(enabled=self.use_amp):
                    out = self.net(xb)
                    loss = alpha_profit_loss(out, yr, yb, yv, cost)
                scaler.scale(loss).backward()
                scaler.unscale_(opt)
                nn.utils.clip_grad_norm_(self.net.parameters(), 1.0)
                scaler.step(opt)
                scaler.update()
                total += loss.item()
            avg = total / len(loader)
            result.loss_history.append(round(avg, 6))
            result.epochs_done = epoch + 1
            sched.step()
            log.info(f"Epoch {epoch+1}/{epochs} | loss={avg:+.4f}")
            if callback:
                callback(epoch + 1, avg)

        return result

    def predict(self, X: np.ndarray) -> np.ndarray:
        self.net.eval()
        X_t = torch.tensor(X, dtype=torch.float32).to(self.device)
        with torch.no_grad():
            out = self.net(X_t).cpu().numpy()
        return out

    def save(self, path: str):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        torch.save({"state_dict": self.net.state_dict(), "hparams": self.hp}, path)

    def load(self, path: str):
        ckpt = torch.load(path, map_location=self.device)
        self.net.load_state_dict(ckpt["state_dict"])


# ─────────────────────────────────────────────
#  Sklearn-style Trainers (XGBoost / LightGBM)
# ─────────────────────────────────────────────
class XGBoostTrainer(BaseTrainer):
    """
    Flattens (N, T, F) → (N, T*F) and trains XGBClassifier.
    Labels: argmax of optimal position per sample.
    """
    def __init__(self, hparams: dict):
        self.hp    = hparams
        self.model = None

    def _make_labels(self, meta: dict) -> np.ndarray:
        excess = meta["next_ret"] - meta["bench_ret"]
        labels = np.where(excess > 0.002, 2,   # long
                 np.where(excess < -0.002, 0,   # short
                 1))                             # neutral
        return labels

    def fit(self, X: np.ndarray, meta: dict, callback=None) -> TrainResult:
        from xgboost import XGBClassifier
        X_flat = X.reshape(len(X), -1)
        y      = self._make_labels(meta)
        self.model = XGBClassifier(
            n_estimators = self.hp.get("n_estimators", 300),
            max_depth    = self.hp.get("max_depth", 5),
            learning_rate= self.hp.get("lr", 0.05),
            subsample    = self.hp.get("subsample", 0.8),
            use_label_encoder=False,
            eval_metric="mlogloss",
            verbosity=0,
        )
        self.model.fit(X_flat, y)
        return TrainResult(loss_history=[], epochs_done=1)

    def predict(self, X: np.ndarray) -> np.ndarray:
        X_flat = X.reshape(len(X), -1)
        return self.model.predict_proba(X_flat)   # (N, 3)

    def save(self, path: str):
        import joblib
        os.makedirs(os.path.dirname(path), exist_ok=True)
        joblib.dump(self.model, path)

    def load(self, path: str):
        import joblib
        self.model = joblib.load(path)


class LightGBMTrainer(BaseTrainer):
    def __init__(self, hparams: dict):
        self.hp    = hparams
        self.model = None

    def _make_labels(self, meta):
        excess = meta["next_ret"] - meta["bench_ret"]
        return np.where(excess > 0.002, 2, np.where(excess < -0.002, 0, 1))

    def fit(self, X: np.ndarray, meta: dict, callback=None) -> TrainResult:
        import lightgbm as lgb
        X_flat = X.reshape(len(X), -1)
        y      = self._make_labels(meta)
        self.model = lgb.LGBMClassifier(
            n_estimators = self.hp.get("n_estimators", 500),
            max_depth    = self.hp.get("max_depth", -1),
            learning_rate= self.hp.get("lr", 0.05),
            num_leaves   = self.hp.get("num_leaves", 31),
            verbosity    = -1,
        )
        self.model.fit(X_flat, y)
        return TrainResult(loss_history=[], epochs_done=1)

    def predict(self, X: np.ndarray) -> np.ndarray:
        return self.model.predict_proba(X.reshape(len(X), -1))

    def save(self, path: str):
        import joblib
        os.makedirs(os.path.dirname(path), exist_ok=True)
        joblib.dump(self.model, path)

    def load(self, path: str):
        import joblib
        self.model = joblib.load(path)


# ─────────────────────────────────────────────
#  Factory
# ─────────────────────────────────────────────
DEFAULT_HPARAMS = {
    "transformer": {"d_model":32,"nhead":4,"num_layers":2,"dropout":0.1,"epochs":15,"batch_size":64,"lr":1e-3,"transaction_cost":0.002},
    "lstm":        {"hidden":64,"num_layers":2,"dropout":0.1,"epochs":15,"batch_size":64,"lr":1e-3,"transaction_cost":0.002},
    "gru":         {"hidden":64,"num_layers":2,"dropout":0.1,"epochs":15,"batch_size":64,"lr":1e-3,"transaction_cost":0.002},
    "tcn":         {"channels":32,"levels":4,"kernel_size":3,"epochs":15,"batch_size":64,"lr":1e-3,"transaction_cost":0.002},
    "xgboost":     {"n_estimators":300,"max_depth":5,"lr":0.05,"subsample":0.8},
    "lightgbm":    {"n_estimators":500,"max_depth":-1,"lr":0.05,"num_leaves":31},
}


def get_trainer(arch: str, input_dim: int, hparams: dict) -> BaseTrainer:
    hp = {**DEFAULT_HPARAMS.get(arch, {}), **hparams}
    if arch == "transformer":
        net = _AlphaTransformerNet(input_dim, hp["d_model"], hp["nhead"], hp["num_layers"], hp["dropout"])
        return TorchTrainer(net, hp)
    elif arch == "lstm":
        net = _LSTMNet(input_dim, hp["hidden"], hp["num_layers"], hp["dropout"])
        return TorchTrainer(net, hp)
    elif arch == "gru":
        net = _GRUNet(input_dim, hp["hidden"], hp["num_layers"], hp["dropout"])
        return TorchTrainer(net, hp)
    elif arch == "tcn":
        net = _TCNNet(input_dim, hp["channels"], hp["levels"], hp["kernel_size"])
        return TorchTrainer(net, hp)
    elif arch == "xgboost":
        return XGBoostTrainer(hp)
    elif arch == "lightgbm":
        return LightGBMTrainer(hp)
    else:
        raise ValueError(f"Unknown architecture: {arch}")
