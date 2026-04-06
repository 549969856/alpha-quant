import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/authStore";
import {
  FlaskConical,
  Clock3,
  Zap,
  Pencil,
  Trash2,
  Eye,
  X,
  Search,
  ArrowUpRight,
  CircleDot,
  Sparkles,
  TimerReset,
  Activity,
  CalendarRange,
  Filter,
  SlidersHorizontal,
  BarChart3,
  BrainCircuit,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { zhTW } from "date-fns/locale";
import toast from "react-hot-toast";

const STATUS = {
  draft: { dot: "#6b7280", label: "草稿", bg: "rgba(107,114,128,0.12)", color: "#9ca3af" },
  queued: { dot: "#f59e0b", label: "排隊中", bg: "rgba(245,158,11,0.12)", color: "#fbbf24" },
  running: { dot: "#60a5fa", label: "訓練中", bg: "rgba(96,165,250,0.12)", color: "#93c5fd" },
  done: { dot: "#34d399", label: "完成", bg: "rgba(52,211,153,0.12)", color: "#6ee7b7" },
  failed: { dot: "#f87171", label: "失敗", bg: "rgba(248,113,113,0.12)", color: "#fca5a5" },
};

const STATUS_FILTERS = [
  { key: "all", label: "全部" },
  { key: "running", label: "進行中" },
  { key: "done", label: "已完成" },
  { key: "failed", label: "失敗" },
  { key: "draft", label: "草稿" },
];

const SORT_OPTIONS = [
  { key: "updated_desc", label: "最近更新" },
  { key: "created_desc", label: "最新建立" },
  { key: "created_asc", label: "最早建立" },
  { key: "name_asc", label: "名稱 A-Z" },
  { key: "name_desc", label: "名稱 Z-A" },
];

function StatusPill({ s }) {
  const c = STATUS[s] ?? STATUS.draft;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: c.bg, color: c.color }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: c.dot, boxShadow: `0 0 8px ${c.dot}` }} />
      {c.label}
    </span>
  );
}

