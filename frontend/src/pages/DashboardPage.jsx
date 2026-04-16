import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "../api/client";
import ActionModal from "../components/ui/ActionModal";

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
      <div style={{ fontSize: 22, fontWeight: 800, color: tone, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
    </div>
  );
}

function ActionBar({ selecting, selectedCount, deleting, onStart, onCancel, onConfirm, label }) {
  if (!selecting) {
    return (
      <button
        type="button"
        onClick={onStart}
        style={{
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid rgba(248,113,113,0.25)",
          background: "rgba(248,113,113,0.08)",
          color: "#fca5a5",
          cursor: "pointer",
          fontWeight: 700,
        }}
      >
        批次刪除
      </button>
    );
  }

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ color: "#94a3b8", fontSize: 13 }}>已選取 {selectedCount} 筆</span>
      <button
        type="button"
        onClick={onConfirm}
        disabled={selectedCount === 0 || deleting}
        style={{
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid rgba(248,113,113,0.25)",
          background: "rgba(248,113,113,0.08)",
          color: "#fca5a5",
          cursor: selectedCount === 0 || deleting ? "not-allowed" : "pointer",
          opacity: selectedCount === 0 || deleting ? 0.5 : 1,
          fontWeight: 700,
        }}
      >
        刪除已選{selectedCount ? ` (${selectedCount})` : ""}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={deleting}
        style={{
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.04)",
          color: "#e2e8f0",
          cursor: deleting ? "not-allowed" : "pointer",
          opacity: deleting ? 0.5 : 1,
          fontWeight: 700,
        }}
      >
        取消
      </button>
      <span style={{ color: "#64748b", fontSize: 12 }}>{label}</span>
    </div>
  );
}

function SelectionToggle({ checked, onChange, ariaLabel }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", color: "#cbd5e1", fontSize: 13 }}>
      <input type="checkbox" checked={checked} onChange={onChange} aria-label={ariaLabel} />
      選取
    </label>
  );
}

function ExperimentCard({ experiment, selecting, selected, onToggle, onDeploy, onDelete }) {
  const backtest = experiment.latest_backtest;

  return (
    <div style={{ background: "#131929", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#f8fafc" }}>{experiment.name || "Untitled Experiment"}</div>
          <div style={{ marginTop: 6, color: "#94a3b8", fontSize: 13 }}>{experiment.ticker} vs {experiment.benchmark}</div>
        </div>
        <div style={{ display: "grid", justifyItems: "end", gap: 10 }}>
          <div style={{ color: experiment.status === "done" ? "#6ee7b7" : experiment.status === "failed" ? "#fca5a5" : "#93c5fd", fontWeight: 700 }}>
            {experiment.status}
          </div>
          {selecting ? (
            <SelectionToggle checked={selected} onChange={() => onToggle(experiment.id)} ariaLabel={`select-experiment-${experiment.id}`} />
          ) : null}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10, marginBottom: 14 }}>
        <StatCard label="總報酬率" value={pct(backtest?.total_return)} tone={(backtest?.total_return ?? 0) >= 0 ? "#6ee7b7" : "#fca5a5"} />
        <StatCard label="Sharpe" value={num(backtest?.sharpe_ratio)} tone="#93c5fd" />
        <StatCard label="最大回撤" value={pct(backtest?.max_drawdown)} tone="#fbbf24" />
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link to={`/experiment/${experiment.id}`} style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(255,255,255,0.04)", color: "#e2e8f0", textDecoration: "none" }}>
          查看詳情
        </Link>
        {backtest?.run_id && (
          <Link to={`/run/${backtest.run_id}/backtest`} style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(59,130,246,0.14)", color: "#93c5fd", textDecoration: "none" }}>
            回測結果
          </Link>
        )}
        {experiment.status === "done" && !selecting && (
          <button
            type="button"
            onClick={() => onDeploy(experiment)}
            style={{ padding: "10px 14px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#059669,#047857)", color: "#fff", cursor: "pointer", fontWeight: 700 }}
          >
            投入實戰
          </button>
        )}
        {!selecting && (
          <button
            type="button"
            onClick={() => onDelete(experiment)}
            style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(248,113,113,0.25)", background: "rgba(248,113,113,0.08)", color: "#fca5a5", cursor: "pointer", fontWeight: 700 }}
          >
            刪除
          </button>
        )}
      </div>
    </div>
  );
}

