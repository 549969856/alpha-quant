import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { api } from "../api/client";
import FeatureSelector from "../components/forms/FeatureSelector";
import toast from "react-hot-toast";
import { Check } from "lucide-react";

const STEPS = ["基本設定","特徵選擇","模型架構","啟動訓練"];

function StepBar({ step }) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:0,marginBottom:32}}>
      {STEPS.map((label,i)=>{
        const done   = step > i;
        const active = step === i;
        return (
          <div key={i} style={{display:"flex",alignItems:"center",flex: i<STEPS.length-1?"1":"none"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
              <div style={{
                width:28,height:28,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",
                fontSize:12,fontWeight:700,transition:"all 0.2s",
                background: done?"#6366f1":active?"rgba(99,102,241,0.2)":"rgba(255,255,255,0.05)",
                border: active?"2px solid #6366f1":"2px solid transparent",
                color: done?"#fff":active?"#a5b4fc":"#475569",
              }}>
                {done ? <Check size={12} strokeWidth={3}/> : i+1}
              </div>
              <span style={{fontSize:12,fontWeight:active?600:400,color:active?"#e2e8f0":done?"#6366f1":"#475569",whiteSpace:"nowrap"}}>
                {label}
              </span>
            </div>
            {i<STEPS.length-1 && (
              <div style={{flex:1,height:1,margin:"0 12px",background: step>i?"#6366f1":"rgba(255,255,255,0.06)"}} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label style={{display:"block",fontSize:11,fontWeight:600,color:"#475569",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:6}}>
        {label}
      </label>
      {children}
    </div>
  );
}

export default function ExperimentPage() {
  const navigate = useNavigate();
  const [step, setStep]         = useState(0);
  const [features, setFeatures] = useState([]);
  const [selectedArch, setArch] = useState(null);
  const [hparams, setHparams]   = useState({});
  const [expId, setExpId]       = useState(null);

  const { register, handleSubmit, watch } = useForm({
    defaultValues:{ ticker:"2603.TW",benchmark:"0050.TW",date_start:"2020-01-01",date_end:"2026-03-27",name:"",description:"", transaction_cost:0.002 },
  });

  const { data: models = [] } = useQuery({
    queryKey:["models"],
    queryFn:()=>api.get("/models/").then(r=>r.data),
  });

  const createExp = useMutation({
    mutationFn: body=>api.post("/experiments/",body),
    onSuccess: d=>{ setExpId(d.data.id); setStep(1); },
    onError: ()=>toast.error("建立失敗"),
  });
  const launchTrain = useMutation({
    mutationFn:({id,body})=>api.post(`/experiments/${id}/train/`,body),
    onSuccess: d=>{ toast.success("🚀 訓練已啟動"); navigate(`/run/${d.data.run_id}/status`); },
    onError:()=>toast.error("啟動失敗"),
  });

  const onStep0 = handleSubmit(data=>createExp.mutate({...data,feature_ids:[]}));
  const onStep1 = ()=>{ if(features.length<2){toast.error("請至少選擇 2 個特徵"); return;} api.patch(`/experiments/${expId}/`,{feature_ids:features}); setStep(2); };
  const onStep2 = ()=>{
    if(!selectedArch){toast.error("請選擇模型"); return;}
    const a=models.find(m=>m.id===selectedArch);
    const tx = Number(watch("transaction_cost"));
    setHparams({...a.default_hparams, transaction_cost: Number.isFinite(tx) ? tx : 0.002});
    setStep(3);
  };
  const onLaunch = ()=>launchTrain.mutate({id:expId,body:{model_arch_id:selectedArch,hparams}});

  const S = {
    card:     {background:"#131929",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,padding:28},
    nextBtn:  {width:"100%",padding:"12px 0",borderRadius:9,fontSize:14,fontWeight:600,color:"#fff",border:"none",cursor:"pointer",background:"linear-gradient(135deg,#6366f1,#8b5cf6)"},
    infoRow:  {display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"},
  };

  return (
    <div style={{maxWidth:780}}>
      <div style={{marginBottom:28}}>
        <h1 style={{fontSize:22,fontWeight:800,color:"#f1f5f9",letterSpacing:"-0.02em"}}>🧪 新建實驗</h1>
        <p style={{fontSize:13,color:"#475569",marginTop:4}}>四步驟完成模型訓練與策略回測</p>
      </div>

      <StepBar step={step} />

      {/* Step 0 */}
      {step===0 && (
        <div style={S.card}>
          <p style={{fontSize:13,fontWeight:600,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:20}}>📌 基本設定</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
            <Field label="實驗名稱">
              <input {...register("name",{required:true})} placeholder="e.g. 長榮裸K測試" className="input-dark" />
            </Field>
            <Field label="描述（選填）">
              <input {...register("description")} placeholder="簡短說明" className="input-dark" />
            </Field>
            <Field label="股票代碼">
              <input {...register("ticker")} className="input-dark" />
            </Field>
            <Field label="基準指數">
              <input {...register("benchmark")} className="input-dark" />
            </Field>
            <Field label="開始日期">
              <input type="date" {...register("date_start")} className="input-dark" />
            </Field>
            <Field label="結束日期">
              <input type="date" {...register("date_end")} className="input-dark" />
            </Field>
            <Field label="交易手續費率">
              <input type="number" step="0.0001" min="0" {...register("transaction_cost")} className="input-dark" />
            </Field>
          </div>
          <div style={{marginTop:24}}>
            <button onClick={onStep0} disabled={createExp.isPending} style={S.nextBtn}>
              {createExp.isPending?"建立中…":"下一步 →"}
            </button>
          </div>
        </div>
      )}

      {/* Step 1 */}
      {step===1 && (
        <div style={S.card}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
            <p style={{fontSize:13,fontWeight:600,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.06em"}}>🧩 特徵選擇</p>
            <span style={{fontSize:12,color:features.length>=2?"#34d399":"#f59e0b",fontWeight:500}}>
              已選 {features.length} 個{features.length<2?" (至少2個)":""}
            </span>
          </div>
          <FeatureSelector value={features} onChange={setFeatures} />
          <div style={{marginTop:20}}>
            <button onClick={onStep1} style={S.nextBtn}>下一步 →</button>
          </div>
        </div>
      )}

      {/* Step 2 */}
      {step===2 && (
        <div style={S.card}>
          <p style={{fontSize:13,fontWeight:600,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:20}}>🤖 選擇模型架構</p>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:20}}>
            {models.map(m=>{
              const sel = selectedArch===m.id;
              return (
                <button key={m.id} onClick={()=>setArch(m.id)} style={{
                  padding:"14px 12px",borderRadius:10,border:`1px solid ${sel?"rgba(99,102,241,0.5)":"rgba(255,255,255,0.06)"}`,
                  background: sel?"rgba(99,102,241,0.08)":"rgba(255,255,255,0.02)",
                  cursor:"pointer",textAlign:"left",transition:"all 0.15s",
                }}>
                  <p style={{fontSize:13,fontWeight:600,color: sel?"#a5b4fc":"#cbd5e1",marginBottom:4}}>{m.display_name}</p>
                  <p style={{fontSize:11,color:"#475569",lineHeight:1.5}} className="line-clamp-2">{m.description}</p>
                </button>
              );
            })}
          </div>
          {selectedArch && (
            <div style={{background:"rgba(255,255,255,0.02)",borderRadius:10,padding:16,border:"1px solid rgba(255,255,255,0.05)"}}>
              <p style={{fontSize:11,color:"#475569",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:12}}>超參數調整</p>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
                {Object.entries(hparams).map(([k,v])=>(
                  <div key={k}>
                    <label style={{display:"block",fontSize:10,color:"#475569",marginBottom:4,fontFamily:"'JetBrains Mono',monospace"}}>{k}</label>
                    <input type="number" value={v} onChange={e=>setHparams(h=>({...h,[k]:+e.target.value}))}
                      className="input-dark" style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12}} />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{marginTop:20}}><button onClick={onStep2} style={S.nextBtn}>下一步 →</button></div>
        </div>
      )}

      {/* Step 3 */}
      {step===3 && (
        <div style={S.card}>
          <p style={{fontSize:13,fontWeight:600,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:20}}>🚀 確認啟動</p>
          <div style={{background:"rgba(255,255,255,0.02)",borderRadius:10,padding:"8px 16px",marginBottom:24}}>
            {[
              ["股票",   watch("ticker")],
              ["基準",   watch("benchmark")],
              ["期間",   `${watch("date_start")} → ${watch("date_end")}`],
              ["手續費率", Number(watch("transaction_cost") || 0).toFixed(4)],
              ["特徵數", `${features.length} 個特徵`],
              ["模型",   models.find(m=>m.id===selectedArch)?.display_name],
            ].map(([l,v])=>(
              <div key={l} style={S.infoRow}>
                <span style={{fontSize:12,color:"#475569"}}>{l}</span>
                <span style={{fontSize:12,fontWeight:500,color:"#e2e8f0",fontFamily:"'JetBrains Mono',monospace"}}>{v}</span>
              </div>
            ))}
          </div>
          <button onClick={onLaunch} disabled={launchTrain.isPending} style={{
            ...S.nextBtn, padding:"14px 0", fontSize:15, letterSpacing:"-0.01em",
            background: launchTrain.isPending?"#3730a3":"linear-gradient(135deg,#6366f1,#8b5cf6)",
            boxShadow:"0 4px 24px rgba(99,102,241,0.3)",
          }}>
            {launchTrain.isPending?"🔄 送出中…":"🚀 開始訓練"}
          </button>
        </div>
      )}
    </div>
  );
}
