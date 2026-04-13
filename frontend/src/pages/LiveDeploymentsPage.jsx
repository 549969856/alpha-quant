import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "../api/client";

function fmtDate(value, withTime = false) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-TW", withTime ? {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  } : {
    year: "numeric", month: "2-digit", day: "2-digit",
  });
}

function pct(value) {
  if (value == null) return "-";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function MiniStat({ label, value, tone = "#f8fafc" }) {
  return (
    <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: tone, fontFamily: "'JetBrains Mono',monospace" }}>{value}</div>
    </div>
  );
}

export default function LiveDeploymentsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: deployments = [] } = useQuery({
    queryKey: ["live-deployments"],
    queryFn: () => api.get("/live-deployments/").then(r => r.data),
    refetchInterval: 8000,
  });

  const { data: experiments = [] } = useQuery({
    queryKey: ["experiments"],
    queryFn: () => api.get("/experiments/").then(r => r.data.results ?? r.data),
    refetchInterval: 8000,
  });

  const createDeployment = useMutation({
    mutationFn: experiment => api.post("/live-deployments/", {
      source_experiment_id: experiment.id,
      name: `${experiment.name || experiment.ticker} Live`,
      description: experiment.description,
      ticker: experiment.ticker,
      benchmark: experiment.benchmark,
      date_start: experiment.date_start,
      date_end: experiment.date_end,
      random_seed: experiment.random_seed,
    }),
    onSuccess: res => {
      qc.invalidateQueries({ queryKey: ["live-deployments"] });
      toast.success("已建立實戰部署");
      navigate(`/live/${res.data.id}`);
    },
    onError: err => toast.error(err?.response?.data?.error || "建立實戰部署失敗"),
  });

  const ready = deployments.filter(item => item.status === "ready").length;
  const autoEnabled = deployments.filter(item => item.auto_predict_enabled).length;
  const predictedToday = deployments.filter(item => item.today_prediction_done || item.today_prediction_in_progress).length;
  const doneExperiments = experiments.filter(item => item.status === "done");

  return (
    <div style={{ maxWidth: 1200 }}>
      <div style={{ background: "linear-gradient(135deg,rgba(5,150,105,0.16),rgba(15,23,42,0.94))", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 22, padding: 26, marginBottom: 22 }}>
        <h1 style={{ color: "#f8fafc", fontSize: 28, fontWeight: 900, marginBottom: 8 }}>實戰部署控制板</h1>
        <p style={{ color: "#cbd5e1", lineHeight: 1.7, maxWidth: 760 }}>
          集中管理已部署策略，設定每日自動預測與手動觸發流程，並追蹤最近一次實戰訊號、歷史 live runs 與 feedback。
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12, marginTop: 18 }}>
          <MiniStat label="部署總數" value={deployments.length} />
          <MiniStat label="Ready" value={ready} tone="#6ee7b7" />
          <MiniStat label="自動預測" value={autoEnabled} tone="#93c5fd" />
          <MiniStat label="今日已處理" value={predictedToday} tone="#fbbf24" />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(320px,0.8fr)", gap: 16 }}>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ color: "#f8fafc", fontSize: 22 }}>已部署策略</h2>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            {deployments.length === 0 && <div style={{ color: "#94a3b8" }}>目前還沒有任何實戰部署。</div>}
            {deployments.map(item => (
              <div key={item.id} style={{ background: "#131929", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, padding: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                  <div>
                    <div style={{ color: "#f8fafc", fontSize: 20, fontWeight: 800 }}>{item.name}</div>
                    <div style={{ color: "#94a3b8", marginTop: 6 }}>{item.ticker} / {item.model_arch?.display_name}</div>
                  </div>
                  <div style={{ color: item.status === "ready" ? "#6ee7b7" : item.status === "failed" ? "#fca5a5" : "#93c5fd" }}>{item.status}</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, marginBottom: 14 }}>
                  <MiniStat label="最後訊號" value={item.latest_run?.signal || "-"} tone={item.latest_run?.signal === "LONG" ? "#f87171" : item.latest_run?.signal === "SHORT" ? "#34d399" : "#f8fafc"} />
                  <MiniStat label="信心度" value={item.latest_run?.confidence != null ? `${Number(item.latest_run.confidence).toFixed(1)}%` : "-"} tone="#93c5fd" />
                  <MiniStat label="今日狀態" value={item.today_prediction_done ? "已完成" : item.today_prediction_in_progress ? "進行中" : "未執行"} tone={item.today_prediction_done ? "#6ee7b7" : item.today_prediction_in_progress ? "#fbbf24" : "#94a3b8"} />
                  <MiniStat label="下次排程" value={item.next_run_at ? fmtDate(item.next_run_at, true) : "未啟用"} tone="#fbbf24" />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ color: "#cbd5e1", fontSize: 12, lineHeight: 1.7 }}>
                    <div>自動預測：{item.auto_predict_enabled ? `已啟用 (${item.auto_predict_time?.slice(0, 5)})` : "未啟用"}</div>
                    <div>最後訓練區間：{item.latest_run?.training_window_start || item.date_start} → {item.latest_run?.training_window_end || item.date_end}</div>
                  </div>
                  <Link to={`/live/${item.id}`} style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(16,185,129,0.12)", color: "#6ee7b7", textDecoration: "none", fontWeight: 700 }}>
                    進入控制台
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: "#131929", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, padding: 20, alignSelf: "start" }}>
          <h2 style={{ color: "#f8fafc", fontSize: 22, marginBottom: 12 }}>從研究結果建立部署</h2>
          <p style={{ color: "#94a3b8", lineHeight: 1.7, marginBottom: 14 }}>
            從已完成回測的研究實驗，一鍵建立可投入實戰的 deployment。
          </p>
          <div style={{ display: "grid", gap: 10 }}>
            {doneExperiments.length === 0 && <div style={{ color: "#64748b" }}>目前沒有可部署的已完成研究實驗。</div>}
            {doneExperiments.map(exp => (
              <button
                key={exp.id}
                type="button"
                onClick={() => createDeployment.mutate(exp)}
                disabled={createDeployment.isPending}
                style={{ textAlign: "left", padding: "14px 16px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.03)", cursor: "pointer" }}
              >
                <div style={{ color: "#f8fafc", fontWeight: 700, marginBottom: 6 }}>{exp.name || "未命名實驗"}</div>
                <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 6 }}>{exp.ticker} / {exp.benchmark}</div>
                <div style={{ color: "#cbd5e1", fontSize: 12 }}>最近回測：{pct(exp.latest_backtest?.total_return)} / Sharpe {exp.latest_backtest?.sharpe_ratio != null ? Number(exp.latest_backtest.sharpe_ratio).toFixed(3) : "-"}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
