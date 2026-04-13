import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import toast from "react-hot-toast";
import { api } from "../api/client";

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function fmtDate(value, withTime = false) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-TW", withTime ? {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  } : {
    year: "numeric", month: "2-digit", day: "2-digit",
  });
}

function pct(value, digits = 2) {
  if (value == null) return "-";
  return `${(Number(value) * 100).toFixed(digits)}%`;
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

function StatBox({ label, value, tone }) {
  return (
    <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>{label}</div>
      <div style={{ color: tone, fontSize: 20, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

export default function LiveTradingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ date_start: "2020-01-01", date_end: yesterday(), auto_predict_enabled: false, auto_predict_time: "18:10" });

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

  const updateDeployment = useMutation({
    mutationFn: body => api.patch(`/live-deployments/${id}/`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["live-deployment", id] });
      queryClient.invalidateQueries({ queryKey: ["live-deployments"] });
      toast.success("實戰設定已更新");
    },
    onError: err => toast.error(err?.response?.data?.error || "更新實戰設定失敗"),
  });

  const launchRun = useMutation({
    mutationFn: body => api.post(`/live-deployments/${id}/run/`, body),
    onSuccess: res => {
      queryClient.invalidateQueries({ queryKey: ["live-deployment", id] });
      queryClient.invalidateQueries({ queryKey: ["live-deployments"] });
      toast.success("實戰任務已送出");
      navigate(`/live-run/${res.data.live_run_id}/status`);
    },
    onError: err => {
      if (err?.response?.status === 409 && err?.response?.data?.live_run_id) {
        toast("今天已經預測過，帶你查看現有任務");
        navigate(`/live-run/${err.response.data.live_run_id}/status`);
        return;
      }
      toast.error(err?.response?.data?.error || "啟動實戰任務失敗");
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
  const sortedFeedback = useMemo(() => [...feedbackItems].sort((a, b) => new Date(a.target_date) - new Date(b.target_date)), [feedbackItems]);

  if (isLoading || !deployment) {
    return <div style={{ color: "#94a3b8" }}>讀取實戰部署中...</div>;
  }

  return (
    <div style={{ maxWidth: 1200 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22, gap: 12 }}>
        <div>
          <h1 style={{ color: "#f8fafc", fontSize: 28, marginBottom: 6 }}>{deployment.name}</h1>
          <p style={{ color: "#94a3b8" }}>
            實戰模式會用目前 deployment 指定的完整資料區間重訓模型，並直接輸出明日操作建議。
          </p>
        </div>
        <Link to="/live" style={{ color: "#93c5fd", textDecoration: "none" }}>返回實戰部署</Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12, marginBottom: 18 }}>
        <StatBox label="部署狀態" value={deployment.status} tone={deployment.status === "ready" ? "#6ee7b7" : deployment.status === "failed" ? "#fca5a5" : "#93c5fd"} />
        <StatBox label="今日預測" value={deployment.today_prediction_done ? "已完成" : deployment.today_prediction_in_progress ? "進行中" : "未執行"} tone={deployment.today_prediction_done ? "#6ee7b7" : deployment.today_prediction_in_progress ? "#fbbf24" : "#94a3b8"} />
        <StatBox label="下次排程" value={deployment.next_run_at ? fmtDate(deployment.next_run_at, true) : "未啟用"} tone="#fbbf24" />
        <StatBox label="最後信心度" value={latest?.confidence != null ? `${Number(latest.confidence).toFixed(1)}%` : "-"} tone="#93c5fd" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 16, marginBottom: 18 }}>
        <div style={{ background: "#131929", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, padding: 22 }}>
          <h2 style={{ color: "#f8fafc", marginBottom: 14 }}>一鍵預測與自動化設定</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>
            <div>
              <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 6 }}>訓練資料開始日</div>
              <input className="input-dark" value={form.date_start} type="date" onChange={e => setForm(curr => ({ ...curr, date_start: e.target.value }))} />
            </div>
            <div>
              <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 6 }}>訓練資料結束日</div>
              <input className="input-dark" value={form.date_end} type="date" onChange={e => setForm(curr => ({ ...curr, date_end: e.target.value }))} />
            </div>
            <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ color: "#f8fafc", fontWeight: 700 }}>每天自動預測</div>
                  <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>到點後自動用最新資料跑明日訊號</div>
                </div>
                <input type="checkbox" checked={form.auto_predict_enabled} onChange={e => setForm(curr => ({ ...curr, auto_predict_enabled: e.target.checked }))} />
              </div>
            </div>
            <div>
              <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 6 }}>每日自動預測時間</div>
              <input className="input-dark" value={form.auto_predict_time} type="time" onChange={e => setForm(curr => ({ ...curr, auto_predict_time: e.target.value }))} disabled={!form.auto_predict_enabled} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
            <button
              type="button"
              onClick={() => launchRun.mutate({ date_start: form.date_start, date_end: yesterday() })}
              disabled={launchRun.isPending || deployment.today_prediction_done || deployment.today_prediction_in_progress}
              style={{ padding: "12px 16px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#059669,#047857)", color: "#fff", fontWeight: 800, cursor: "pointer", opacity: deployment.today_prediction_done || deployment.today_prediction_in_progress ? 0.6 : 1 }}
            >
              {launchRun.isPending ? "送出中..." : deployment.today_prediction_done ? "今天已完成預測" : deployment.today_prediction_in_progress ? "今天預測進行中" : "使用最新資料預測明日"}
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
              {updateDeployment.isPending ? "儲存中..." : "儲存排程設定"}
            </button>
          </div>

          <div style={{ color: "#cbd5e1", lineHeight: 1.8, marginTop: 16, fontSize: 13 }}>
            <div>模型：{deployment.model_arch.display_name}</div>
            <div>股票：{deployment.ticker} / 基準：{deployment.benchmark}</div>
            <div>排程狀態：{deployment.auto_predict_enabled ? `已啟用，每天 ${form.auto_predict_time}` : "未啟用"}</div>
            <div>下次執行時間：{deployment.next_run_at ? fmtDate(deployment.next_run_at, true) : "未設定"}</div>
          </div>
        </div>

        <div style={{ background: "#131929", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, padding: 22 }}>
          <h2 style={{ color: "#f8fafc", marginBottom: 14 }}>最新實戰建議</h2>
          {!latest?.signal ? (
            <div style={{ color: "#94a3b8" }}>尚未產生實戰訊號。</div>
          ) : (
            <>
              <div style={{ fontSize: 24, color: latest.signal === "LONG" ? "#f87171" : latest.signal === "SHORT" ? "#34d399" : "#f8fafc", fontWeight: 900, marginBottom: 8 }}>{latest.signal}</div>
              <div style={{ color: "#cbd5e1", lineHeight: 1.8, marginBottom: 14 }}>
                基於 {latest.training_window_start || deployment.date_start} 到 {latest.training_window_end || deployment.date_end} 的數據，明日模型操作建議為：{latest.signal}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10, marginBottom: 14 }}>
                <StatBox label="最後訓練區間" value={`${latest.training_window_start || "-"} → ${latest.training_window_end || "-"}`} tone="#e2e8f0" />
                <StatBox label="風控建議" value={`SL ${pct(latest.stop_loss_pct / 100)} / TP ${pct(latest.target_pct / 100)}`} tone="#fbbf24" />
              </div>
              <ProbStrip label="LONG" value={latest.prob_long || 0} color="#f87171" />
              <ProbStrip label="NEUTRAL" value={latest.prob_neutral || 0} color="#94a3b8" />
              <ProbStrip label="SHORT" value={latest.prob_short || 0} color="#34d399" />
              <div style={{ marginTop: 12 }}>
                <Link to={`/live-run/${latest.id}/status`} style={{ color: "#93c5fd", textDecoration: "none" }}>查看任務狀態</Link>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 18 }}>
        <div style={{ background: "#131929", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, padding: 22 }}>
          <h2 style={{ color: "#f8fafc", marginBottom: 14 }}>歷史 Live Runs</h2>
          {!deployment.runs?.length ? (
            <div style={{ color: "#94a3b8" }}>目前還沒有歷史 live runs。</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {deployment.runs.map(run => (
                <div key={run.id} style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                    <div style={{ color: "#f8fafc", fontWeight: 700 }}>{run.signal || run.status}</div>
                    <div style={{ color: "#94a3b8", fontSize: 12 }}>{fmtDate(run.created_at, true)}</div>
                  </div>
                  <div style={{ color: "#cbd5e1", fontSize: 12, lineHeight: 1.7 }}>
                    <div>訓練區間：{run.training_window_start || "-"} → {run.training_window_end || "-"}</div>
                    <div>目標日：{run.target_date || "-"}</div>
                    <div>信心度：{run.confidence != null ? `${Number(run.confidence).toFixed(1)}%` : "-"}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ background: "#131929", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, padding: 22 }}>
          <h2 style={{ color: "#f8fafc", marginBottom: 14 }}>實戰 Feedback 與模型檢討</h2>
          {sortedFeedback.length === 0 ? (
            <div style={{ color: "#94a3b8" }}>目前還沒有可檢討的實戰結果，等目標日行情入庫後會自動補上。</div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12, marginBottom: 18 }}>
                <StatBox label="最新成功率" value={`${((feedback.summary?.latest_hit_rate || 0) * 100).toFixed(1)}%`} tone="#6ee7b7" />
                <StatBox label="累積損益" value={`${((feedback.summary?.latest_cumulative_pnl || 0) * 100).toFixed(2)}%`} tone="#93c5fd" />
                <StatBox label="Alpha Drift" value={`${((feedback.summary?.latest_alpha_drift || 0) * 100).toFixed(2)}%`} tone="#fbbf24" />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
                <div>
                  <div style={{ color: "#cbd5e1", marginBottom: 10 }}>預測成功率</div>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={sortedFeedback}>
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
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={sortedFeedback}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="target_date" tick={{ fill: "#64748b", fontSize: 10 }} />
                      <YAxis tick={{ fill: "#64748b", fontSize: 10 }} tickFormatter={v => `${(v * 100).toFixed(1)}%`} />
                      <Tooltip />
                      <Area dataKey="cumulative_pnl" stroke="#34d399" fill="rgba(52,211,153,0.18)" />
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
