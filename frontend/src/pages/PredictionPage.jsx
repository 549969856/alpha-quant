import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, ShieldAlert } from "lucide-react";

const SIG = {
  LONG:    { label:"做多 LONG",  Icon:TrendingUp,   color:"#34d399", bg:"rgba(52,211,153,0.08)", border:"rgba(52,211,153,0.25)" },
  SHORT:   { label:"做空 SHORT", Icon:TrendingDown, color:"#f87171", bg:"rgba(248,113,113,0.08)",border:"rgba(248,113,113,0.25)" },
  NEUTRAL: { label:"觀望 NEUTRAL",Icon:Minus,       color:"#94a3b8", bg:"rgba(148,163,184,0.06)",border:"rgba(148,163,184,0.15)" },
};

function ProbBar({label, value, color, isMax}) {
  return (
    <div style={{marginBottom:12}}>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:5}}>
        <span style={{color:"#64748b"}}>{label}</span>
        <span style={{fontWeight:700,color: isMax?color:"#94a3b8",fontFamily:"'JetBrains Mono',monospace"}}>{(value*100).toFixed(1)}%</span>
      </div>
      <div style={{height:6,background:"rgba(255,255,255,0.05)",borderRadius:99,overflow:"hidden"}}>
        <div style={{
          height:"100%",borderRadius:99,width:`${(value*100).toFixed(1)}%`,
          background: isMax?color:"rgba(255,255,255,0.1)",
          transition:"width 0.8s ease",
          boxShadow: isMax?`0 0 8px ${color}50`:"none",
        }}/>
      </div>
    </div>
  );
}

function InfoRow({label, value, valueStyle={}}) {
  return (
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
      <span style={{fontSize:12,color:"#475569"}}>{label}</span>
      <span style={{fontSize:12,fontWeight:600,fontFamily:"'JetBrains Mono',monospace",...valueStyle}}>{value??"-"}</span>
    </div>
  );
}

