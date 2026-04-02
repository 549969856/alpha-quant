import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/authStore";
import { FlaskConical, ChevronRight, TrendingUp, TrendingDown, Minus, Clock, Zap } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { zhTW } from "date-fns/locale";

const STATUS = {
  draft:   { dot:"#6b7280", label:"草稿",   bg:"rgba(107,114,128,0.12)", color:"#9ca3af" },
  queued:  { dot:"#f59e0b", label:"排隊中", bg:"rgba(245,158,11,0.12)",  color:"#fbbf24" },
  running: { dot:"#60a5fa", label:"訓練中", bg:"rgba(96,165,250,0.12)",  color:"#93c5fd" },
  done:    { dot:"#34d399", label:"完成",   bg:"rgba(52,211,153,0.12)",  color:"#6ee7b7" },
  failed:  { dot:"#f87171", label:"失敗",   bg:"rgba(248,113,113,0.12)", color:"#fca5a5" },
};

function StatusPill({ s }) {
  const c = STATUS[s] ?? STATUS.draft;
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:5,padding:"3px 8px",borderRadius:6,fontSize:11,fontWeight:500,background:c.bg,color:c.color}}>
      <span style={{width:5,height:5,borderRadius:"50%",background:c.dot,boxShadow:`0 0 5px ${c.dot}`}} />
      {c.label}
    </span>
  );
}

