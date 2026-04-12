import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "../api/client";

function pct(value) {
  if (value == null) return "-";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function num(value) {
  if (value == null) return "-";
  return Number(value).toFixed(3);
}

function StatCard({ label, value, tone = "#f8fafc" }) {
  return (
    <div style={{ padding: "14px 16px", borderRadius: 14, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: tone, fontFamily: "'JetBrains Mono',monospace" }}>{value}</div>
    </div>
  );
}

function ExperimentCard({ experiment, onDeploy }) {
  const backtest = experiment.latest_backtest;
  return (
    <div style={{ background: "#131929", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#f8fafc" }}>{experiment.name || "未命名實驗"}</div>
          <div style={{ marginTop: 6, color: "#94a3b8", fontSize: 13 }}>{experiment.ticker} vs {experiment.benchmark}</div>
        </div>
        <div style={{ color: experiment.status === "done" ? "#6ee7b7" : experiment.status === "failed" ? "#fca5a5" : "#93c5fd" }}>
          {experiment.status}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10, marginBottom: 14 }}>
        <StatCard label="總報酬率" value={pct(backtest?.total_return)} tone={(backtest?.total_return ?? 0) >= 0 ? "#6ee7b7" : "#fca5a5"} />
        <StatCard label="Sharpe" value={num(backtest?.sharpe_ratio)} tone="#93c5fd" />
        <StatCard label="最大回撤" value={pct(backtest?.max_drawdown)} tone="#fbbf24" />
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link to={`/experiment/${experiment.id}`} style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(255,255,255,0.04)", color: "#e2e8f0", textDecoration: "none" }}>
          編輯實驗
        </Link>
        {backtest?.run_id && (
          <Link to={`/run/${backtest.run_id}/backtest`} style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(59,130,246,0.14)", color: "#93c5fd", textDecoration: "none" }}>
            查看回測
          </Link>
        )}
        {experiment.status === "done" && (
          <button
            type="button"
            onClick={() => onDeploy(experiment)}
            style={{ padding: "10px 14px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#059669,#047857)", color: "#fff", cursor: "pointer", fontWeight: 700 }}
          >
            投入實戰
          </button>
        )}
      </div>
    </div>
  );
}

function LiveCard({ deployment }) {
  return (
    <div style={{ background: "#131929", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc" }}>{deployment.name}</div>
          <div style={{ marginTop: 6, color: "#94a3b8", fontSize: 13 }}>{deployment.ticker} | {deployment.model_arch?.display_name}</div>
        </div>
        <div style={{ color: deployment.status === "ready" ? "#6ee7b7" : deployment.status === "failed" ? "#fca5a5" : "#93c5fd" }}>
          {deployment.status}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10, marginBottom: 14 }}>
        <StatCard label="最新訊號" value={deployment.latest_run?.signal || "-"} />
        <StatCard label="預測日期" value={deployment.latest_run?.prediction_date || "-"} tone="#93c5fd" />
      </div>

      <Link to={`/live/${deployment.id}`} style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(16,185,129,0.12)", color: "#6ee7b7", textDecoration: "none", display: "inline-block" }}>
        進入實戰頁
      </Link>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: experiments = [] } = useQuery({
    queryKey: ["experiments"],
    queryFn: () => api.get("/experiments/").then(r => r.data.results ?? r.data),
    refetchInterval: 8000,
  });

  const { data: liveDeployments = [] } = useQuery({
    queryKey: ["live-deployments"],
    queryFn: () => api.get("/live-deployments/").then(r => r.data),
    refetchInterval: 8000,
  });

  const createLiveDeployment = useMutation({
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
      queryClient.invalidateQueries({ queryKey: ["live-deployments"] });
      toast.success("已建立實戰部署");
      navigate(`/live/${res.data.id}`);
    },
    onError: err => {
      toast.error(err?.response?.data?.error || "建立實戰部署失敗");
    },
  });

  const summary = useMemo(() => ({
    researchCount: experiments.length,
    completedCount: experiments.filter(item => item.status === "done").length,
    liveCount: liveDeployments.length,
    readyCount: liveDeployments.filter(item => item.status === "ready").length,
  }), [experiments, liveDeployments]);

  return (
    <div style={{ maxWidth: 1200 }}>
      <div style={{ background: "linear-gradient(135deg,rgba(37,99,235,0.18),rgba(15,23,42,0.92))", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 24, padding: 28, marginBottom: 24 }}>
        <div style={{ fontSize: 30, color: "#f8fafc", fontWeight: 900, marginBottom: 10 }}>Research / Live Command Center</div>
        <div style={{ color: "#cbd5e1", lineHeight: 1.7, maxWidth: 760 }}>
          先用研究實驗驗證策略，再把成功參數送進實戰系統。Dashboard 現在會同時顯示回測指標、實戰部署，以及快速投入實戰入口。
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12, marginTop: 18 }}>
          <StatCard label="研究實驗" value={summary.researchCount} />
          <StatCard label="已完成研究" value={summary.completedCount} tone="#6ee7b7" />
          <StatCard label="實戰部署" value={summary.liveCount} />
          <StatCard label="Ready 部署" value={summary.readyCount} tone="#93c5fd" />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ color: "#f8fafc", fontSize: 22 }}>研究實驗</h2>
        <Link to="/experiment/new" style={{ color: "#93c5fd", textDecoration: "none" }}>新增研究實驗</Link>
      </div>
      <div style={{ display: "grid", gap: 14, marginBottom: 28 }}>
        {experiments.length === 0 && <div style={{ color: "#94a3b8" }}>目前還沒有研究實驗。</div>}
        {experiments.map(item => (
          <ExperimentCard key={item.id} experiment={item} onDeploy={exp => createLiveDeployment.mutate(exp)} />
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ color: "#f8fafc", fontSize: 22 }}>實戰部署</h2>
      </div>
      <div style={{ display: "grid", gap: 14 }}>
        {liveDeployments.length === 0 && <div style={{ color: "#94a3b8" }}>目前還沒有實戰部署。</div>}
        {liveDeployments.map(item => <LiveCard key={item.id} deployment={item} />)}
      </div>
    </div>
  );
}
