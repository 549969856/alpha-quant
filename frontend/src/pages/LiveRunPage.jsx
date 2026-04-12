import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export default function LiveRunPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: run, isLoading } = useQuery({
    queryKey: ["live-run-status", id],
    queryFn: () => api.get(`/live-runs/${id}/status/`).then(r => r.data),
    refetchInterval: query => {
      const status = query.state.data?.status;
      return status === "pending" || status === "training" ? 2000 : false;
    },
  });

  useEffect(() => {
    if (run?.status === "done") {
      const timer = setTimeout(() => navigate(`/live/${run.deployment.id}`), 1500);
      return () => clearTimeout(timer);
    }
  }, [navigate, run]);

  if (isLoading || !run) {
    return <div style={{ color: "#94a3b8" }}>讀取實戰任務中...</div>;
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ background: "#131929", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, padding: 24 }}>
        <h1 style={{ color: "#f8fafc", fontSize: 26, marginBottom: 12 }}>實戰任務狀態</h1>
        <div style={{ color: run.status === "done" ? "#6ee7b7" : run.status === "failed" ? "#fca5a5" : "#93c5fd", fontSize: 18, fontWeight: 800, marginBottom: 14 }}>
          {run.status}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>
          <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)" }}>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>模型</div>
            <div style={{ color: "#f8fafc" }}>{run.model_arch.display_name}</div>
          </div>
          <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)" }}>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>樣本數</div>
            <div style={{ color: "#f8fafc" }}>{run.train_size ?? "-"}</div>
          </div>
          <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)" }}>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>訓練區間開始</div>
            <div style={{ color: "#f8fafc" }}>{run.training_window_start || "-"}</div>
          </div>
          <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)" }}>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>訓練區間結束</div>
            <div style={{ color: "#f8fafc" }}>{run.training_window_end || "-"}</div>
          </div>
        </div>
        {run.error_msg && (
          <div style={{ marginTop: 16, color: "#fca5a5" }}>
            {run.error_msg}
          </div>
        )}
      </div>
    </div>
  );
}
