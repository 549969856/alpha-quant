import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import toast from "react-hot-toast";
import { api } from "../api/client";

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function fmtDate(value, withTime = false) {
  if (!value) return "-";
  return new Date(value).toLocaleString(
    "zh-TW",
    withTime
      ? { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
      : { year: "numeric", month: "2-digit", day: "2-digit" },
  );
}

function pct(value, digits = 2) {
  if (value == null) return "-";
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

function ProbStrip({ label, value, color }) {
  const percent = Number(value || 0) * 100;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12 }}>
        <span style={{ color: "#94a3b8" }}>{label}</span>
        <span style={{ color, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace" }}>{percent.toFixed(1)}%</span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
        <div style={{ width: `${Math.max(0, Math.min(percent, 100))}%`, height: "100%", background: color }} />
      </div>
    </div>
  );
}

function StatBox({ label, value, tone = "#f8fafc" }) {
  return (
    <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>{label}</div>
      <div style={{ color: tone, fontSize: 20, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

function ParameterCard({ label, value, hint, tone = "#e2e8f0" }) {
  return (
    <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>{label}</div>
      <div style={{ color: tone, fontSize: 18, fontWeight: 800, marginBottom: hint ? 6 : 0 }}>{value}</div>
      {hint ? <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.6 }}>{hint}</div> : null}
    </div>
  );
}

function FeaturePill({ label, fallback = false }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "8px 10px",
        borderRadius: 999,
        border: fallback ? "1px solid rgba(251,191,36,0.25)" : "1px solid rgba(59,130,246,0.18)",
        background: fallback ? "rgba(251,191,36,0.08)" : "rgba(59,130,246,0.08)",
        color: fallback ? "#fde68a" : "#bfdbfe",
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {label}
    </span>
  );
}

function wrongPredictionDot(props) {
  const { cx, cy, payload } = props;
  if (payload?.was_correct === false) {
    return <circle cx={cx} cy={cy} r={5} fill="#ef4444" stroke="#fee2e2" strokeWidth={2} />;
  }
  return <circle cx={cx} cy={cy} r={3} fill="#60a5fa" />;
}

function wrongPredictionAreaDot(props) {
  const { cx, cy, payload } = props;
  if (payload?.was_correct === false) {
    return <circle cx={cx} cy={cy} r={5} fill="#ef4444" stroke="#fee2e2" strokeWidth={2} />;
  }
  return <circle cx={cx} cy={cy} r={3} fill="#34d399" />;
}

const HPARAM_META = {
  lr: { label: "學習率", format: value => Number(value).toLocaleString("zh-TW", { maximumSignificantDigits: 3 }), hint: "控制每次權重更新幅度，越小越穩定。" },
  epochs: { label: "訓練輪數", format: value => `${value} 輪`, hint: "模型完整看過資料的次數。" },
  batch_size: { label: "批次大小", format: value => `${value} 筆`, hint: "每次訓練送入模型的樣本數。" },
  seq_length: { label: "觀察天數", format: value => `${value} 天`, hint: "每次預測前回看多少交易日。" },
  transaction_cost: { label: "交易成本", format: value => pct(value), hint: "模擬手續費與滑價對績效的影響。" },
  confidence_threshold: { label: "信心門檻", format: value => `${(Number(value) * 100).toFixed(0)}%`, hint: "舊版決策保留的信號門檻參考值。" },
  directional_threshold: { label: "方向差門檻", format: value => `${(Number(value) * 100).toFixed(0)}%`, hint: "做多與做空機率差距至少達到這個值才進場。" },
  dropout: { label: "Dropout", format: value => `${(Number(value) * 100).toFixed(0)}%`, hint: "降低過擬合的隨機失活比例。" },
  d_model: { label: "模型寬度", format: value => `${value}`, hint: "Transformer 內部向量維度。" },
  nhead: { label: "注意力頭數", format: value => `${value} 頭`, hint: "同時觀察不同時序關聯的子空間數量。" },
  num_layers: { label: "模型層數", format: value => `${value} 層`, hint: "堆疊的編碼層數量。" },
  train_ratio: { label: "訓練比例", format: value => `${(Number(value) * 100).toFixed(0)}%`, hint: "保留給模型學習的資料比例。" },
};

function formatHparamValue(key, value) {
  if (value == null) return "-";
  const formatter = HPARAM_META[key]?.format;
  if (formatter) return formatter(value);
  if (typeof value === "number") return Number(value).toLocaleString("zh-TW");
  return String(value);
}

export default function LiveTradingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    date_start: "2020-01-01",
    date_end: yesterday(),
    auto_predict_enabled: false,
    auto_predict_time: "18:10",
  });

  const { data: deployment, isLoading } = useQuery({
    queryKey: ["live-deployment", id],
    queryFn: () => api.get(`/live-deployments/${id}/`).then(res => res.data),
    enabled: Boolean(id),
    refetchInterval: 5000,
  });

  const { data: feedback } = useQuery({
    queryKey: ["live-feedback", id],
    queryFn: () => api.get(`/live-deployments/${id}/feedback/`).then(res => res.data),
    enabled: Boolean(id),
    refetchInterval: 8000,
  });

  const { data: featureCatalog = {} } = useQuery({
    queryKey: ["features"],
    queryFn: () => api.get("/features/").then(res => res.data),
    staleTime: 60_000,
  });

  const updateDeployment = useMutation({
    mutationFn: body => api.patch(`/live-deployments/${id}/`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["live-deployment", id] });
      queryClient.invalidateQueries({ queryKey: ["live-deployments"] });
      toast.success("實戰部署設定已更新");
    },
    onError: err => toast.error(err?.response?.data?.error || "更新實戰部署失敗"),
  });

  const launchRun = useMutation({
    mutationFn: body => api.post(`/live-deployments/${id}/run/`, body),
    onSuccess: res => {
      queryClient.invalidateQueries({ queryKey: ["live-deployment", id] });
      queryClient.invalidateQueries({ queryKey: ["live-deployments"] });
      toast.success("實戰訓練已開始");
      navigate(`/live-run/${res.data.live_run_id}/status`);
    },
    onError: err => {
      if (err?.response?.status === 409 && err?.response?.data?.live_run_id) {
        toast("今天已經有一筆實戰任務，帶你前往狀態頁。");
        navigate(`/live-run/${err.response.data.live_run_id}/status`);
        return;
      }
      toast.error(err?.response?.data?.error || "啟動實戰訓練失敗");
    },
  });

  useEffect(() => {
    if (!deployment) return;
    setForm({
      date_start: deployment.date_start || "2020-01-01",
      date_end: deployment.date_end || yesterday(),
      auto_predict_enabled: Boolean(deployment.auto_predict_enabled),
      auto_predict_time: deployment.auto_predict_time?.slice(0, 5) || "18:10",
    });
  }, [deployment]);

  const latest = deployment?.latest_run;
  const feedbackItems = feedback?.items || [];

  const sortedFeedback = useMemo(
    () => [...feedbackItems].sort((a, b) => new Date(a.target_date) - new Date(b.target_date)),
    [feedbackItems],
  );

  const featureMap = useMemo(() => {
    const map = new Map();
    Object.values(featureCatalog).flat().forEach(feature => {
      map.set(String(feature.id), feature.display_name || feature.name || String(feature.id));
    });
    return map;
  }, [featureCatalog]);

  const resolvedFeatures = useMemo(() => {
    return (deployment?.feature_ids || []).map(idValue => {
      const idKey = String(idValue);
      const name = featureMap.get(idKey);
      return {
        id: idKey,
        label: name || idKey,
        fallback: !name,
      };
    });
  }, [deployment?.feature_ids, featureMap]);

  const parameterCards = useMemo(() => {
    const hparams = deployment?.hparams || {};
    return Object.entries(hparams).map(([key, value]) => ({
      key,
      label: HPARAM_META[key]?.label || key,
      value: formatHparamValue(key, value),
      hint: HPARAM_META[key]?.hint || "目前部署沿用的模型設定值。",
    }));
  }, [deployment?.hparams]);

  if (isLoading || !deployment) {
    return <div style={{ color: "#94a3b8" }}>載入實戰部署中...</div>;
  }

  return (
    <div style={{ maxWidth: 1200 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22, gap: 12 }}>
        <div>
          <h1 style={{ color: "#f8fafc", fontSize: 28, marginBottom: 6 }}>{deployment.name}</h1>
          <p style={{ color: "#94a3b8", lineHeight: 1.7, margin: 0 }}>
            這裡會顯示實戰部署的最新訓練區間、明日操作建議、實戰模型訓練參數，以及上線後的 feedback 與模型檢討。
          </p>
        </div>
        <Link to="/" style={{ color: "#93c5fd", textDecoration: "none" }}>返回 Dashboard</Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12, marginBottom: 18 }}>
        <StatBox label="部署狀態" value={deployment.status} tone={deployment.status === "ready" ? "#6ee7b7" : deployment.status === "failed" ? "#fca5a5" : "#93c5fd"} />
        <StatBox
          label="今日任務"
          value={deployment.today_prediction_done ? "已完成" : deployment.today_prediction_in_progress ? "進行中" : "尚未執行"}
          tone={deployment.today_prediction_done ? "#6ee7b7" : deployment.today_prediction_in_progress ? "#fbbf24" : "#94a3b8"}
        />
        <StatBox label="下次排程" value={deployment.next_run_at ? fmtDate(deployment.next_run_at, true) : "-"} tone="#fbbf24" />
        <StatBox label="最新信心度" value={latest?.confidence != null ? `${Number(latest.confidence).toFixed(1)}%` : "-"} tone="#93c5fd" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 16, marginBottom: 18 }}>
        <div style={{ background: "#131929", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, padding: 22 }}>
          <h2 style={{ color: "#f8fafc", marginBottom: 14 }}>實戰設定</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>
            <div>
              <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 6 }}>訓練起始日</div>
              <input className="input-dark" value={form.date_start} type="date" onChange={e => setForm(curr => ({ ...curr, date_start: e.target.value }))} />
            </div>
            <div>
              <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 6 }}>訓練結束日</div>
              <input className="input-dark" value={form.date_end} type="date" onChange={e => setForm(curr => ({ ...curr, date_end: e.target.value }))} />
            </div>
            <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div>
                  <div style={{ color: "#f8fafc", fontWeight: 700 }}>自動預測</div>
                  <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>開啟後會在指定時間自動建立當日 live run。</div>
                </div>
                <input type="checkbox" checked={form.auto_predict_enabled} onChange={e => setForm(curr => ({ ...curr, auto_predict_enabled: e.target.checked }))} />
              </div>
            </div>
            <div>
              <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 6 }}>自動預測時間</div>
              <input className="input-dark" value={form.auto_predict_time} type="time" onChange={e => setForm(curr => ({ ...curr, auto_predict_time: e.target.value }))} disabled={!form.auto_predict_enabled} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
            <button
              type="button"
              onClick={() => launchRun.mutate({ date_start: form.date_start, date_end: form.date_end || yesterday() })}
              disabled={launchRun.isPending || deployment.today_prediction_done || deployment.today_prediction_in_progress}
              style={{
                padding: "12px 16px",
                borderRadius: 10,
                border: "none",
                background: "linear-gradient(135deg,#059669,#047857)",
                color: "#fff",
                fontWeight: 800,
                cursor: "pointer",
                opacity: launchRun.isPending || deployment.today_prediction_done || deployment.today_prediction_in_progress ? 0.6 : 1,
              }}
            >
              {launchRun.isPending
                ? "啟動中..."
                : deployment.today_prediction_done
                  ? "今日已完成"
                  : deployment.today_prediction_in_progress
                    ? "今日任務進行中"
                    : "啟動明日預測"}
            </button>
            <button
              type="button"
              onClick={() => updateDeployment.mutate({
                date_start: form.date_start,
                date_end: form.date_end,
                auto_predict_enabled: form.auto_predict_enabled,
                auto_predict_time: `${form.auto_predict_time}:00`,
              })}
              disabled={updateDeployment.isPending}
              style={{ padding: "12px 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", color: "#e2e8f0", fontWeight: 700, cursor: "pointer" }}
            >
              {updateDeployment.isPending ? "儲存中..." : "儲存設定"}
            </button>
          </div>

          <div style={{ color: "#cbd5e1", lineHeight: 1.8, marginTop: 16, fontSize: 13 }}>
            <div>模型架構：{deployment.model_arch.display_name}</div>
            <div>市場標的：{deployment.ticker} / 基準：{deployment.benchmark}</div>
            <div>自動預測：{deployment.auto_predict_enabled ? `開啟，每天 ${form.auto_predict_time}` : "未啟用"}</div>
            <div>下次排程：{deployment.next_run_at ? fmtDate(deployment.next_run_at, true) : "-"}</div>
          </div>
        </div>

        <div style={{ background: "#131929", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, padding: 22 }}>
          <h2 style={{ color: "#f8fafc", marginBottom: 14 }}>最新明日建議</h2>
          {!latest?.signal ? (
            <div style={{ color: "#94a3b8" }}>目前還沒有完成的 live prediction。</div>
          ) : (
            <>
              <div style={{ fontSize: 24, color: latest.signal === "LONG" ? "#f87171" : latest.signal === "SHORT" ? "#34d399" : "#f8fafc", fontWeight: 900, marginBottom: 8 }}>
                {latest.signal}
              </div>
              <div style={{ color: "#cbd5e1", lineHeight: 1.8, marginBottom: 14 }}>
                基於 {latest.training_window_start || deployment.date_start} 到 {latest.training_window_end || deployment.date_end} 的資料，明日模型操作建議為：{latest.signal}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10, marginBottom: 14 }}>
                <StatBox label="訓練資料區間" value={`${latest.training_window_start || "-"} -> ${latest.training_window_end || "-"}`} tone="#e2e8f0" />
                <StatBox label="風險控管" value={`SL ${pct((latest.stop_loss_pct || 0) / 100)} / TP ${pct((latest.target_pct || 0) / 100)}`} tone="#fbbf24" />
              </div>
              <ProbStrip label="LONG" value={latest.prob_long || 0} color="#f87171" />
              <ProbStrip label="NEUTRAL" value={latest.prob_neutral || 0} color="#94a3b8" />
              <ProbStrip label="SHORT" value={latest.prob_short || 0} color="#34d399" />
              <div style={{ marginTop: 12 }}>
                <Link to={`/live-run/${latest.id}/status`} style={{ color: "#93c5fd", textDecoration: "none" }}>查看這筆實戰任務</Link>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ background: "#131929", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, padding: 22, marginBottom: 18 }}>
        <h2 style={{ color: "#f8fafc", marginBottom: 14 }}>這個實戰模型使用的訓練參數</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12, marginBottom: 14 }}>
          <StatBox label="模型架構" value={deployment.model_arch?.display_name || "-"} tone="#93c5fd" />
          <StatBox label="Random Seed" value={deployment.random_seed ?? "-"} />
          <StatBox label="訓練資料區間" value={`${deployment.date_start || "-"} -> ${deployment.date_end || "-"}`} />
          <StatBox label="特徵數" value={deployment.feature_ids?.length || 0} tone="#6ee7b7" />
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 10 }}>特徵清單</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {resolvedFeatures.length === 0 ? (
              <span style={{ color: "#94a3b8" }}>這個實戰部署目前沒有綁定特徵。</span>
            ) : (
              resolvedFeatures.map(feature => (
                <FeaturePill key={feature.id} label={feature.label} fallback={feature.fallback} />
              ))
            )}
          </div>
          {resolvedFeatures.some(feature => feature.fallback) && (
            <div style={{ color: "#fbbf24", fontSize: 12, marginTop: 10 }}>
              有些特徵 ID 在目前的特徵目錄中找不到對應名稱，先以原始 ID 顯示。
            </div>
          )}
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 10 }}>模型設定摘要</div>
          <div style={{ color: "#cbd5e1", lineHeight: 1.8, marginBottom: 14, fontSize: 13 }}>
            這裡顯示的是這個實戰部署目前沿用的訓練設定，方便快速理解模型是用什麼節奏、成本假設與網路規模在產生明日訊號。
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12 }}>
          {parameterCards.length === 0 ? (
            <div style={{ color: "#94a3b8" }}>目前沒有可顯示的模型設定。</div>
          ) : (
            parameterCards.map(item => (
              <ParameterCard key={item.key} label={item.label} value={item.value} hint={item.hint} />
            ))
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 18 }}>
        <div style={{ background: "#131929", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, padding: 22 }}>
          <h2 style={{ color: "#f8fafc", marginBottom: 14 }}>最近的 Live Runs</h2>
          {!deployment.runs?.length ? (
            <div style={{ color: "#94a3b8" }}>目前還沒有任何 live run。</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {deployment.runs.map(run => (
                <div key={run.id} style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                    <div style={{ color: "#f8fafc", fontWeight: 700 }}>{run.signal || run.status}</div>
                    <div style={{ color: "#94a3b8", fontSize: 12 }}>{fmtDate(run.created_at, true)}</div>
                  </div>
                  <div style={{ color: "#cbd5e1", fontSize: 12, lineHeight: 1.7 }}>
                    <div>訓練區間：{run.training_window_start || "-"} {"->"} {run.training_window_end || "-"}</div>
                    <div>目標日期：{run.target_date || "-"}</div>
                    <div>信心度：{run.confidence != null ? `${Number(run.confidence).toFixed(1)}%` : "-"}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ background: "#131929", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, padding: 22 }}>
          <h2 style={{ color: "#f8fafc", marginBottom: 14 }}>Feedback 與模型檢討</h2>
          {sortedFeedback.length === 0 ? (
            <div style={{ color: "#94a3b8", lineHeight: 1.8 }}>
              <div>目前還沒有可用的 feedback 資料。</div>
              {feedback?.summary?.pending_reason && (
                <div style={{ marginTop: 8, color: "#cbd5e1" }}>原因：{feedback.summary.pending_reason}</div>
              )}
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12, marginBottom: 18 }}>
                <StatBox label="最新成功率" value={`${((feedback.summary?.latest_hit_rate || 0) * 100).toFixed(1)}%`} tone="#6ee7b7" />
                <StatBox label="累積損益" value={`${((feedback.summary?.latest_cumulative_pnl || 0) * 100).toFixed(2)}%`} tone="#93c5fd" />
                <StatBox label="Alpha Drift" value={`${((feedback.summary?.latest_alpha_drift || 0) * 100).toFixed(2)}%`} tone="#fbbf24" />
              </div>

              <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 12 }}>
                圖表上的紅點代表該日期的預測方向錯誤，方便快速檢查模型失手區段。
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
                <div>
                  <div style={{ color: "#cbd5e1", marginBottom: 10 }}>預測成功率</div>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={sortedFeedback}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="target_date" tick={{ fill: "#64748b", fontSize: 10 }} />
                      <YAxis tick={{ fill: "#64748b", fontSize: 10 }} tickFormatter={value => `${(value * 100).toFixed(0)}%`} />
                      <Tooltip formatter={value => pct(value)} />
                      <Line dataKey="hit_rate" stroke="#60a5fa" strokeWidth={2} dot={wrongPredictionDot} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div>
                  <div style={{ color: "#cbd5e1", marginBottom: 10 }}>累積損益曲線</div>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={sortedFeedback}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="target_date" tick={{ fill: "#64748b", fontSize: 10 }} />
                      <YAxis tick={{ fill: "#64748b", fontSize: 10 }} tickFormatter={value => `${(value * 100).toFixed(1)}%`} />
                      <Tooltip formatter={value => pct(value)} />
                      <Area dataKey="cumulative_pnl" stroke="#34d399" fill="rgba(52,211,153,0.18)" dot={wrongPredictionAreaDot} activeDot={{ r: 6 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