export default function PredictionPage() {
  const { id } = useParams();
  const { data: pred, isLoading } = useQuery({
    queryKey:["prediction",id],
    queryFn:()=>api.get(`/runs/${id}/prediction/`).then(r=>r.data),
    refetchInterval: p=>!p?4000:false,
  });

  if(isLoading) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:300}}>
      <div style={{width:36,height:36,borderRadius:"50%",border:"3px solid rgba(99,102,241,0.2)",borderTop:"3px solid #6366f1",animation:"spin 0.8s linear infinite"}}/>
    </div>
  );

  if(!pred) return <p style={{color:"#f87171",padding:20}}>預測尚未生成，請先完成訓練。</p>;

  const cfg  = SIG[pred.signal]??SIG.NEUTRAL;
  const {Icon} = cfg;
  const maxP = Math.max(pred.prob_long,pred.prob_short,pred.prob_neutral);

  const rsiColor = pred.rsi_14>70?"#f59e0b":pred.rsi_14<30?"#60a5fa":"#34d399";
  const rsiNote  = pred.rsi_14>70?"⚠ 超買":pred.rsi_14<30?"⚠ 超賣":"✓ 中性";
  const riskLevel= pred.vol_ann>40?"高風險 🔴":pred.vol_ann>25?"中風險 🟡":"低風險 🟢";

  return (
    <div style={{maxWidth:640}}>
      {/* Header */}
      <div style={{marginBottom:28}}>
        <h1 style={{fontSize:22,fontWeight:800,color:"#f1f5f9",letterSpacing:"-0.02em"}}>🔮 明日操作建議</h1>
        <p style={{fontSize:12,color:"#475569",marginTop:4}}>
          基於 {pred.prediction_date} 資料 · 建議目標日 <span style={{color:"#a5b4fc",fontFamily:"'JetBrains Mono',monospace"}}>{pred.target_date}</span>
        </p>
      </div>

      {/* Signal hero */}
      <div style={{border:`1px solid ${cfg.border}`,background:cfg.bg,borderRadius:16,padding:"32px 28px",textAlign:"center",marginBottom:16,position:"relative",overflow:"hidden"}}>
        {/* Glow */}
        <div style={{position:"absolute",top:-40,left:"50%",transform:"translateX(-50%)",width:200,height:200,borderRadius:"50%",background:`radial-gradient(circle,${cfg.color}15 0%,transparent 70%)`,pointerEvents:"none"}}/>

        <div style={{width:56,height:56,borderRadius:16,background:cfg.bg,border:`1px solid ${cfg.border}`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px",position:"relative"}}>
          <Icon size={24} color={cfg.color}/>
        </div>
        <p style={{fontSize:11,color:"#475569",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8}}>模型訊號</p>
        <h2 style={{fontSize:32,fontWeight:900,color:cfg.color,letterSpacing:"-0.03em",margin:"0 0 12px",fontFamily:"'JetBrains Mono',monospace"}}>
          {cfg.label}
        </h2>
        <div style={{display:"inline-flex",alignItems:"center",gap:6,padding:"6px 16px",borderRadius:20,background:`${cfg.color}18`,border:`1px solid ${cfg.color}30`}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:cfg.color,boxShadow:`0 0 6px ${cfg.color}`}}/>
          <span style={{fontSize:13,fontWeight:700,color:cfg.color,fontFamily:"'JetBrains Mono',monospace"}}>
            信心度 {pred.confidence.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Probability breakdown */}
      <div className="card" style={{padding:24,marginBottom:12}}>
        <p style={{fontSize:11,color:"#475569",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600,marginBottom:16}}>機率分解</p>
        <ProbBar label="🟢 做多 LONG"    value={pred.prob_long}    color="#34d399" isMax={pred.prob_long===maxP}/>
        <ProbBar label="⚪ 觀望 NEUTRAL"  value={pred.prob_neutral} color="#94a3b8" isMax={pred.prob_neutral===maxP}/>
        <ProbBar label="🔴 做空 SHORT"   value={pred.prob_short}   color="#f87171" isMax={pred.prob_short===maxP}/>
        <p style={{fontSize:10,color:"#374151",marginTop:8}}>* 超過信心門檻的最大方向觸發訊號</p>
      </div>

      {/* Market context */}
      <div className="card" style={{padding:24,marginBottom:12}}>
        <p style={{fontSize:11,color:"#475569",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600,marginBottom:4}}>市場狀態</p>
        <InfoRow label="RSI(14)" value={`${pred.rsi_14?.toFixed(1)}  ${rsiNote}`} valueStyle={{color:rsiColor}}/>
        <InfoRow label="年化波動率" value={`${pred.vol_ann?.toFixed(1)}%  (${riskLevel})`} valueStyle={{color:pred.vol_ann>40?"#f87171":pred.vol_ann>25?"#f59e0b":"#34d399"}}/>
        <InfoRow label="今日超額報酬" value={`${pred.excess_ret>0?"+":""}${pred.excess_ret?.toFixed(3)}%`} valueStyle={{color:pred.excess_ret>=0?"#34d399":"#f87171"}}/>
      </div>

      {/* Risk management */}
      <div className="card" style={{padding:24,marginBottom:16}}>
        <p style={{fontSize:11,color:"#475569",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600,marginBottom:16}}>風險管理建議（2σ / 3σ ATR）</p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
          <div style={{background:"rgba(248,113,113,0.06)",border:"1px solid rgba(248,113,113,0.15)",borderRadius:10,padding:"16px 20px",textAlign:"center"}}>
            <p style={{fontSize:10,color:"#f87171",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>止損線</p>
            <p style={{fontSize:26,fontWeight:900,color:"#f87171",fontFamily:"'JetBrains Mono',monospace"}}>-{pred.stop_loss_pct?.toFixed(2)}%</p>
            <p style={{fontSize:10,color:"#475569",marginTop:4}}>低於此點位離場</p>
          </div>
          <div style={{background:"rgba(52,211,153,0.06)",border:"1px solid rgba(52,211,153,0.15)",borderRadius:10,padding:"16px 20px",textAlign:"center"}}>
            <p style={{fontSize:10,color:"#34d399",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>目標線</p>
            <p style={{fontSize:26,fontWeight:900,color:"#34d399",fontFamily:"'JetBrains Mono',monospace"}}>+{pred.target_pct?.toFixed(2)}%</p>
            <p style={{fontSize:10,color:"#475569",marginTop:4}}>達到可考慮減碼</p>
          </div>
        </div>
        <div style={{display:"flex",gap:10,padding:12,background:"rgba(245,158,11,0.06)",borderRadius:8,border:"1px solid rgba(245,158,11,0.15)"}}>
          <AlertTriangle size={14} color="#f59e0b" style={{flexShrink:0,marginTop:1}}/>
          <p style={{fontSize:11,color:"#92400e",lineHeight:1.5}}>
            本預測僅供量化研究參考，不構成任何投資建議。市場存在不可預測風險，請自行評估後決策，操作風險自負。
          </p>
        </div>
      </div>

      {/* Nav */}
      <div style={{display:"flex",gap:10}}>
        <Link to={`/run/${id}/backtest`}
          style={{flex:1,textAlign:"center",padding:"11px 0",borderRadius:9,border:"1px solid rgba(255,255,255,0.07)",color:"#64748b",fontSize:13,fontWeight:500,textDecoration:"none",background:"rgba(255,255,255,0.02)"}}>
          ← 回測報告
        </Link>
        <Link to="/"
          style={{flex:1,textAlign:"center",padding:"11px 0",borderRadius:9,background:"rgba(99,102,241,0.12)",border:"1px solid rgba(99,102,241,0.25)",color:"#a5b4fc",fontSize:13,fontWeight:600,textDecoration:"none"}}>
          回首頁
        </Link>
      </div>
    </div>
  );
}
