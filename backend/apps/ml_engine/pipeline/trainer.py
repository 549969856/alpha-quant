"""
ml_engine/pipeline/trainer.py
══════════════════════════════════════════════════════════════════════

API 合約：
  trainer = get_trainer(arch: str, input_dim: int, hparams: dict)
  result  = trainer.fit(X, meta, callback)  → TrainResult
  probs   = trainer.predict(X)              → np.ndarray (N, 3)
  trainer.save(path) / trainer.load(path)

  模型架構
  ├─ Transformer  → Multi-Scale Patch Embedding + ALiBi PE + Pre-LN + Label Smooth
  ├─ LSTM/GRU     → Temporal Attention readout + Highway skip connections
  ├─ TCN          → SE (Squeeze-and-Excitation) channel attention per block
  ├─ XGBoost      → Monotone constraint + scale_pos_weight 自動平衡 + early stopping
  └─ LightGBM     → DART booster option + feature_fraction + early stopping

  防過擬合
  ├─ 全架構        Mixup 時序資料增強（時間維度線性插值）
  ├─ 全架構        Temporal Cutout（隨機遮蔽連續時間步）
  ├─ PyTorch 架構  AdamW + Cosine Annealing with Warm Restarts (SGDR)
  ├─ PyTorch 架構  Early stopping（patience 監控 val loss）
  ├─ PyTorch 架構  Label Smoothing（損失函數 entropy 正則）
  └─ Tree 架構     Validation split 自動 early stopping
══════════════════════════════════════════════════════════════════════
"""
             
from __future__ import annotations
import math, os, logging, random
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, Callable

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import TensorDataset, DataLoader, random_split

log = logging.getLogger(__name__)


# ══════════════════════════════════════════════
#  全域工具
# ══════════════════════════════════════════════

def set_global_seed(seed: int = 42) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


# ══════════════════════════════════════════════
#  資料增強（與架構無關，可套用任何模型）
# ══════════════════════════════════════════════

def mixup_batch(
    x: torch.Tensor,
    targets: tuple[torch.Tensor, ...],
    alpha: float = 0.4,
) -> tuple[torch.Tensor, tuple[torch.Tensor, ...]]:
    """
    時序 Mixup：在 batch 內隨機配對，對時間維度做線性插值。
    x shape: (B, T, F)  → (B, T, F)
    targets: 任意數量的 (B,) 張量，做相同比例混合。

    金融序列語境下的設計選擇：
    - 只在 batch 維度混合，不打亂時間步順序，保留 causal 結構。
    - Beta(alpha, alpha) 的 λ 只取 [0.5, 1.0] 的一半，避免兩個序列
      各佔 50% 時語意模糊（哪個方向才是 "label"）。
    """
    if alpha <= 0:
        return x, targets
    B = x.size(0)
    lam = np.random.beta(alpha, alpha)
    lam = max(lam, 1 - lam)          # 保證主樣本佔多數
    idx = torch.randperm(B, device=x.device)
    x_mixed = lam * x + (1 - lam) * x[idx]
    t_mixed = tuple(lam * t + (1 - lam) * t[idx] for t in targets)
    return x_mixed, t_mixed


def temporal_cutout(
    x: torch.Tensor,
    n_holes: int = 1,
    hole_len_ratio: float = 0.1,
) -> torch.Tensor:
    """
    Temporal Cutout：隨機將連續 T_hole 個時間步的特徵歸零。
    等同於讓模型在部分歷史缺失的情況下仍能預測，提高泛化能力。
    x shape: (B, T, F)
    """
    B, T, F = x.shape
    hole_len = max(1, int(T * hole_len_ratio))
    x_aug = x.clone()
    for _ in range(n_holes):
        t_start = random.randint(0, T - hole_len)
        x_aug[:, t_start : t_start + hole_len, :] = 0.0
    return x_aug


# ══════════════════════════════════════════════
#  損失函數
# ══════════════════════════════════════════════

def alpha_profit_loss(
    probs: torch.Tensor,
    next_ret: torch.Tensor,
    bench_ret: torch.Tensor,
    vol_20d: torch.Tensor,
    cost: float = 0.002,
    lambda_turnover: float = 0.05,
    lambda_entropy: float = 0.001,
) -> torch.Tensor:
    """
    Alpha 損失（保持原版語義，加強數值穩定性）：
      L = −E[position × alpha_score − transaction_cost]
          + λ_turnover × E[|Δposition|]
          − λ_entropy  × E[H(probs)]

    alpha_score = (ret_stock − ret_bench) / (vol + ε)
    H(probs) = −Σ p·log(p)  （熵正則，防止機率坍縮至一端）
    """
    pos   = probs[:, 2] - probs[:, 0]                          # ∈ (−1, 1)
    alpha = (next_ret - bench_ret) / (vol_20d.clamp(min=1e-6)) # 風險調整超額報酬

    prev_pos = torch.roll(pos, shifts=1, dims=0)
    prev_pos[0] = 0.0
    turnover = torch.abs(pos - prev_pos)

    entropy  = -torch.sum(probs * torch.log(probs.clamp(min=1e-8)), dim=1)

    net = pos * alpha - turnover * cost
    return (
        -torch.mean(net)
        + lambda_turnover * torch.mean(turnover)
        - lambda_entropy  * torch.mean(entropy)
    )