function StatCard({ label, value, color="#a5b4fc" }) {
  return (
    <div className="card" style={{padding:"20px 24px"}}>
      <p style={{fontSize:10,fontWeight:600,color:"#475569",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>{label}</p>
      <p style={{fontSize:28,fontWeight:800,color,letterSpacing:"-0.03em",fontFamily:"'JetBrains Mono',monospace"}}>{value}</p>
    </div>
  );
}

export default function DashboardPage() {
  const user = useAuthStore(s => s.user);
  const { data: experiments = [], isLoading } = useQuery({
    queryKey: ["experiments"],
    queryFn: () => api.get("/experiments/").then(r => r.data.results ?? r.data),
    refetchInterval: 8000,
  });

  const done    = experiments.filter(e => e.status === "done").length;
  const running = experiments.filter(e => ["running","queued"].includes(e.status)).length;
  const failed  = experiments.filter(e => e.status === "failed").length;

  return (
    <div style={{maxWidth:1100}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:32}}>
        <div>
          <h1 style={{fontSize:26,fontWeight:800,color:"#f1f5f9",letterSpacing:"-0.03em",marginBottom:4}}>
            早安，{user?.username ?? "Trader"} 👋
          </h1>
          <p style={{fontSize:13,color:"#475569"}}>量化實驗管理中心 · {new Date().toLocaleDateString("zh-TW",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</p>
        </div>
        <Link to="/experiment/new" style={{
          display:"flex",alignItems:"center",gap:8,padding:"10px 18px",borderRadius:10,
          background:"linear-gradient(135deg,#6366f1,#8b5cf6)",color:"#fff",
          fontSize:13,fontWeight:600,textDecoration:"none",transition:"opacity 0.15s",
        }}
          onMouseEnter={e=>e.currentTarget.style.opacity="0.85"}
          onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
          <FlaskConical size={15}/>新建實驗
        </Link>
      </div>

      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:32}}>
        <StatCard label="實驗總數"  value={experiments.length} color="#a5b4fc" />
        <StatCard label="已完成"   value={done}    color="#34d399" />
        <StatCard label="訓練中"   value={running} color="#60a5fa" />
        <StatCard label="失敗"     value={failed}  color="#f87171" />
      </div>

      {/* Experiments */}
      <div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <h2 style={{fontSize:14,fontWeight:600,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.06em"}}>所有實驗</h2>
          {running > 0 && (
            <span style={{fontSize:11,color:"#60a5fa",display:"flex",alignItems:"center",gap:5}}>
              <Zap size={11}/> 自動更新中
            </span>
          )}
        </div>

        {isLoading ? (
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {[1,2,3].map(i=>(
              <div key={i} style={{height:88,borderRadius:12,background:"#131929",border:"1px solid rgba(255,255,255,0.05)",animation:"pulse 1.5s infinite"}} />
            ))}
          </div>
        ) : experiments.length === 0 ? (
          <div style={{textAlign:"center",padding:"60px 0",background:"#131929",borderRadius:12,border:"1px dashed rgba(255,255,255,0.08)"}}>
            <FlaskConical size={32} color="#374151" style={{margin:"0 auto 12px"}} />
            <p style={{color:"#4b5563",fontSize:14}}>尚無實驗</p>
            <p style={{color:"#374151",fontSize:12,marginTop:4}}>點擊右上角「新建實驗」開始你的第一個實驗</p>
          </div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {experiments.map(exp => <ExperimentRow key={exp.id} exp={exp} />)}
          </div>
        )}
      </div>

      {/* Quick guide */}
      <div style={{marginTop:40,background:"linear-gradient(135deg,rgba(99,102,241,0.12),rgba(139,92,246,0.08))",border:"1px solid rgba(99,102,241,0.2)",borderRadius:14,padding:"24px 28px"}}>
        <p style={{fontSize:13,fontWeight:600,color:"#a5b4fc",marginBottom:16}}>🧭 使用流程</p>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
          {[
            ["1","選股設定",    "股票代碼與日期範圍"],
            ["2","特徵組合",    "從特徵庫選擇或載入預設"],
            ["3","模型訓練",    "Transformer / LSTM / XGBoost…"],
            ["4","報告預測",    "回測績效 + 明日操作建議"],
          ].map(([n,t,d]) => (
            <div key={n} style={{background:"rgba(255,255,255,0.04)",borderRadius:10,padding:"14px 16px"}}>
              <p style={{fontSize:11,color:"#6366f1",fontWeight:700,marginBottom:4}}>STEP {n}</p>
              <p style={{fontSize:13,fontWeight:600,color:"#e2e8f0",marginBottom:2}}>{t}</p>
              <p style={{fontSize:11,color:"#475569"}}>{d}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ExperimentRow({ exp }) {
  const latestRun = exp.runs?.[0];
  const ago = exp.created_at
    ? formatDistanceToNow(new Date(exp.created_at),{locale:zhTW,addSuffix:true}) : "";

  return (
    <div className="card" style={{padding:"16px 20px",transition:"border-color 0.15s",cursor:"default"}}
      onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(99,102,241,0.3)"}
      onMouseLeave={e=>e.currentTarget.style.borderColor="rgba(255,255,255,0.07)"}>
      <div style={{display:"flex",alignItems:"center",gap:16}}>
        {/* Icon */}
        <div style={{width:38,height:38,borderRadius:10,background:"rgba(99,102,241,0.1)",border:"1px solid rgba(99,102,241,0.2)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          <FlaskConical size={16} color="#818cf8" />
        </div>
        {/* Info */}
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
            <span style={{fontSize:14,fontWeight:600,color:"#e2e8f0"}}>{exp.name}</span>
            <StatusPill s={exp.status} />
          </div>
          <div style={{display:"flex",gap:16,fontSize:11,color:"#475569"}}>
            <span>{exp.ticker} / {exp.benchmark}</span>
            <span style={{display:"flex",alignItems:"center",gap:4}}><Clock size={10}/>{ago}</span>
          </div>
        </div>
        {/* Actions */}
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          {latestRun?.status==="done" && <>
            <Link to={`/run/${latestRun.id}/backtest`}
              style={{padding:"6px 12px",borderRadius:7,fontSize:12,fontWeight:500,background:"rgba(96,165,250,0.1)",color:"#93c5fd",textDecoration:"none",border:"1px solid rgba(96,165,250,0.2)"}}>
              📊 回測
            </Link>
            <Link to={`/run/${latestRun.id}/prediction`}
              style={{padding:"6px 12px",borderRadius:7,fontSize:12,fontWeight:500,background:"rgba(139,92,246,0.1)",color:"#c4b5fd",textDecoration:"none",border:"1px solid rgba(139,92,246,0.2)"}}>
              🔮 預測
            </Link>
          </>}
          {latestRun?.status==="training" && (
            <Link to={`/run/${latestRun.id}/status`}
              style={{padding:"6px 12px",borderRadius:7,fontSize:12,fontWeight:500,background:"rgba(245,158,11,0.1)",color:"#fbbf24",textDecoration:"none",border:"1px solid rgba(245,158,11,0.2)"}}>
              ⚙️ 訓練中…
            </Link>
          )}
          <ChevronRight size={14} color="#374151" />
        </div>
      </div>
    </div>
  );
}