function LiveCard({ deployment, selecting, selected, onToggle, onDelete }) {
  const signalTone = deployment.latest_run?.signal === "LONG"
    ? "#f87171"
    : deployment.latest_run?.signal === "SHORT"
      ? "#34d399"
      : "#f8fafc";

  return (
    <div style={{ background: "#131929", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc" }}>{deployment.name}</div>
          <div style={{ marginTop: 6, color: "#94a3b8", fontSize: 13 }}>{deployment.ticker} | {deployment.model_arch?.display_name}</div>
        </div>
        <div style={{ display: "grid", justifyItems: "end", gap: 10 }}>
          <div style={{ color: deployment.status === "ready" ? "#6ee7b7" : deployment.status === "failed" ? "#fca5a5" : "#93c5fd", fontWeight: 700 }}>
            {deployment.status}
          </div>
          {selecting ? (
            <SelectionToggle checked={selected} onChange={() => onToggle(deployment.id)} ariaLabel={`select-live-${deployment.id}`} />
          ) : null}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10, marginBottom: 14 }}>
        <StatCard label="最新訊號" value={deployment.latest_run?.signal || "-"} tone={signalTone} />
        <StatCard label="預測日期" value={deployment.latest_run?.prediction_date || "-"} tone="#93c5fd" />
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {!selecting && (
          <Link to={`/live/${deployment.id}`} style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(16,185,129,0.12)", color: "#6ee7b7", textDecoration: "none", display: "inline-block" }}>
            查看實戰
          </Link>
        )}
        {!selecting && (
          <button
            type="button"
            onClick={() => onDelete(deployment)}
            style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(248,113,113,0.25)", background: "rgba(248,113,113,0.08)", color: "#fca5a5", cursor: "pointer", fontWeight: 700 }}
          >
            刪除
          </button>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteState, setDeleteState] = useState({ type: null, item: null });
  const [selectedExperiments, setSelectedExperiments] = useState([]);
  const [selectedLiveDeployments, setSelectedLiveDeployments] = useState([]);
  const [experimentBatchMode, setExperimentBatchMode] = useState(false);
  const [liveBatchMode, setLiveBatchMode] = useState(false);

  const { data: experiments = [] } = useQuery({
    queryKey: ["experiments"],
    queryFn: () => api.get("/experiments/").then(res => res.data.results ?? res.data),
    refetchInterval: 8000,
  });

  const { data: liveDeployments = [] } = useQuery({
    queryKey: ["live-deployments"],
    queryFn: () => api.get("/live-deployments/").then(res => res.data),
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

  const deleteExperiment = useMutation({
    mutationFn: id => api.delete(`/experiments/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["experiments"] });
      setSelectedExperiments(curr => curr.filter(item => item !== deleteState.item?.id));
      toast.success("實驗已刪除");
      setDeleteState({ type: null, item: null });
    },
    onError: err => toast.error(err?.response?.data?.error || "刪除實驗失敗"),
  });

  const deleteLiveDeployment = useMutation({
    mutationFn: id => api.delete(`/live-deployments/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["live-deployments"] });
      setSelectedLiveDeployments(curr => curr.filter(item => item !== deleteState.item?.id));
      toast.success("實戰部署已刪除");
      setDeleteState({ type: null, item: null });
    },
    onError: err => toast.error(err?.response?.data?.error || "刪除實戰部署失敗"),
  });

  const batchDeleteExperiments = useMutation({
    mutationFn: async ids => Promise.all(ids.map(id => api.delete(`/experiments/${id}/`))),
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ["experiments"] });
      setSelectedExperiments(curr => curr.filter(id => !ids.includes(id)));
      setExperimentBatchMode(false);
      toast.success(`已刪除 ${ids.length} 筆實驗`);
      setDeleteState({ type: null, item: null });
    },
    onError: err => toast.error(err?.response?.data?.error || "批次刪除實驗失敗"),
  });

  const batchDeleteLiveDeployments = useMutation({
    mutationFn: async ids => Promise.all(ids.map(id => api.delete(`/live-deployments/${id}/`))),
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ["live-deployments"] });
      setSelectedLiveDeployments(curr => curr.filter(id => !ids.includes(id)));
      setLiveBatchMode(false);
      toast.success(`已刪除 ${ids.length} 筆實戰部署`);
      setDeleteState({ type: null, item: null });
    },
    onError: err => toast.error(err?.response?.data?.error || "批次刪除實戰部署失敗"),
  });

  const summary = useMemo(() => ({
    researchCount: experiments.length,
    completedCount: experiments.filter(item => item.status === "done").length,
    liveCount: liveDeployments.length,
    readyCount: liveDeployments.filter(item => item.status === "ready").length,
  }), [experiments, liveDeployments]);

  const toggleExperimentSelection = id => {
    setSelectedExperiments(curr => curr.includes(id) ? curr.filter(item => item !== id) : [...curr, id]);
  };

  const toggleLiveSelection = id => {
    setSelectedLiveDeployments(curr => curr.includes(id) ? curr.filter(item => item !== id) : [...curr, id]);
  };

  const cancelExperimentBatchMode = () => {
    setExperimentBatchMode(false);
    setSelectedExperiments([]);
  };

  const cancelLiveBatchMode = () => {
    setLiveBatchMode(false);
    setSelectedLiveDeployments([]);
  };

  return (
    <div style={{ maxWidth: 1200 }}>
      <div style={{ background: "linear-gradient(135deg,rgba(37,99,235,0.18),rgba(15,23,42,0.92))", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 24, padding: 28, marginBottom: 24 }}>
        <div style={{ fontSize: 30, color: "#f8fafc", fontWeight: 900, marginBottom: 10 }}>Research / Live Command Center</div>
        <div style={{ color: "#cbd5e1", lineHeight: 1.7, maxWidth: 760 }}>
          這裡可以管理研究實驗與實戰部署。你可以查看回測關鍵指標、把完成的研究推進到實戰，也可以在需要時進入批次刪除模式清理資料。
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12, marginTop: 18 }}>
          <StatCard label="研究實驗" value={summary.researchCount} />
          <StatCard label="已完成實驗" value={summary.completedCount} tone="#6ee7b7" />
          <StatCard label="實戰部署" value={summary.liveCount} />
          <StatCard label="Ready 部署" value={summary.readyCount} tone="#93c5fd" />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ color: "#f8fafc", fontSize: 22, margin: 0 }}>研究實驗</h2>
          <span style={{ color: "#94a3b8", fontSize: 13 }}>{experiments.length} 筆</span>
        </div>
        <ActionBar
          selecting={experimentBatchMode}
          selectedCount={selectedExperiments.length}
          deleting={batchDeleteExperiments.isPending}
          onStart={() => setExperimentBatchMode(true)}
          onCancel={cancelExperimentBatchMode}
          onConfirm={() => setDeleteState({ type: "experiments-batch", item: [...selectedExperiments] })}
          label="進入批次模式後才會顯示選取。"
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ color: "#94a3b8", fontSize: 13 }}>
          {experimentBatchMode ? "請勾選要刪除的研究實驗。" : "可直接查看實驗、回測結果，或投入實戰。"}
        </div>
        <Link to="/experiment/new" style={{ color: "#93c5fd", textDecoration: "none" }}>建立新實驗</Link>
      </div>
      <div style={{ display: "grid", gap: 14, marginBottom: 28 }}>
        {experiments.length === 0 && <div style={{ color: "#94a3b8" }}>目前還沒有任何研究實驗。</div>}
        {experiments.map(item => (
          <ExperimentCard
            key={item.id}
            experiment={item}
            selecting={experimentBatchMode}
            selected={selectedExperiments.includes(item.id)}
            onToggle={toggleExperimentSelection}
            onDeploy={exp => createLiveDeployment.mutate(exp)}
            onDelete={exp => setDeleteState({ type: "experiment", item: exp })}
          />
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ color: "#f8fafc", fontSize: 22, margin: 0 }}>實戰部署</h2>
          <span style={{ color: "#94a3b8", fontSize: 13 }}>{liveDeployments.length} 筆</span>
        </div>
        <ActionBar
          selecting={liveBatchMode}
          selectedCount={selectedLiveDeployments.length}
          deleting={batchDeleteLiveDeployments.isPending}
          onStart={() => setLiveBatchMode(true)}
          onCancel={cancelLiveBatchMode}
          onConfirm={() => setDeleteState({ type: "live-batch", item: [...selectedLiveDeployments] })}
          label="進入批次模式後才會顯示選取。"
        />
      </div>
      <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 14 }}>
        {liveBatchMode ? "請勾選要刪除的實戰部署。" : "可直接進入實戰頁查看最新訊號與模型檢討。"}
      </div>
      <div style={{ display: "grid", gap: 14 }}>
        {liveDeployments.length === 0 && <div style={{ color: "#94a3b8" }}>目前還沒有任何實戰部署。</div>}
        {liveDeployments.map(item => (
          <LiveCard
            key={item.id}
            deployment={item}
            selecting={liveBatchMode}
            selected={selectedLiveDeployments.includes(item.id)}
            onToggle={toggleLiveSelection}
            onDelete={deployment => setDeleteState({ type: "live", item: deployment })}
          />
        ))}
      </div>

      <ActionModal
        open={deleteState.type === "experiment"}
        title="刪除研究實驗"
        message={`確定要刪除「${deleteState.item?.name || ""}」嗎？這會一併移除相關 run、回測結果與研究預測紀錄。`}
        confirmLabel="確認刪除"
        cancelLabel="取消"
        loading={deleteExperiment.isPending}
        onCancel={() => setDeleteState({ type: null, item: null })}
        onConfirm={() => deleteExperiment.mutate(deleteState.item?.id)}
      />

      <ActionModal
        open={deleteState.type === "live"}
        title="刪除實戰部署"
        message={`確定要刪除「${deleteState.item?.name || ""}」嗎？這會一併移除相關 live runs 與 feedback 檢討資料。`}
        confirmLabel="確認刪除"
        cancelLabel="取消"
        loading={deleteLiveDeployment.isPending}
        onCancel={() => setDeleteState({ type: null, item: null })}
        onConfirm={() => deleteLiveDeployment.mutate(deleteState.item?.id)}
      />

      <ActionModal
        open={deleteState.type === "experiments-batch"}
        title="批次刪除研究實驗"
        message={`確定要刪除目前選取的 ${selectedExperiments.length} 筆研究實驗嗎？這些實驗的 run、回測與預測資料也會一起移除。`}
        confirmLabel="確認批次刪除"
        cancelLabel="取消"
        loading={batchDeleteExperiments.isPending}
        onCancel={() => setDeleteState({ type: null, item: null })}
        onConfirm={() => batchDeleteExperiments.mutate([...selectedExperiments])}
      />

      <ActionModal
        open={deleteState.type === "live-batch"}
        title="批次刪除實戰部署"
        message={`確定要刪除目前選取的 ${selectedLiveDeployments.length} 筆實戰部署嗎？對應的 live runs 與 feedback 檢討資料也會一起移除。`}
        confirmLabel="確認批次刪除"
        cancelLabel="取消"
        loading={batchDeleteLiveDeployments.isPending}
        onCancel={() => setDeleteState({ type: null, item: null })}
        onConfirm={() => batchDeleteLiveDeployments.mutate([...selectedLiveDeployments])}
      />
    </div>
  );
}