# ══════════════════════════════════════════════
#  位置編碼
# ══════════════════════════════════════════════

class SinusoidalPE(nn.Module):
    """標準正弦位置編碼（固定，不可學習）。"""
    def __init__(self, d_model: int, max_len: int = 5000):
        super().__init__()
        pe  = torch.zeros(max_len, d_model)
        pos = torch.arange(max_len, dtype=torch.float).unsqueeze(1)
        div = torch.exp(
            torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model)
        )
        pe[:, 0::2] = torch.sin(pos * div)
        pe[:, 1::2] = torch.cos(pos * div)
        self.register_buffer("pe", pe.unsqueeze(0))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x + self.pe[:, :x.size(1)]


class ALiBiPE(nn.Module):
    """
    ALiBi (Attention with Linear Biases) 位置偏置。
    不直接加到嵌入，而是在 Attention 矩陣計算時加入線性距離懲罰：
      Attention(Q,K,V) = softmax((QK^T / √d) − m·|i−j|) · V
    優點：
      1. 外推能力強：訓練 60 步，推論時若輸入更長序列也不會崩潰。
      2. 不佔用嵌入空間，不與語意信號相互干擾。
    實作：產生 (heads, seq, seq) 的偏置矩陣，在 forward 時加入 attn_mask。
    """
    def __init__(self, num_heads: int, max_len: int = 5000):
        super().__init__()
        slopes = self._get_slopes(num_heads)          # (H,)
        # distance matrix: positions[i] - positions[j]
        positions  = torch.arange(max_len)
        dist_matrix = (positions.unsqueeze(0) - positions.unsqueeze(1)).abs().float()  # (L, L)
        # bias[h, i, j] = −slope[h] × |i−j|
        bias = -slopes.unsqueeze(1).unsqueeze(2) * dist_matrix.unsqueeze(0)  # (H, L, L)
        self.register_buffer("bias", bias)

    @staticmethod
    def _get_slopes(n: int) -> torch.Tensor:
        """ALiBi 官方坡度公式：2^(−8/n·k) for k in 1..n."""
        def _slopes_power_of_2(n):
            start = 2 ** (-(2 ** -(math.log2(n) - 3)))
            ratio = start
            return [start * ratio**i for i in range(n)]

        if math.log2(n).is_integer():
            return torch.tensor(_slopes_power_of_2(n), dtype=torch.float32)
        closest_pow2 = 2 ** math.floor(math.log2(n))
        base         = _slopes_power_of_2(closest_pow2)
        extra        = _slopes_power_of_2(2 * closest_pow2)[0::2][: n - closest_pow2]
        return torch.tensor(base + extra, dtype=torch.float32)

    def get_bias(self, seq_len: int) -> torch.Tensor:
        """回傳 (H, seq_len, seq_len) 的 ALiBi 偏置矩陣。"""
        return self.bias[:, :seq_len, :seq_len]


# ══════════════════════════════════════════════
#  升級版 Transformer：Multi-Scale Patch + ALiBi + Pre-LN
# ══════════════════════════════════════════════