function StatCard({ label, value, sub, color = "#a5b4fc", accent = "rgba(99,102,241,0.18)", icon }) {
  const Icon = icon;
  return (
    <div className="card" style={{ padding: "20px 22px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: -28, right: -18, width: 88, height: 88, borderRadius: "50%", background: accent, filter: "blur(10px)", opacity: 0.75 }} />
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, position: "relative" }}>
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>{label}</p>
          <p style={{ fontSize: 28, fontWeight: 800, color, letterSpacing: "-0.04em", fontFamily: "'JetBrains Mono',monospace" }}>{value}</p>
          {sub && <p style={{ fontSize: 11, color: "#64748b", marginTop: 8, lineHeight: 1.5 }}>{sub}</p>}
        </div>
        {Icon && (
          <div style={{ width: 38, height: 38, borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon size={17} color={color} />
          </div>
        )}
      </div>
    </div>
  );
}

function SmallInsight({ title, value, tone, note }) {
  return (
    <div style={{ padding: "14px 16px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <p style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 8 }}>{title}</p>
      <p style={{ fontSize: 20, fontWeight: 800, color: tone, fontFamily: "'JetBrains Mono',monospace", letterSpacing: "-0.03em" }}>{value}</p>
      <p style={{ fontSize: 11, color: "#64748b", marginTop: 6, lineHeight: 1.5 }}>{note}</p>
    </div>
  );
}

function SectionTitle({ title, icon }) {
  const Icon = icon;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <Icon size={14} color="#94a3b8" />
      <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.1em" }}>{title}</p>
    </div>
  );
}

function SpotlightCell({ label, value }) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <p style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{label}</p>
      <p style={{ fontSize: 12, fontWeight: 600, color: "#f8fafc" }}>{value}</p>
    </div>
  );
}

function SuggestionCard({ icon, title, desc, tone, action }) {
  const Icon = icon;
  return (
    <button
      onClick={action}
      style={{ textAlign: "left", padding: "16px 16px", borderRadius: 14, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", cursor: "pointer" }}
    >
      <div style={{ width: 34, height: 34, borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
        <Icon size={15} color={tone} />
      </div>
      <p style={{ fontSize: 14, fontWeight: 700, color: "#f8fafc", marginBottom: 6 }}>{title}</p>
      <p style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>{desc}</p>
    </button>
  );
}

function MiniMetric({ label, value, tone }) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
      <p style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{label}</p>
      <p style={{ fontSize: 12, fontWeight: 700, color: tone }}>{value}</p>
    </div>
  );
}

function LoadingList() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {[1, 2, 3].map(i => (
        <div key={i} style={{ height: 148, borderRadius: 14, background: "#131929", border: "1px solid rgba(255,255,255,0.05)", animation: "pulse 1.5s infinite" }} />
      ))}
    </div>
  );
}

function EmptyState({ search }) {
  return (
    <div style={{ textAlign: "center", padding: "56px 20px", background: "rgba(255,255,255,0.02)", borderRadius: 14, border: "1px dashed rgba(255,255,255,0.08)" }}>
      <Search size={28} color="#374151" style={{ margin: "0 auto 12px" }} />
      <p style={{ fontSize: 14, color: "#94a3b8" }}>{search ? "找不到符合條件的實驗" : "尚無實驗"}</p>
      <p style={{ fontSize: 12, color: "#475569", marginTop: 6 }}>
        {search ? "試著調整關鍵字、狀態或排序方式。" : "從右上角建立第一個實驗，開始你的研究流程。"}
      </p>
    </div>
  );
}

function accentAction(background, color, borderColor) {
  return { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 0", borderRadius: 10, border: `1px solid ${borderColor}`, background, color, cursor: "pointer", fontSize: 12, fontWeight: 700 };
}

function accentLink(background, color, borderColor) {
  return { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "10px 0", borderRadius: 10, border: `1px solid ${borderColor}`, background, color, textDecoration: "none", fontSize: 12, fontWeight: 700 };
}

function actionBtn(background, color, borderColor) {
  return { display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 10px", borderRadius: 8, fontSize: 12, fontWeight: 600, background, color, border: `1px solid ${borderColor}`, cursor: "pointer" };
}

function actionLink(background, color, borderColor) {
  return { display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 10px", borderRadius: 8, fontSize: 12, fontWeight: 600, background, color, textDecoration: "none", border: `1px solid ${borderColor}` };
}

function heroPrimaryBtn() {
  return { display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 10, background: "#f8fafc", color: "#111827", textDecoration: "none", fontSize: 13, fontWeight: 800 };
}

function heroGhostBtn() {
  return { display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "#f8fafc", cursor: "pointer", fontSize: 13, fontWeight: 700 };
}

function distance(ts) {
  if (!ts) return "—";
  return formatDistanceToNow(new Date(ts), { locale: zhTW, addSuffix: true });
}

function formatDateShort(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export default function DashboardPage() {
  const user = useAuthStore(s => s.user);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("updated_desc");

  const { data: experiments = [], isLoading } = useQuery({
    queryKey: ["experiments"],
    queryFn: () => api.get("/experiments/").then(r => r.data.results ?? r.data),
    refetchInterval: 8000,
  });

  const { data: selectedExperiment, isLoading: isDetailLoading } = useQuery({
    queryKey: ["experiment", selectedId],
    queryFn: () => api.get(`/experiments/${selectedId}/`).then(r => r.data),
    enabled: Boolean(selectedId),
  });

  useEffect(() => {
    if (!selectedId && experiments.length > 0) {
      setSelectedId(experiments[0].id);
    }
  }, [experiments, selectedId]);

  const deleteExperiment = useMutation({
    mutationFn: id => api.delete(`/experiments/${id}/`),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["experiments"] });
      qc.removeQueries({ queryKey: ["experiment", id] });
      setSelectedId(curr => curr === id ? null : curr);
      toast.success("實驗已刪除");
    },
    onError: () => toast.error("刪除失敗"),
  });

  const summary = useMemo(() => {
    const done = experiments.filter(e => e.status === "done").length;
    const running = experiments.filter(e => ["running", "queued"].includes(e.status)).length;
    const failed = experiments.filter(e => e.status === "failed").length;
    const draft = experiments.filter(e => e.status === "draft").length;
    const activeTickers = new Set(experiments.map(e => e.ticker).filter(Boolean));
    const completionRate = experiments.length ? Math.round(done / experiments.length * 100) : 0;
    return { done, running, failed, draft, activeTickers: activeTickers.size, completionRate };
  }, [experiments]);

  const filteredExperiments = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    let rows = experiments.filter(exp => {
      const matchesStatus =
        statusFilter === "all" ? true :
        statusFilter === "running" ? ["queued", "running"].includes(exp.status) :
        exp.status === statusFilter;
      if (!matchesStatus) return false;
      if (!keyword) return true;
      const target = [exp.name, exp.description, exp.ticker, exp.benchmark].join(" ").toLowerCase();
      return target.includes(keyword);
    });

    rows = [...rows].sort((a, b) => {
      if (sortBy === "name_asc") return (a.name || "").localeCompare(b.name || "");
      if (sortBy === "name_desc") return (b.name || "").localeCompare(a.name || "");
      if (sortBy === "created_asc") return new Date(a.created_at || 0) - new Date(b.created_at || 0);
      if (sortBy === "created_desc") return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0);
    });
    return rows;
  }, [experiments, search, sortBy, statusFilter]);

  useEffect(() => {
    if (!filteredExperiments.length) return;
    if (!selectedId || !filteredExperiments.some(exp => exp.id === selectedId)) {
      setSelectedId(filteredExperiments[0].id);
    }
  }, [filteredExperiments, selectedId]);

  const spotlight = filteredExperiments[0];
  const latestRun = selectedExperiment?.runs?.[0];

  const activityFeed = useMemo(() => {
    const events = [];
    experiments.forEach(exp => {
      if (exp.updated_at) {
        events.push({
          id: `exp-${exp.id}`,
          title: exp.name,
          subtitle: `${exp.ticker} / ${exp.benchmark}`,
          status: exp.status,
          time: exp.updated_at,
          note:
            exp.status === "done" ? "實驗流程已完成" :
            ["running", "queued"].includes(exp.status) ? "仍在持續更新與訓練" :
            exp.status === "failed" ? "需要重新檢查設定與資料" :
            "實驗草稿可再調整",
        });
      }
      (exp.runs || []).forEach((run, idx) => {
        if (run.status && exp.updated_at) {
          events.push({
            id: `run-${run.id}`,
            title: `${exp.name} · Run ${idx + 1}`,
            subtitle: exp.ticker,
            status: run.status,
            time: run.finished_at || run.started_at || exp.updated_at,
            note:
              run.status === "done" ? "可直接查看回測與預測" :
              run.status === "training" ? "模型仍在訓練中" :
              run.status === "failed" ? "本次執行失敗" :
              "等待新的執行結果",
          });
        }
      });
    });
    return events
      .filter(Boolean)
      .sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0))
      .slice(0, 6);
  }, [experiments]);

  const detailRows = useMemo(() => {
    if (!selectedExperiment) return [];
    return [
      ["股票代碼", selectedExperiment.ticker],
      ["基準指數", selectedExperiment.benchmark],
      ["日期區間", `${selectedExperiment.date_start} → ${selectedExperiment.date_end}`],
      ["特徵數量", `${selectedExperiment.feature_ids?.length ?? 0} 個`],
      ["建立時間", selectedExperiment.created_at ? new Date(selectedExperiment.created_at).toLocaleString("zh-TW") : "—"],
      ["最後更新", selectedExperiment.updated_at ? new Date(selectedExperiment.updated_at).toLocaleString("zh-TW") : "—"],
    ];
  }, [selectedExperiment]);

  const handleDelete = (id, name) => {
    if (window.confirm(`確定要刪除「${name}」嗎？此操作無法復原。`)) {
      deleteExperiment.mutate(id);
    }
  };

  return (
    <div style={{ maxWidth: 1320 }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.25fr) minmax(280px,0.75fr)", gap: 16, marginBottom: 18 }}>
        <div className="card" style={{ padding: "28px 30px", position: "relative", overflow: "hidden", background: "linear-gradient(135deg,rgba(99,102,241,0.18),rgba(15,23,42,0.92) 45%, rgba(11,14,23,1))" }}>
          <div style={{ position: "absolute", top: -50, right: -40, width: 220, height: 220, borderRadius: "50%", background: "radial-gradient(circle, rgba(244,114,182,0.22), transparent 65%)" }} />
          <div style={{ position: "absolute", bottom: -80, left: -20, width: 220, height: 220, borderRadius: "50%", background: "radial-gradient(circle, rgba(56,189,248,0.18), transparent 70%)" }} />
          <div style={{ position: "relative" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 999, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", marginBottom: 16 }}>
              <Sparkles size={13} color="#f9a8d4" />
              <span style={{ fontSize: 11, fontWeight: 700, color: "#f1f5f9", letterSpacing: "0.06em" }}>RESEARCH DESK</span>
            </div>
            <h1 style={{ fontSize: 30, fontWeight: 900, color: "#f8fafc", letterSpacing: "-0.05em", marginBottom: 8 }}>
              {user?.username ?? "Trader"} 的量化工作台
            </h1>
            <p style={{ fontSize: 14, color: "#cbd5e1", maxWidth: 680, lineHeight: 1.7 }}>
              在這裡集中管理實驗、追蹤進度、比對歷史紀錄，並快速切到回測與預測頁。今天的研究節奏可以直接從右側重點與下方活動流開始。
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 20 }}>
              <Link to="/experiment/new" style={heroPrimaryBtn()}>
                <FlaskConical size={14} /> 建立新實驗
              </Link>
              {spotlight && (
                <button onClick={() => setSelectedId(spotlight.id)} style={heroGhostBtn()}>
                  <Eye size={14} /> 聚焦最新實驗
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: "22px 22px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>今日重點</p>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc", letterSpacing: "-0.03em" }}>研究節奏總覽</h2>
            </div>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <BrainCircuit size={18} color="#a5b4fc" />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <SmallInsight title="完成率" value={`${summary.completionRate}%`} tone="#34d399" note="已完成實驗占比" />
            <SmallInsight title="活躍標的" value={summary.activeTickers} tone="#60a5fa" note="不同 ticker 數量" />
            <SmallInsight title="進行中" value={summary.running} tone="#fbbf24" note="包含 queued / running" />
            <SmallInsight title="待整理" value={summary.draft + summary.failed} tone="#fda4af" note="草稿與失敗項目" />
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 18 }}>
        <StatCard label="實驗總數" value={experiments.length} color="#a5b4fc" accent="rgba(99,102,241,0.14)" sub="你的研究資產總量" icon={BarChart3} />
        <StatCard label="已完成" value={summary.done} color="#34d399" accent="rgba(52,211,153,0.16)" sub="已可回看回測與預測" icon={CircleDot} />
        <StatCard label="進行中" value={summary.running} color="#60a5fa" accent="rgba(96,165,250,0.16)" sub="系統會自動輪詢更新" icon={Zap} />
        <StatCard label="失敗 / 草稿" value={`${summary.failed}/${summary.draft}`} color="#fda4af" accent="rgba(248,113,113,0.16)" sub="建議優先整理的項目" icon={TimerReset} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.15fr) minmax(320px,0.85fr)", gap: 16, marginBottom: 18 }}>
        <div className="card" style={{ padding: "20px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>工作區</p>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc", letterSpacing: "-0.03em" }}>所有實驗</h2>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#60a5fa" }}>
              {summary.running > 0 && <><Zap size={12} /> 自動更新中</>}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) 150px 150px", gap: 10, marginBottom: 12 }}>
            <div style={{ position: "relative" }}>
              <Search size={14} color="#64748b" style={{ position: "absolute", left: 12, top: 12 }} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋實驗名稱、描述、ticker、benchmark" className="input-dark" style={{ paddingLeft: 34 }} />
            </div>
            <div style={{ position: "relative" }}>
              <Filter size={13} color="#64748b" style={{ position: "absolute", left: 12, top: 12 }} />
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input-dark" style={{ paddingLeft: 34, appearance: "none" }}>
                {STATUS_FILTERS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
              </select>
            </div>
            <div style={{ position: "relative" }}>
              <SlidersHorizontal size={13} color="#64748b" style={{ position: "absolute", left: 12, top: 12 }} />
              <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="input-dark" style={{ paddingLeft: 34, appearance: "none" }}>
                {SORT_OPTIONS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {STATUS_FILTERS.map(filter => {
              const active = statusFilter === filter.key;
              return (
                <button
                  key={filter.key}
                  onClick={() => setStatusFilter(filter.key)}
                  style={{
                    padding: "7px 12px",
                    borderRadius: 999,
                    border: `1px solid ${active ? "rgba(99,102,241,0.28)" : "rgba(255,255,255,0.07)"}`,
                    background: active ? "rgba(99,102,241,0.14)" : "rgba(255,255,255,0.03)",
                    color: active ? "#c4b5fd" : "#94a3b8",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>

          {isLoading ? (
            <LoadingList />
          ) : filteredExperiments.length === 0 ? (
            <EmptyState search={search} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filteredExperiments.map(exp => (
                <ExperimentRow
                  key={exp.id}
                  exp={exp}
                  selected={exp.id === selectedId}
                  onOpen={() => setSelectedId(exp.id)}
                  onEdit={() => navigate(`/experiment/${exp.id}`)}
                  onDelete={() => handleDelete(exp.id, exp.name)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ padding: "20px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Focus</p>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc", letterSpacing: "-0.03em" }}>重點實驗</h2>
            </div>
            <ArrowUpRight size={16} color="#94a3b8" />
          </div>

          {!spotlight ? (
            <p style={{ fontSize: 13, color: "#64748b" }}>目前沒有可顯示的實驗。</p>
          ) : (
            <>
              <div style={{ padding: "18px 18px 16px", borderRadius: 14, background: "linear-gradient(135deg,rgba(99,102,241,0.14),rgba(255,255,255,0.03))", border: "1px solid rgba(99,102,241,0.16)", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
                  <div>
                    <h3 style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc", letterSpacing: "-0.03em", marginBottom: 6 }}>{spotlight.name}</h3>
                    <p style={{ fontSize: 12, color: "#cbd5e1" }}>{spotlight.ticker} / {spotlight.benchmark}</p>
                  </div>
                  <StatusPill s={spotlight.status} />
                </div>
                <p style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.7, minHeight: 40 }}>
                  {spotlight.description || "這個實驗目前尚未填寫描述，可以從編輯頁補上研究目的或策略假設。"}
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8, marginTop: 14 }}>
                  <SpotlightCell label="最近更新" value={distance(spotlight.updated_at || spotlight.created_at)} />
                  <SpotlightCell label="最新 Run" value={spotlight.runs?.[0]?.status || "尚無"} />
                  <SpotlightCell label="建立時間" value={formatDateShort(spotlight.created_at)} />
                  <SpotlightCell label="詳細檢視" value="已可展開右側內容" />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <button onClick={() => setSelectedId(spotlight.id)} style={accentAction("rgba(255,255,255,0.04)", "#e2e8f0", "rgba(255,255,255,0.08)")}>
                  <Eye size={13} /> 查看詳情
                </button>
                <button onClick={() => navigate(`/experiment/${spotlight.id}`)} style={accentAction("rgba(99,102,241,0.12)", "#c4b5fd", "rgba(99,102,241,0.18)")}>
                  <Pencil size={13} /> 編輯實驗
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(340px,0.9fr) minmax(0,1.1fr)", gap: 16 }}>
        <div className="card" style={{ padding: "20px 22px", position: "sticky", top: 24, alignSelf: "start" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Detail</p>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <h2 style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc", letterSpacing: "-0.03em" }}>{selectedExperiment?.name ?? "實驗詳細內容"}</h2>
                {selectedExperiment?.status && <StatusPill s={selectedExperiment.status} />}
              </div>
            </div>
            {selectedId && (
              <button onClick={() => setSelectedId(null)} style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                <X size={16} color="#64748b" />
              </button>
            )}
          </div>

          {isDetailLoading ? (
            <div style={{ height: 280, borderRadius: 12, background: "rgba(255,255,255,0.03)", animation: "pulse 1.5s infinite" }} />
          ) : !selectedExperiment ? (
            <p style={{ fontSize: 13, color: "#64748b" }}>從左側選擇一個實驗，就能查看詳細資訊與操作入口。</p>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                {detailRows.map(([label, value]) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, paddingBottom: 10, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <span style={{ fontSize: 12, color: "#64748b" }}>{label}</span>
                    <span style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 500, textAlign: "right", fontFamily: "'JetBrains Mono',monospace" }}>{value || "—"}</span>
                  </div>
                ))}
              </div>

              <SectionTitle title="研究描述" icon={Sparkles} />
              <div style={{ padding: "12px 14px", borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", fontSize: 12, color: "#cbd5e1", lineHeight: 1.7, marginBottom: 16 }}>
                {selectedExperiment.description || "尚未填寫描述，建議補上策略假設、模型目標與觀察重點。"}
              </div>

              <SectionTitle title="行動面板" icon={ArrowUpRight} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                <button onClick={() => navigate(`/experiment/${selectedExperiment.id}`)} style={accentAction("rgba(99,102,241,0.12)", "#c4b5fd", "rgba(99,102,241,0.18)")}>
                  <Pencil size={13} /> 編輯
                </button>
                <button onClick={() => handleDelete(selectedExperiment.id, selectedExperiment.name)} style={accentAction("rgba(248,113,113,0.1)", "#fca5a5", "rgba(248,113,113,0.18)")}>
                  <Trash2 size={13} /> 刪除
                </button>
                {latestRun?.status === "done" && (
                  <>
                    <Link to={`/run/${latestRun.id}/backtest`} style={accentLink("rgba(96,165,250,0.1)", "#93c5fd", "rgba(96,165,250,0.2)")}>
                      最新回測
                    </Link>
                    <Link to={`/run/${latestRun.id}/prediction`} style={accentLink("rgba(139,92,246,0.1)", "#c4b5fd", "rgba(139,92,246,0.2)")}>
                      最新預測
                    </Link>
                  </>
                )}
                {latestRun?.status === "training" && (
                  <Link to={`/run/${latestRun.id}/status`} style={accentLink("rgba(245,158,11,0.1)", "#fbbf24", "rgba(245,158,11,0.2)")}>
                    查看訓練狀態
                  </Link>
                )}
              </div>

              <SectionTitle title="Run 歷史" icon={Activity} />
              {!selectedExperiment.runs?.length ? (
                <p style={{ fontSize: 12, color: "#64748b" }}>目前尚無執行紀錄。</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {selectedExperiment.runs.map((run, idx) => (
                    <div key={run.id} style={{ padding: "12px 12px", borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                        <div>
                          <p style={{ fontSize: 12, fontWeight: 700, color: "#f8fafc" }}>{run.model_name || `Run ${idx + 1}`}</p>
                          <p style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>RUN {run.id.slice(0, 8).toUpperCase()}</p>
                        </div>
                        <StatusPill s={run.status === "training" ? "running" : run.status} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 10, fontSize: 11, color: "#94a3b8" }}>
                        <span>Epochs: {run.epochs_done ?? 0}</span>
                        <span>{distance(run.finished_at || run.started_at || selectedExperiment.updated_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateRows: "auto auto", gap: 16 }}>
          <div className="card" style={{ padding: "20px 22px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <p style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Activity</p>
                <h2 style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc", letterSpacing: "-0.03em" }}>近期活動流</h2>
              </div>
              <CalendarRange size={16} color="#94a3b8" />
            </div>
            {activityFeed.length === 0 ? (
              <p style={{ fontSize: 13, color: "#64748b" }}>目前還沒有活動紀錄。</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {activityFeed.map(item => (
                  <div key={item.id} style={{ display: "flex", gap: 12, padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ width: 12, display: "flex", justifyContent: "center", paddingTop: 4 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: (STATUS[item.status] ?? STATUS.draft).dot, boxShadow: `0 0 10px ${(STATUS[item.status] ?? STATUS.draft).dot}` }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                        <p style={{ fontSize: 13, fontWeight: 700, color: "#f8fafc" }}>{item.title}</p>
                        <span style={{ fontSize: 11, color: "#64748b" }}>{distance(item.time)}</span>
                      </div>
                      <p style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>{item.subtitle}</p>
                      <p style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.6 }}>{item.note}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card" style={{ padding: "20px 22px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <p style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Suggestions</p>
                <h2 style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc", letterSpacing: "-0.03em" }}>下一步建議</h2>
              </div>
              <Sparkles size={16} color="#f9a8d4" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
              <SuggestionCard icon={FlaskConical} title="補齊草稿" desc="先處理還沒啟動的研究題目，避免策略想法散掉。" tone="#a5b4fc" action={() => setStatusFilter("draft")} />
              <SuggestionCard icon={Zap} title="盯進行中" desc="優先查看 queued / running，必要時調整設定。" tone="#60a5fa" action={() => setStatusFilter("running")} />
              <SuggestionCard icon={BarChart3} title="回看成果" desc="快速切到最新完成項目，持續累積有效策略。" tone="#34d399" action={() => setStatusFilter("done")} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExperimentRow({ exp, selected, onOpen, onEdit, onDelete }) {
  const latestRun = exp.runs?.[0];
  const ago = distance(exp.updated_at || exp.created_at);
  const statusMeta = STATUS[exp.status] ?? STATUS.draft;

  return (
    <div
      className="card"
      style={{
        padding: "16px 18px",
        transition: "border-color 0.15s, background 0.15s, transform 0.15s",
        cursor: "pointer",
        borderColor: selected ? "rgba(99,102,241,0.32)" : "rgba(255,255,255,0.07)",
        background: selected ? "linear-gradient(135deg,rgba(99,102,241,0.10),rgba(19,25,41,1))" : "#131929",
        transform: selected ? "translateY(-1px)" : "none",
      }}
      onClick={onOpen}
      onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(99,102,241,0.3)"}
      onMouseLeave={e => e.currentTarget.style.borderColor = selected ? "rgba(99,102,241,0.32)" : "rgba(255,255,255,0.07)"}
    >
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ width: 42, height: 42, borderRadius: 14, background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <FlaskConical size={17} color="#818cf8" />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "#f8fafc" }}>{exp.name}</span>
                <StatusPill s={exp.status} />
              </div>
              <p style={{ fontSize: 12, color: "#94a3b8" }}>{exp.ticker} / {exp.benchmark}</p>
            </div>
            <div style={{ fontSize: 11, color: "#64748b", display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
              <Clock3 size={11} />
              {ago}
            </div>
          </div>

          <p style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.6, marginBottom: 12 }} className="line-clamp-2">
            {exp.description || "尚未填寫描述，可補充研究假設、數據範圍或觀察目標。"}
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr 1fr", gap: 10, marginBottom: 12 }}>
            <MiniMetric label="狀態信號" value={statusMeta.label} tone={statusMeta.color} />
            <MiniMetric label="最新 Run" value={latestRun?.status || "尚無"} tone="#e2e8f0" />
            <MiniMetric label="最近更新" value={formatDateShort(exp.updated_at || exp.created_at)} tone="#cbd5e1" />
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} onClick={e => e.stopPropagation()}>
            <button onClick={onOpen} style={actionBtn("rgba(255,255,255,0.05)", "#e2e8f0", "rgba(255,255,255,0.08)")}>
              <Eye size={12} /> 詳情
            </button>
            <button onClick={onEdit} style={actionBtn("rgba(99,102,241,0.12)", "#c4b5fd", "rgba(99,102,241,0.18)")}>
              <Pencil size={12} /> 編輯
            </button>
            <button onClick={onDelete} style={actionBtn("rgba(248,113,113,0.1)", "#fca5a5", "rgba(248,113,113,0.18)")}>
              <Trash2 size={12} /> 刪除
            </button>
            {latestRun?.status === "done" && (
              <>
                <Link to={`/run/${latestRun.id}/backtest`} style={actionLink("rgba(96,165,250,0.1)", "#93c5fd", "rgba(96,165,250,0.2)")}>
                  回測
                </Link>
                <Link to={`/run/${latestRun.id}/prediction`} style={actionLink("rgba(139,92,246,0.1)", "#c4b5fd", "rgba(139,92,246,0.2)")}>
                  預測
                </Link>
              </>
            )}
            {latestRun?.status === "training" && (
              <Link to={`/run/${latestRun.id}/status`} style={actionLink("rgba(245,158,11,0.1)", "#fbbf24", "rgba(245,158,11,0.2)")}>
                訓練中
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
