import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import toast from "react-hot-toast";
import { api } from "../api/client";

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function ProbStrip({ label, value, color }) {
  const percent = (Number(value || 0) * 100).toFixed(1);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12 }}>
        <span style={{ color: "#94a3b8" }}>{label}</span>
        <span style={{ color, fontWeight: 800, fontFamily: "'JetBrains Mono',monospace" }}>{percent}%</span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
        <div style={{ width: `${percent}%`, height: "100%", background: color }} />
      </div>
    </div>
  );
}

export default function LiveTradingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ date_start: "2020-01-01", date_end: yesterday() });

  const { data: deployment, isLoading } = useQuery({
    queryKey: ["live-deployment", id],
    queryFn: () => api.get(`/live-deployments/${id}/`).then(r => r.data),
    refetchInterval: 5000,
  });

  const { data: feedback } = useQuery({
    queryKey: ["live-feedback", id],
    queryFn: () => api.get(`/live-deployments/${id}/feedback/`).then(r => r.data),
    enabled: Boolean(id),
    refetchInterval: 8000,
  });

  const launchRun = useMutation({
    mutationFn: body => api.post(`/live-deployments/${id}/run/`, body),
    onSuccess: res => {
      queryClient.invalidateQueries({ queryKey: ["live-deployment", id] });
      toast.success("實戰任務已送出");
      navigate(`/live-run/${res.data.live_run_id}/status`);
    },
    onError: err => {
      toast.error(err?.response?.data?.error || "啟動實戰任務失敗");
    },
  });

  useEffect(() => {
    if (!deployment) return;
    setForm({
      date_start: deployment.date_start || "2020-01-01",
      date_end: deployment.date_end || yesterday(),
    });
  }, [deployment]);

  if (isLoading || !deployment) {
    return <div style={{ color: "#94a3b8" }}>讀取實戰部署中...</div>;
  }

  const latest = deployment.latest_run;
  const feedbackItems = feedback?.items || [];
  const wrongMarkers = feedbackItems
    .filter(item => !item.was_correct)
    .map(item => ({ date: item.target_date, value: item.cumulative_pnl }));

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
        <div>
          <h1 style={{ color: "#f8fafc", fontSize: 28, marginBottom: 6 }}>{deployment.name}</h1>
          <p style={{ color: "#94a3b8" }}>
            這裡會沿用研究回測成功的模型、特徵與超參數，只更新新的訓練日期區間來做實戰預測。
          </p>
        </div>
        <Link to="/" style={{ color: "#93c5fd", textDecoration: "none" }}>回 Dashboard</Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 16, marginBottom: 18 }}>
        <div style={{ background: "#131929", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, padding: 22 }}>
          <h2 style={{ color: "#f8fafc", marginBottom: 14 }}>實戰設定</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>
            <input className="input-dark" value={form.date_start} type="date" onChange={e => setForm(curr => ({ ...curr, date_start: e.target.value }))} />
            <input className="input-dark" value={form.date_end} type="date" onChange={e => setForm(curr => ({ ...curr, date_end: e.target.value }))} />
          </div>
          <div style={{ marginTop: 14, color: "#cbd5e1", lineHeight: 1.8 }}>
            <div>模型：{deployment.model_arch.display_name}</div>
            <div>股票：{deployment.ticker} / 基準：{deployment.benchmark}</div>
            <div>特徵數：{deployment.feature_ids?.length || 0}</div>
            <div>Random Seed：{deployment.random_seed}</div>
          </div>
          <button
            type="button"
            onClick={() => launchRun.mutate(form)}
            disabled={launchRun.isPending}
            style={{ marginTop: 18, padding: "12px 16px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#059669,#047857)", color: "#fff", fontWeight: 800, cursor: "pointer" }}
          >
            {launchRun.isPending ? "送出中..." : "使用最新資料投入實戰"}
          </button>
        </div>

        <div style={{ background: "#131929", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, padding: 22 }}>
          <h2 style={{ color: "#f8fafc", marginBottom: 14 }}>最新實戰建議</h2>
          {!latest?.signal ? (
            <div style={{ color: "#94a3b8" }}>尚未產生實戰訊號。</div>
          ) : (
            <>
              <div style={{ fontSize: 22, color: "#6ee7b7", fontWeight: 900, marginBottom: 10 }}>{latest.signal}</div>
              <div style={{ color: "#cbd5e1", lineHeight: 1.8, marginBottom: 16 }}>
                基於 {latest.training_window_start} 到 {latest.training_window_end} 的數據，明日模型操作建議為：{latest.signal}
              </div>
              <Link to={`/live-run/${latest.id}/status`} style={{ color: "#93c5fd", textDecoration: "none" }}>查看任務狀態</Link>
            </>
          )}
        </div>
      </div>

      {latest?.signal && (
        <div style={{ background: "#131929", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, padding: 22, marginBottom: 18 }}>
          <h2 style={{ color: "#f8fafc", marginBottom: 12 }}>明日操作建議</h2>
          <p style={{ color: "#e2e8f0", marginBottom: 16 }}>
            基於 {latest.training_window_start || deployment.date_start} 到 {latest.training_window_end || deployment.date_end} 的數據，明日模型操作建議為：<strong>{latest.signal}</strong>
          </p>
          <ProbStrip label="LONG" value={latest.prob_long || 0} color="#f87171" />
          <ProbStrip label="NEUTRAL" value={latest.prob_neutral || 0} color="#94a3b8" />
          <ProbStrip label="SHORT" value={latest.prob_short || 0} color="#34d399" />
        </div>
      )}

      <div style={{ background: "#131929", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, padding: 22 }}>
        <h2 style={{ color: "#f8fafc", marginBottom: 14 }}>模型表現檢討區</h2>
        {feedbackItems.length === 0 ? (
          <div style={{ color: "#94a3b8" }}>目前還沒有可檢討的實戰結果，等最新實際行情入庫後會自動補上。</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12, marginBottom: 18 }}>
              <StatBox label="最新成功率" value={`${((feedback.summary?.latest_hit_rate || 0) * 100).toFixed(1)}%`} tone="#6ee7b7" />
              <StatBox label="累積損益" value={`${((feedback.summary?.latest_cumulative_pnl || 0) * 100).toFixed(2)}%`} tone="#93c5fd" />
              <StatBox label="Alpha Drift" value={`${((feedback.summary?.latest_alpha_drift || 0) * 100).toFixed(2)}%`} tone="#fbbf24" />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <div style={{ color: "#cbd5e1", marginBottom: 10 }}>預測成功率</div>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={feedbackItems}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="target_date" tick={{ fill: "#64748b", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#64748b", fontSize: 10 }} tickFormatter={v => `${(v * 100).toFixed(0)}%`} />
                    <Tooltip />
                    <Line dataKey="hit_rate" stroke="#60a5fa" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div>
                <div style={{ color: "#cbd5e1", marginBottom: 10 }}>累積損益曲線</div>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={feedbackItems}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="target_date" tick={{ fill: "#64748b", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#64748b", fontSize: 10 }} tickFormatter={v => `${(v * 100).toFixed(1)}%`} />
                    <Tooltip />
                    <Area dataKey="cumulative_pnl" stroke="#34d399" fill="rgba(52,211,153,0.18)" />
                    {wrongMarkers.map(item => (
                      <ReferenceDot key={item.date} x={item.date} y={item.value} r={4} fill="#f87171" stroke="none" />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, tone }) {
  return (
    <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)" }}>
      <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>{label}</div>
      <div style={{ color: tone, fontSize: 20, fontWeight: 800 }}>{value}</div>
    </div>
  );
}