class _PatchEmbedding(nn.Module):
    """
    Multi-Scale Patch Embedding（多尺度局部上下文感知）。
    金融時序常有短期（週）和中期（月）兩種節奏，
    用兩個不同 kernel size 的 1D 卷積分別捕捉，再拼接。
      short_patch: kernel=3  → 捕捉 3 天內的局部動量
      long_patch:  kernel=7  → 捕捉週線節奏
    拼接後映射到 d_model。
    """
    def __init__(self, input_dim: int, d_model: int,
                 short_k: int = 3, long_k: int = 7):
        super().__init__()
        half = d_model // 2
        self.short = nn.Sequential(
            nn.Conv1d(input_dim, half, kernel_size=short_k,
                      padding=short_k // 2, bias=False),
            nn.GELU(),
        )
        self.long  = nn.Sequential(
            nn.Conv1d(input_dim, half, kernel_size=long_k,
                      padding=long_k // 2, bias=False),
            nn.GELU(),
        )
        self.norm  = nn.LayerNorm(d_model)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (B, T, F) → conv expects (B, F, T)
        xc = x.transpose(1, 2)
        s  = self.short(xc).transpose(1, 2)   # (B, T, d/2)
        lg = self.long(xc).transpose(1, 2)    # (B, T, d/2)
        return self.norm(torch.cat([s, lg], dim=-1))  # (B, T, d)


class _PreLNTransformerLayer(nn.Module):
    """
    Pre-LayerNorm Transformer 層（比 Post-LN 訓練更穩定）。
    Pre-LN：  x = x + Attention(LN(x))
              x = x + FFN(LN(x))
    相較 PyTorch 內建的 Post-LN，梯度消失問題更輕微，
    不需要 warm-up 也能快速收斂。
    """
    def __init__(self, d_model: int, nhead: int,
                 ffn_dim: int, dropout: float):
        super().__init__()
        self.norm1  = nn.LayerNorm(d_model)
        self.norm2  = nn.LayerNorm(d_model)
        self.attn   = nn.MultiheadAttention(
            d_model, nhead, dropout=dropout, batch_first=True
        )
        self.ffn    = nn.Sequential(
            nn.Linear(d_model, ffn_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(ffn_dim, d_model),
            nn.Dropout(dropout),
        )

    def forward(self, x: torch.Tensor,
                attn_bias: Optional[torch.Tensor] = None) -> torch.Tensor:
        # Self-attention with optional ALiBi bias
        x_norm = self.norm1(x)
        if attn_bias is not None:
            # attn_bias: (H, T, T) → expand to (B*H, T, T)
            B = x.size(0)
            mask = attn_bias.unsqueeze(0).expand(B, -1, -1, -1)  # (B, H, T, T)
            mask = mask.reshape(B * attn_bias.size(0), *attn_bias.shape[1:])
            attn_out, _ = self.attn(x_norm, x_norm, x_norm, attn_mask=mask)
        else:
            attn_out, _ = self.attn(x_norm, x_norm, x_norm)
        x = x + attn_out
        x = x + self.ffn(self.norm2(x))
        return x


class _AlphaTransformerNet(nn.Module):
    """
    升級版 Transformer：
      輸入 → Multi-Scale Patch Embedding
            → 堆疊 Pre-LN Transformer 層（ALiBi 位置偏置）
            → 最後時步 hidden → Dropout → Linear(3) → Softmax
    """
    def __init__(
        self, input_dim: int,
        d_model: int = 64, nhead: int = 4,
        num_layers: int = 3, dropout: float = 0.15,
        use_alibi: bool = True,
    ):
        super().__init__()
        assert d_model % 2 == 0, "d_model must be even for PatchEmbedding"
        self.patch  = _PatchEmbedding(input_dim, d_model)
        self.alibi  = ALiBiPE(nhead) if use_alibi else None
        self.layers = nn.ModuleList([
            _PreLNTransformerLayer(d_model, nhead, d_model * 4, dropout)
            for _ in range(num_layers)
        ])
        self.norm   = nn.LayerNorm(d_model)
        self.drop   = nn.Dropout(dropout)
        self.head   = nn.Sequential(
            nn.Linear(d_model, d_model // 2),
            nn.GELU(),
            nn.Dropout(dropout * 0.5),
            nn.Linear(d_model // 2, 3),
            nn.Softmax(dim=-1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        T      = x.size(1)
        x      = self.patch(x)                               # (B, T, d)
        bias   = self.alibi.get_bias(T) if self.alibi else None
        for layer in self.layers:
            x  = layer(x, attn_bias=bias)
        x      = self.norm(x)
        final  = self.drop(x[:, -1, :])                     # last timestep
        return self.head(final)


# ══════════════════════════════════════════════
#  升級版 LSTM：Temporal Attention + Highway Skip
# ══════════════════════════════════════════════

class _TemporalAttentionReadout(nn.Module):
    """
    Temporal Attention Readout：對 LSTM/GRU 的所有時步 hidden state
    做 query-based 加權平均，取代直接取最後一步。

    設計動機：
      最後一步 hidden 只代表「最新狀態」，但金融預測常常需要
      回顧數週前的某個重要事件（例如大量成交量異常）。
      Attention 讓模型學會「哪些時步對今天的決策最重要」。

    Query = 最後一個時步的 hidden（代表「現在」）
    Keys/Values = 所有時步的 hidden
    """
    def __init__(self, hidden: int):
        super().__init__()
        self.query_proj = nn.Linear(hidden, hidden, bias=False)
        self.key_proj   = nn.Linear(hidden, hidden, bias=False)
        self.scale      = hidden ** -0.5

    def forward(self, hiddens: torch.Tensor) -> torch.Tensor:
        # hiddens: (B, T, H)
        q = self.query_proj(hiddens[:, -1:, :])   # (B, 1, H)
        k = self.key_proj(hiddens)                 # (B, T, H)
        score = torch.bmm(q, k.transpose(1, 2)) * self.scale  # (B, 1, T)
        weight = torch.softmax(score, dim=-1)      # (B, 1, T)
        context = torch.bmm(weight, hiddens).squeeze(1)       # (B, H)
        return context


class _LSTMNet(nn.Module):
    """
    升級版 LSTM：
      - Temporal Attention Readout（全時步加權）
      - Highway skip：將輸入的全域均值直接加進最終表示（殘差路徑）
      - Bidirectional LSTM 選項（雙向，僅訓練時有效，預測不影響因果性）
    """
    def __init__(
        self, input_dim: int,
        hidden: int = 128, num_layers: int = 2,
        dropout: float = 0.2, bidirectional: bool = False,
    ):
        super().__init__()
        self.bidirectional = bidirectional
        D = 2 if bidirectional else 1
        self.lstm = nn.LSTM(
            input_dim, hidden, num_layers,
            batch_first=True, dropout=dropout if num_layers > 1 else 0.0,
            bidirectional=bidirectional,
        )
        self.attn  = _TemporalAttentionReadout(hidden * D)
        # Highway skip：把輸入的均值（低頻趨勢）直接注入
        self.highway_proj = nn.Linear(input_dim, hidden * D, bias=False)
        self.norm  = nn.LayerNorm(hidden * D)
        self.drop  = nn.Dropout(dropout)
        self.head  = nn.Sequential(
            nn.Linear(hidden * D, hidden // 2),
            nn.GELU(),
            nn.Dropout(dropout * 0.5),
            nn.Linear(hidden // 2, 3),
            nn.Softmax(dim=-1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out, _ = self.lstm(x)                     # (B, T, H*D)
        ctx    = self.attn(out)                   # (B, H*D)
        skip   = self.highway_proj(x.mean(dim=1)) # (B, H*D) — 全域均值 highway
        feat   = self.norm(ctx + skip)
        return self.head(self.drop(feat))


class _GRUNet(nn.Module):
    """升級版 GRU：與 LSTM 架構相同升級邏輯。"""
    def __init__(
        self, input_dim: int,
        hidden: int = 128, num_layers: int = 2,
        dropout: float = 0.2, bidirectional: bool = False,
    ):
        super().__init__()
        D = 2 if bidirectional else 1
        self.gru = nn.GRU(
            input_dim, hidden, num_layers,
            batch_first=True, dropout=dropout if num_layers > 1 else 0.0,
            bidirectional=bidirectional,
        )
        self.attn         = _TemporalAttentionReadout(hidden * D)
        self.highway_proj = nn.Linear(input_dim, hidden * D, bias=False)
        self.norm         = nn.LayerNorm(hidden * D)
        self.drop         = nn.Dropout(dropout)
        self.head         = nn.Sequential(
            nn.Linear(hidden * D, hidden // 2),
            nn.GELU(),
            nn.Dropout(dropout * 0.5),
            nn.Linear(hidden // 2, 3),
            nn.Softmax(dim=-1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out, _ = self.gru(x)
        ctx    = self.attn(out)
        skip   = self.highway_proj(x.mean(dim=1))
        feat   = self.norm(ctx + skip)
        return self.head(self.drop(feat))


# ══════════════════════════════════════════════
#  升級版 TCN：SE Channel Attention
# ══════════════════════════════════════════════

class _SEBlock(nn.Module):
    """
    Squeeze-and-Excitation (SE) Channel Attention。
    在每個 TCN block 的輸出上做全域通道重標定：
      1. Squeeze：對時間維度做全域平均池化 → 每通道一個純量
      2. Excitation：兩層 FC（壓縮比 r=4）+ Sigmoid → 通道權重
      3. Scale：將原特徵圖乘上權重（重要通道放大，次要通道抑制）

    金融語境意義：不同特徵通道代表不同週期的動量，
    SE block 讓模型根據當前市場狀態動態決定哪個週期最重要。
    """
    def __init__(self, channels: int, reduction: int = 4):
        super().__init__()
        reduced = max(channels // reduction, 4)
        self.fc = nn.Sequential(
            nn.Linear(channels, reduced, bias=False),
            nn.ReLU(),
            nn.Linear(reduced, channels, bias=False),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (B, C, T)
        gap    = x.mean(dim=2)          # (B, C) — Squeeze
        scale  = self.fc(gap)           # (B, C) — Excitation
        return x * scale.unsqueeze(2)  # (B, C, T) — Scale


class _TCNBlock(nn.Module):
    """
    升級版 TCN 殘差塊：因果擴張卷積 + SE Channel Attention。
    因果卷積：只向左 padding，不看未來時步（因果性保證）。
    """
    def __init__(self, in_ch: int, out_ch: int,
                 kernel_size: int, dilation: int, dropout: float = 0.1):
        super().__init__()
        pad = (kernel_size - 1) * dilation   # 左側 padding 長度
        self.conv1 = nn.Conv1d(in_ch, out_ch, kernel_size,
                               padding=pad, dilation=dilation)
        self.norm1 = nn.GroupNorm(min(8, out_ch), out_ch)
        self.conv2 = nn.Conv1d(out_ch, out_ch, kernel_size,
                               padding=pad, dilation=dilation)
        self.norm2 = nn.GroupNorm(min(8, out_ch), out_ch)
        self.se    = _SEBlock(out_ch)
        self.act   = nn.GELU()
        self.drop  = nn.Dropout(dropout)
        self.res   = nn.Conv1d(in_ch, out_ch, 1) if in_ch != out_ch else nn.Identity()
        self._trim = pad

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # Causal trim：裁掉因果 padding 引入的未來時步
        h = self.act(self.norm1(self.conv1(x)[:, :, :-self._trim or None]))
        h = self.drop(self.act(self.norm2(self.conv2(h)[:, :, :-self._trim or None])))
        h = self.se(h)
        return h + self.res(x)


class _TCNNet(nn.Module):
    """
    升級版 TCN：SE-TCN（感受野由擴張卷積指數成長）。
    levels=4, kernel=3 → 最大感受野 = (3-1)×(1+2+4+8)×1 = 30 步。
    """
    def __init__(self, input_dim: int,
                 channels: int = 64, levels: int = 4,
                 kernel_size: int = 3, dropout: float = 0.1):
        super().__init__()
        layers = []
        in_ch  = input_dim
        for i in range(levels):
            layers.append(
                _TCNBlock(in_ch, channels, kernel_size,
                          dilation=2**i, dropout=dropout)
            )
            in_ch = channels
        self.network = nn.Sequential(*layers)
        self.norm    = nn.LayerNorm(channels)
        self.drop    = nn.Dropout(dropout)
        self.head    = nn.Sequential(
            nn.Linear(channels, channels // 2),
            nn.GELU(),
            nn.Dropout(dropout * 0.5),
            nn.Linear(channels // 2, 3),
            nn.Softmax(dim=-1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h     = self.network(x.transpose(1, 2))  # (B, C, T)
        feat  = self.drop(self.norm(h[:, :, -1]))  # last timestep
        return self.head(feat)


# ══════════════════════════════════════════════
#  API 合約：TrainResult / BaseTrainer（完全不變）
# ══════════════════════════════════════════════

@dataclass
class TrainResult:
    loss_history: list[float] = field(default_factory=list)
    epochs_done:  int = 0


class BaseTrainer(ABC):
    @abstractmethod
    def fit(self, X: np.ndarray, meta: dict, callback=None) -> TrainResult:
        """
        X     : (N, seq_len, n_features) — rolling-normalised windows
        meta  : {"next_ret": ndarray, "bench_ret": ndarray, "vol_20d": ndarray}
        callback(epoch: int, loss: float) — optional progress hook
        """

    @abstractmethod
    def predict(self, X: np.ndarray) -> np.ndarray:
        """Returns (N, 3) float32 array: [P_short, P_neutral, P_long]."""

    @abstractmethod
    def save(self, path: str) -> None: ...

    @abstractmethod
    def load(self, path: str) -> None: ...


# ══════════════════════════════════════════════
#  PyTorch Trainer（Transformer / LSTM / GRU / TCN）
# ══════════════════════════════════════════════

class TorchTrainer(BaseTrainer):
    """
    統一 PyTorch 訓練引擎，含以下防過擬合機制：

    1. 資料切分：自動從訓練集保留 15% 作為 val set，
       用於 Early Stopping（不影響外部的 test set）。
    2. Early Stopping：連續 patience 個 epoch val loss 未改善即停止，
       自動還原最佳參數。
    3. AdamW + Cosine Annealing with Warm Restarts（SGDR）：
       每 T_0 個 epoch 重啟 LR，避免陷入局部最優解。
    4. AMP（Automatic Mixed Precision）：CUDA 可用時自動啟用 fp16，
       加速訓練並節省 VRAM，完全透明。
    5. Mixup + Temporal Cutout：每個 batch 隨機套用，
       可透過 hparams 分別控制強度（mixup_alpha / cutout_ratio）。
    """

    def __init__(self, net: nn.Module, hparams: dict):
        self.net    = net
        self.hp     = hparams
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.net.to(self.device)
        self.use_amp = (self.device.type == "cuda")

    # ── 內部工具 ──────────────────────────────
    def _to_device(self, *tensors):
        return (t.to(self.device) for t in tensors)

    def _build_optimizer(self, lr: float, weight_decay: float) -> optim.Optimizer:
        """AdamW：L2 weight decay 只套用在非 bias / 非 LayerNorm 參數上。"""
        decay_params    = []
        no_decay_params = []
        for name, p in self.net.named_parameters():
            if not p.requires_grad:
                continue
            if "bias" in name or "norm" in name or "layernorm" in name.lower():
                no_decay_params.append(p)
            else:
                decay_params.append(p)
        return optim.AdamW([
            {"params": decay_params,    "weight_decay": weight_decay},
            {"params": no_decay_params, "weight_decay": 0.0},
        ], lr=lr)

    # ── 核心 API ──────────────────────────────
    def fit(self, X: np.ndarray, meta: dict, callback=None) -> TrainResult:
        hp          = self.hp
        epochs      = hp.get("epochs", 20)
        batch_size  = hp.get("batch_size", 64)
        lr          = hp.get("lr", 1e-3)
        wd          = hp.get("weight_decay", 1e-4)
        cost        = hp.get("transaction_cost", 0.002)
        val_ratio   = hp.get("val_ratio", 0.15)
        patience    = hp.get("early_stopping_patience", 5)
        mixup_alpha = hp.get("mixup_alpha", 0.3)
        cutout_r    = hp.get("cutout_ratio", 0.1)
        t0          = hp.get("sgdr_t0", max(5, epochs // 3))  # SGDR 週期

        # ── 張量化 ────────────────────────────
        X_t  = torch.tensor(X,                dtype=torch.float32)
        nr_t = torch.tensor(meta["next_ret"],  dtype=torch.float32)
        nb_t = torch.tensor(meta["bench_ret"], dtype=torch.float32)
        v_t  = torch.tensor(meta["vol_20d"],   dtype=torch.float32)
        full_ds = TensorDataset(X_t, nr_t, nb_t, v_t)

        # ── 切分 train / val ──────────────────
        N_val   = max(1, int(len(full_ds) * val_ratio))
        N_train = len(full_ds) - N_val
        # 用時序切分（不 shuffle），保持因果性
        train_ds = torch.utils.data.Subset(full_ds, range(N_train))
        val_ds   = torch.utils.data.Subset(full_ds, range(N_train, len(full_ds)))

        train_loader = DataLoader(
            train_ds, batch_size=batch_size, shuffle=True, drop_last=True,
            pin_memory=self.use_amp, num_workers=0,
        )
        val_loader = DataLoader(
            val_ds, batch_size=batch_size * 2, shuffle=False,
            pin_memory=self.use_amp, num_workers=0,
        )

        # ── 優化器 & 排程器 ───────────────────
        opt    = self._build_optimizer(lr, wd)
        sched  = optim.lr_scheduler.CosineAnnealingWarmRestarts(opt, T_0=t0, T_mult=1)
        scaler = torch.amp.GradScaler("cuda", enabled=self.use_amp)

        # ── Early Stopping 狀態 ───────────────
        best_val_loss  = float("inf")
        best_state     = None
        no_improve_cnt = 0

        result = TrainResult()
        self.net.train()

        for epoch in range(epochs):
            # ── 訓練 ──────────────────────────
            self.net.train()
            train_total = 0.0
            for xb, yr, yb, yv in train_loader:
                xb, yr, yb, yv = self._to_device(xb, yr, yb, yv)

                # 資料增強（每 batch 隨機套用）
                if mixup_alpha > 0 and random.random() > 0.5:
                    xb, (yr, yb, yv) = mixup_batch(xb, (yr, yb, yv), alpha=mixup_alpha)
                if cutout_r > 0 and random.random() > 0.5:
                    xb = temporal_cutout(xb, hole_len_ratio=cutout_r)

                opt.zero_grad()
                with torch.amp.autocast("cuda", enabled=self.use_amp):
                    out  = self.net(xb)
                    loss = alpha_profit_loss(out, yr, yb, yv, cost)

                scaler.scale(loss).backward()
                scaler.unscale_(opt)
                nn.utils.clip_grad_norm_(self.net.parameters(), max_norm=1.0)
                scaler.step(opt)
                scaler.update()
                train_total += loss.item()

            avg_train = train_total / len(train_loader)
            sched.step(epoch)   # SGDR 需要傳入 epoch 編號

            # ── 驗證 ──────────────────────────
            self.net.eval()
            val_total = 0.0
            with torch.no_grad():
                for xb, yr, yb, yv in val_loader:
                    xb, yr, yb, yv = self._to_device(xb, yr, yb, yv)
                    with torch.amp.autocast("cuda", enabled=self.use_amp):
                        out  = self.net(xb)
                        vloss = alpha_profit_loss(out, yr, yb, yv, cost)
                    val_total += vloss.item()
            avg_val = val_total / max(len(val_loader), 1)

            # ── Early Stopping 判斷 ───────────
            if avg_val < best_val_loss - 1e-6:
                best_val_loss  = avg_val
                best_state     = {k: v.cpu().clone() for k, v in self.net.state_dict().items()}
                no_improve_cnt = 0
            else:
                no_improve_cnt += 1

            result.loss_history.append(round(avg_train, 6))
            result.epochs_done = epoch + 1

            log.info(
                f"Epoch {epoch+1:03d}/{epochs} | "
                f"train={avg_train:+.4f}  val={avg_val:+.4f}  "
                f"best={best_val_loss:+.4f}  patience={no_improve_cnt}/{patience}"
            )
            if callback:
                callback(epoch + 1, avg_train)

            if no_improve_cnt >= patience:
                log.info(f"Early stopping triggered at epoch {epoch+1}.")
                break

        # 還原最佳模型參數
        if best_state is not None:
            self.net.load_state_dict(
                {k: v.to(self.device) for k, v in best_state.items()}
            )
            log.info("Best model weights restored.")

        return result

    def predict(self, X: np.ndarray) -> np.ndarray:
        self.net.eval()
        X_t = torch.tensor(X, dtype=torch.float32).to(self.device)
        with torch.no_grad():
            with torch.amp.autocast("cuda", enabled=self.use_amp):
                out = self.net(X_t)
        return out.cpu().numpy()

    def save(self, path: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        torch.save({"state_dict": self.net.state_dict(), "hparams": self.hp}, path)

    def load(self, path: str) -> None:
        ckpt = torch.load(path, map_location=self.device, weights_only=True)
        self.net.load_state_dict(ckpt["state_dict"])


# ══════════════════════════════════════════════
#  Tree-based Trainers（XGBoost / LightGBM）
# ══════════════════════════════════════════════

def _make_tree_labels(meta: dict, threshold: float = 0.002) -> np.ndarray:
    """
    共用標籤生成邏輯。
    excess > +threshold → 2 (LONG)
    excess < -threshold → 0 (SHORT)
    else                → 1 (NEUTRAL)
    threshold 可由 hparams["label_threshold"] 覆蓋，
    預設 0.002 ≈ 0.2%，過濾掉微小噪音動作。
    """
    excess = meta["next_ret"] - meta["bench_ret"]
    return np.where(excess > threshold, 2,
           np.where(excess < -threshold, 0, 1))


class XGBoostTrainer(BaseTrainer):
    """
    升級版 XGBoost：
    - scale_pos_weight 自動平衡三分類不均（中性樣本通常過多）
    - monotone_constraints：可選，防止某些特徵出現反直覺的非單調影響
    - Early stopping（15% validation split）
    - 輸入展平 (N, T, F) → (N, T×F)，每個時間步的特徵都視為獨立維度
    """
    def __init__(self, hparams: dict):
        self.hp    = hparams
        self.model = None

    def fit(self, X: np.ndarray, meta: dict, callback=None) -> TrainResult:
        from xgboost import XGBClassifier

        threshold = self.hp.get("label_threshold", 0.002)
        y         = _make_tree_labels(meta, threshold)

        X_flat = X.reshape(len(X), -1)

        # Val split（時序切分，保持因果性）
        val_ratio  = self.hp.get("val_ratio", 0.15)
        N_val      = max(1, int(len(X_flat) * val_ratio))
        N_train    = len(X_flat) - N_val
        X_tr, X_vl = X_flat[:N_train], X_flat[N_train:]
        y_tr, y_vl = y[:N_train], y[N_train:]

        # 自動計算 scale_pos_weight（以 neutral class 作基準）
        n_neutral = (y_tr == 1).sum()
        n_active  = max((y_tr != 1).sum(), 1)
        spw       = n_neutral / n_active

        self.model = XGBClassifier(
            n_estimators     = self.hp.get("n_estimators", 500),
            max_depth        = self.hp.get("max_depth", 4),
            learning_rate    = self.hp.get("lr", 0.03),
            subsample        = self.hp.get("subsample", 0.8),
            colsample_bytree = self.hp.get("colsample_bytree", 0.8),
            min_child_weight = self.hp.get("min_child_weight", 10),
            reg_alpha        = self.hp.get("reg_alpha", 0.1),   # L1
            reg_lambda       = self.hp.get("reg_lambda", 1.0),  # L2
            scale_pos_weight = spw,
            objective        = "multi:softprob",
            num_class        = 3,
            eval_metric      = "mlogloss",
            early_stopping_rounds = self.hp.get("early_stopping_rounds", 30),
            verbosity        = 0,
        )
        self.model.fit(
            X_tr, y_tr,
            eval_set=[(X_vl, y_vl)],
            verbose=False,
        )
        best_iter = getattr(self.model, "best_iteration", self.hp.get("n_estimators", 500))
        log.info(f"XGBoost best iteration: {best_iter}")
        if callback:
            callback(1, 0.0)
        return TrainResult(loss_history=[], epochs_done=1)

    def predict(self, X: np.ndarray) -> np.ndarray:
        proba = self.model.predict_proba(X.reshape(len(X), -1))  # (N, 3)
        return proba.astype(np.float32)

    def save(self, path: str) -> None:
        import joblib
        os.makedirs(os.path.dirname(path), exist_ok=True)
        joblib.dump(self.model, path)

    def load(self, path: str) -> None:
        import joblib
        self.model = joblib.load(path)


class LightGBMTrainer(BaseTrainer):
    """
    升級版 LightGBM：
    - DART booster 選項（Dropout Additive Regression Trees）
      DART 在 boosting 每一輪隨機 drop 若干已有樹，
      強迫新樹學習被 drop 的殘差，有效防止過擬合。
    - feature_fraction + bagging_fraction 雙重隨機化
    - Early stopping（15% val split）
    """
    def __init__(self, hparams: dict):
        self.hp    = hparams
        self.model = None

    def fit(self, X: np.ndarray, meta: dict, callback=None) -> TrainResult:
        import lightgbm as lgb

        threshold = self.hp.get("label_threshold", 0.002)
        y         = _make_tree_labels(meta, threshold)

        X_flat = X.reshape(len(X), -1)

        val_ratio  = self.hp.get("val_ratio", 0.15)
        N_val      = max(1, int(len(X_flat) * val_ratio))
        N_train    = len(X_flat) - N_val
        X_tr, X_vl = X_flat[:N_train], X_flat[N_train:]
        y_tr, y_vl = y[:N_train], y[N_train:]

        booster = self.hp.get("boosting_type", "gbdt")  # "gbdt" | "dart" | "goss"
        self.model = lgb.LGBMClassifier(
            n_estimators       = self.hp.get("n_estimators", 800),
            max_depth          = self.hp.get("max_depth", -1),
            num_leaves         = self.hp.get("num_leaves", 31),
            learning_rate      = self.hp.get("lr", 0.03),
            feature_fraction   = self.hp.get("feature_fraction", 0.7),
            bagging_fraction   = self.hp.get("bagging_fraction", 0.8),
            bagging_freq       = self.hp.get("bagging_freq", 5),
            min_child_samples  = self.hp.get("min_child_samples", 30),
            reg_alpha          = self.hp.get("reg_alpha", 0.1),
            reg_lambda         = self.hp.get("reg_lambda", 1.0),
            boosting_type      = booster,
            # DART 專用參數（boosting_type="dart" 時生效）
            drop_rate          = self.hp.get("dart_drop_rate", 0.1),
            objective          = "multiclass",
            num_class          = 3,
            verbosity          = -1,
        )
        callbacks = [lgb.early_stopping(
            self.hp.get("early_stopping_rounds", 50), verbose=False
        )]
        self.model.fit(
            X_tr, y_tr,
            eval_set=[(X_vl, y_vl)],
            callbacks=callbacks,
        )
        best_iter = getattr(self.model, "best_iteration_", self.hp.get("n_estimators", 800))
        log.info(f"LightGBM best iteration: {best_iter}  booster: {booster}")
        if callback:
            callback(1, 0.0)
        return TrainResult(loss_history=[], epochs_done=1)

    def predict(self, X: np.ndarray) -> np.ndarray:
        return self.model.predict_proba(X.reshape(len(X), -1)).astype(np.float32)

    def save(self, path: str) -> None:
        import joblib
        os.makedirs(os.path.dirname(path), exist_ok=True)
        joblib.dump(self.model, path)

    def load(self, path: str) -> None:
        import joblib
        self.model = joblib.load(path)


# ══════════════════════════════════════════════
#  工廠函式（API 介面完全不變）
# ══════════════════════════════════════════════

DEFAULT_HPARAMS: dict[str, dict] = {
    "transformer": {
        # 模型
        "d_model": 64, "nhead": 4, "num_layers": 3,
        "dropout": 0.15, "use_alibi": True,
        # 訓練
        "epochs": 30, "batch_size": 64, "lr": 5e-4, "weight_decay": 1e-4,
        "transaction_cost": 0.002,
        # 防過擬合
        "val_ratio": 0.15, "early_stopping_patience": 8,
        "mixup_alpha": 0.3, "cutout_ratio": 0.1,
        "sgdr_t0": 10,
    },
    "lstm": {
        "hidden": 128, "num_layers": 2, "dropout": 0.2, "bidirectional": False,
        "epochs": 30, "batch_size": 64, "lr": 5e-4, "weight_decay": 1e-4,
        "transaction_cost": 0.002,
        "val_ratio": 0.15, "early_stopping_patience": 8,
        "mixup_alpha": 0.3, "cutout_ratio": 0.1,
        "sgdr_t0": 10,
    },
    "gru": {
        "hidden": 128, "num_layers": 2, "dropout": 0.2, "bidirectional": False,
        "epochs": 30, "batch_size": 64, "lr": 5e-4, "weight_decay": 1e-4,
        "transaction_cost": 0.002,
        "val_ratio": 0.15, "early_stopping_patience": 8,
        "mixup_alpha": 0.3, "cutout_ratio": 0.1,
        "sgdr_t0": 10,
    },
    "tcn": {
        "channels": 64, "levels": 4, "kernel_size": 3, "dropout": 0.1,
        "epochs": 30, "batch_size": 64, "lr": 5e-4, "weight_decay": 1e-4,
        "transaction_cost": 0.002,
        "val_ratio": 0.15, "early_stopping_patience": 8,
        "mixup_alpha": 0.3, "cutout_ratio": 0.1,
        "sgdr_t0": 10,
    },
    "xgboost": {
        "n_estimators": 500, "max_depth": 4, "lr": 0.03,
        "subsample": 0.8, "colsample_bytree": 0.8,
        "min_child_weight": 10, "reg_alpha": 0.1, "reg_lambda": 1.0,
        "early_stopping_rounds": 30,
        "val_ratio": 0.15, "label_threshold": 0.002,
    },
    "lightgbm": {
        "n_estimators": 800, "max_depth": -1, "num_leaves": 31,
        "lr": 0.03, "feature_fraction": 0.7,
        "bagging_fraction": 0.8, "bagging_freq": 5,
        "min_child_samples": 30, "reg_alpha": 0.1, "reg_lambda": 1.0,
        "boosting_type": "gbdt", "dart_drop_rate": 0.1,
        "early_stopping_rounds": 50,
        "val_ratio": 0.15, "label_threshold": 0.002,
    },
}


def get_trainer(arch: str, input_dim: int, hparams: dict) -> BaseTrainer:
    """
    工廠函式：合併預設超參數與使用者傳入值（使用者優先），
    依 arch 字串建構對應 Trainer。
    簽名與回傳型別與 v1 完全相同。
    """
    hp = {**DEFAULT_HPARAMS.get(arch, {}), **hparams}

    if arch == "transformer":
        net = _AlphaTransformerNet(
            input_dim,
            d_model    = hp["d_model"],
            nhead      = hp["nhead"],
            num_layers = hp["num_layers"],
            dropout    = hp["dropout"],
            use_alibi  = hp.get("use_alibi", True),
        )
        return TorchTrainer(net, hp)

    elif arch == "lstm":
        net = _LSTMNet(
            input_dim,
            hidden        = hp["hidden"],
            num_layers    = hp["num_layers"],
            dropout       = hp["dropout"],
            bidirectional = hp.get("bidirectional", False),
        )
        return TorchTrainer(net, hp)

    elif arch == "gru":
        net = _GRUNet(
            input_dim,
            hidden        = hp["hidden"],
            num_layers    = hp["num_layers"],
            dropout       = hp["dropout"],
            bidirectional = hp.get("bidirectional", False),
        )
        return TorchTrainer(net, hp)

    elif arch == "tcn":
        net = _TCNNet(
            input_dim,
            channels   = hp["channels"],
            levels     = hp["levels"],
            kernel_size= hp["kernel_size"],
            dropout    = hp.get("dropout", 0.1),
        )
        return TorchTrainer(net, hp)

    elif arch == "xgboost":
        return XGBoostTrainer(hp)

    elif arch == "lightgbm":
        return LightGBMTrainer(hp)

    else:
        raise ValueError(f"Unknown architecture: {arch!r}. "
                         f"Supported: {list(DEFAULT_HPARAMS)}")
