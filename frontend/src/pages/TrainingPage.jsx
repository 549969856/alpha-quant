import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const STATUS_CFG = {
  pending:  { label:"等待中",  color:"#9ca3af", pulse:false },
  training: { label:"訓練中",  color:"#60a5fa", pulse:true  },
  done:     { label:"完成",    color:"#34d399", pulse:false },
  failed:   { label:"失敗",    color:"#f87171", pulse:false },
};

const CustomTooltip = ({active,payload,label})=>active&&payload?.length?(
  <div style={{background:"#1e293b",border:"1px solid rgba(255,255,255,0.08)",borderRadius:8,padding:"8px 12px",fontSize:11}}>
    <p style={{color:"#64748b",marginBottom:4}}>Epoch {label}</p>
    <p style={{color:"#a5b4fc",fontWeight:600,fontFamily:"'JetBrains Mono',monospace"}}>{payload[0]?.value?.toFixed(4)}</p>
  </div>
):null;

export default function TrainingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [pendingSeconds, setPendingSeconds] = useState(0);

  const {
    data: run,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["run-status", id],
    queryFn:  ()=>api.get(`/runs/${id}/status/`).then(r=>r.data),
    refetchInterval: (query)=>{
      const s = query.state.data?.status;
      return (s === "training" || s === "pending") ? 2000 : false;
    },
  });

  useEffect(()=>{
    if(run?.status==="done") { const t=setTimeout(()=>navigate(`/run/${id}/backtest`),1800); return()=>clearTimeout(t); }
  },[run?.status]);

  useEffect(()=>{
    if(run?.status !== "pending") { setPendingSeconds(0); return; }
    const t = setInterval(()=>setPendingSeconds(s=>s+1), 1000);
    return ()=>clearInterval(t);
  },[run?.status]);

  const cfg     = STATUS_CFG[run?.status??"pending"];
  const losses  = (run?.loss_history??[]).map((l,i)=>typeof l==="object"?l:{epoch:i+1,loss:l});
  const pct     = run?.status === "done" ? 100 : run?.epochs_done ? 2 : 0;
  const minLoss = losses.length ? Math.min(...losses.map(l=>l.loss)) : 0;
  const latestLoss = losses.length ? losses[losses.length-1]?.loss : null;
  const showPendingHint = run?.status === "pending" && pendingSeconds >= 20;
  const diag = useMemo(()=>{
    if(!run) return null;
    return {
      model: run?.model_arch?.display_name || run?.model_arch?.arch,
      task: run?.celery_task_id,
      expStatus: run?.experiment?.status,
    };
  },[run]);

  return (
    <div style={{maxWidth:640}}>
      <div style={{marginBottom:28}}>
        <h1 style={{fontSize:22,fontWeight:800,color:"#f1f5f9",letterSpacing:"-0.02em"}}>⚙️ 模型訓練</h1>
        <p style={{fontSize:12,color:"#475569",marginTop:4,fontFamily:"'JetBrains Mono',monospace"}}>RUN {id?.slice(0,8).toUpperCase()}…</p>
      </div>

      {/* Status card */}
      <div className="card" style={{padding:28,marginBottom:16}}>
        {isLoading && (
          <div style={{fontSize:12,color:"#94a3b8"}}>
            載入訓練狀態中…
          </div>
        )}
        {isError && (
          <div style={{marginBottom:12,padding:12,background:"rgba(248,113,113,0.08)",borderRadius:8,border:"1px solid rgba(248,113,113,0.2)",fontSize:12,color:"#fca5a5"}}>
            無法取得訓練狀態。{error?.message ? `錯誤：${error.message}` : ""}
          </div>
        )}
        {showPendingHint && (
          <div style={{marginBottom:12,padding:12,background:"rgba(245,158,11,0.08)",borderRadius:8,border:"1px solid rgba(245,158,11,0.22)",fontSize:12,color:"#fbbf24"}}>
            已等待 {pendingSeconds}s 仍在排隊。若持續很久，通常是背景訓練 worker 沒啟動或 Redis/Celery 連線異常。
          </div>
        )}
        {/* Status header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:24}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{
              width:10,height:10,borderRadius:"50%",background:cfg.color,
              boxShadow:`0 0 8px ${cfg.color}`,
              animation: cfg.pulse?"pulse 1.5s infinite":undefined,
            }}/>
            <span style={{fontSize:16,fontWeight:700,color:cfg.color}}>{cfg.label}</span>
          </div>
          <span style={{fontSize:12,color:"#475569",fontFamily:"'JetBrains Mono',monospace"}}>{pct}%</span>
        </div>

        {diag && (
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:18}}>
            <div style={{background:"rgba(255,255,255,0.02)",borderRadius:8,padding:"10px 12px",border:"1px solid rgba(255,255,255,0.05)"}}>
              <p style={{fontSize:10,color:"#475569",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4,fontWeight:600}}>Model</p>
              <p style={{fontSize:12,color:"#cbd5e1",fontFamily:"'JetBrains Mono',monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{diag.model || "-"}</p>
            </div>
            <div style={{background:"rgba(255,255,255,0.02)",borderRadius:8,padding:"10px 12px",border:"1px solid rgba(255,255,255,0.05)"}}>
              <p style={{fontSize:10,color:"#475569",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4,fontWeight:600}}>Task</p>
              <p style={{fontSize:12,color:"#cbd5e1",fontFamily:"'JetBrains Mono',monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{diag.task || "-"}</p>
            </div>
          </div>
        )}

        {/* Progress bar */}
        <div style={{height:6,background:"rgba(255,255,255,0.05)",borderRadius:99,overflow:"hidden",marginBottom:8}}>
          <div style={{
            height:"100%",borderRadius:99,transition:"width 0.5s ease",
            width:`${Math.max(2,pct)}%`,
            background:"linear-gradient(90deg,#6366f1,#8b5cf6)",
            boxShadow:"0 0 12px rgba(99,102,241,0.5)",
          }}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#475569",marginBottom:24}}>
          <span>Epoch {run?.epochs_done??0}</span>
          {latestLoss!==null && <span style={{fontFamily:"'JetBrains Mono',monospace"}}>Loss: {latestLoss?.toFixed(4)}</span>}
        </div>

        {/* Loss chart */}
        {losses.length>1 && (
          <div>
            <p style={{fontSize:11,color:"#475569",textTransform:"uppercase",letterSpacing:"0.07em",fontWeight:600,marginBottom:12}}>Alpha Loss 訓練曲線</p>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={losses} margin={{top:4,right:4,bottom:0,left:-20}}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)"/>
                <XAxis dataKey="epoch" tick={{fontSize:10,fill:"#4b5563"}}/>
                <YAxis tick={{fontSize:10,fill:"#4b5563"}} tickFormatter={v=>v.toFixed(3)}/>
                <Tooltip content={<CustomTooltip/>}/>
                <Line type="monotone" dataKey="loss" stroke="#6366f1" strokeWidth={2} dot={false} name="Loss"
                  style={{filter:"drop-shadow(0 0 4px rgba(99,102,241,0.5))"}}/>
              </LineChart>
            </ResponsiveContainer>
            {losses.length>1 && (
              <div style={{display:"flex",gap:16,marginTop:12}}>
                <div style={{flex:1,background:"rgba(255,255,255,0.02)",borderRadius:8,padding:"10px 14px"}}>
                  <p style={{fontSize:10,color:"#475569",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4}}>最佳 Loss</p>
                  <p style={{fontSize:16,fontWeight:700,color:"#34d399",fontFamily:"'JetBrains Mono',monospace"}}>{minLoss.toFixed(4)}</p>
                </div>
                <div style={{flex:1,background:"rgba(255,255,255,0.02)",borderRadius:8,padding:"10px 14px"}}>
                  <p style={{fontSize:10,color:"#475569",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4}}>最新 Loss</p>
                  <p style={{fontSize:16,fontWeight:700,color:"#a5b4fc",fontFamily:"'JetBrains Mono',monospace"}}>{latestLoss?.toFixed(4)}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* States */}
        {run?.status==="failed" && (
          <div style={{marginTop:16,padding:12,background:"rgba(248,113,113,0.08)",borderRadius:8,border:"1px solid rgba(248,113,113,0.2)",fontSize:12,color:"#fca5a5"}}>
            ❌ 錯誤：{run.error_msg}
          </div>
        )}
        {run?.status==="done" && (
          <div style={{marginTop:16,padding:12,background:"rgba(52,211,153,0.08)",borderRadius:8,border:"1px solid rgba(52,211,153,0.2)",fontSize:12,color:"#6ee7b7",textAlign:"center"}}>
            ✅ 訓練完成！正在跳轉至回測報告…
          </div>
        )}
      </div>
    </div>
  );
}
