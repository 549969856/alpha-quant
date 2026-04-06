import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { api } from "../api/client";
import FeatureSelector from "../components/forms/FeatureSelector";
import toast from "react-hot-toast";
import { Check } from "lucide-react";

const STEPS = ["基本設定", "特徵選擇", "模型架構", "啟動訓練"];

function StepBar({ step }) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:0,marginBottom:32}}>
      {STEPS.map((label, i) => {
        const done = step > i;
        const active = step === i;
        return (
          <div key={i} style={{display:"flex",alignItems:"center",flex:i<STEPS.length-1?"1":"none"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
              <div style={{
                width:28,height:28,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",
                fontSize:12,fontWeight:700,transition:"all 0.2s",
                background:done?"#6366f1":active?"rgba(99,102,241,0.2)":"rgba(255,255,255,0.05)",
                border:active?"2px solid #6366f1":"2px solid transparent",
                color:done?"#fff":active?"#a5b4fc":"#475569",
              }}>
                {done ? <Check size={12} strokeWidth={3} /> : i + 1}
              </div>
              <span style={{fontSize:12,fontWeight:active?600:400,color:active?"#e2e8f0":done?"#6366f1":"#475569",whiteSpace:"nowrap"}}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{flex:1,height:1,margin:"0 12px",background:step>i?"#6366f1":"rgba(255,255,255,0.06)"}} />
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

const cardStyle = {background:"#131929",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,padding:28};
const primaryBtn = {width:"100%",padding:"12px 0",borderRadius:9,fontSize:14,fontWeight:600,color:"#fff",border:"none",cursor:"pointer",background:"linear-gradient(135deg,#6366f1,#8b5cf6)"};

export default function ExperimentPage() {
  const navigate = useNavigate();
  const { id: experimentId } = useParams();
  const isEditMode = Boolean(experimentId);
  const qc = useQueryClient();

  const [step, setStep] = useState(0);
  const [features, setFeatures] = useState([]);
  const [selectedArch, setArch] = useState(null);
  const [hparams, setHparams] = useState({});
  const [expId, setExpId] = useState(experimentId ?? null);

  const { register, handleSubmit, watch, reset } = useForm({
    defaultValues:{
      ticker:"2603.TW",
      benchmark:"0050.TW",
      date_start:"2020-01-01",
      date_end:"2026-03-27",
      name:"",
      description:"",
      transaction_cost:0.002,
    },
  });

  const { data: models = [] } = useQuery({
    queryKey:["models"],
    queryFn:() => api.get("/models/").then(r => r.data),
    enabled:!isEditMode,
  });

  const { data: experiment, isLoading: isExperimentLoading } = useQuery({
    queryKey:["experiment", experimentId],
    queryFn:() => api.get(`/experiments/${experimentId}/`).then(r => r.data),
    enabled:isEditMode,
  });

  useEffect(() => {
    if (!experiment) return;
    reset({
      name:experiment.name ?? "",
      description:experiment.description ?? "",
      ticker:experiment.ticker ?? "2603.TW",
      benchmark:experiment.benchmark ?? "0050.TW",
      date_start:experiment.date_start ?? "2020-01-01",
      date_end:experiment.date_end ?? "2026-03-27",
      transaction_cost:0.002,
    });
    setFeatures(experiment.feature_ids ?? []);
    setExpId(experiment.id);
  }, [experiment, reset]);

  const createExp = useMutation({
    mutationFn:body => api.post("/experiments/", body),
    onSuccess:d => {
      setExpId(d.data.id);
      qc.invalidateQueries({ queryKey:["experiments"] });
      setStep(1);
    },
    onError:() => toast.error("建立失敗"),
  });

  const updateExp = useMutation({
    mutationFn:({ id, body }) => api.patch(`/experiments/${id}/`, body),
    onSuccess:() => {
      qc.invalidateQueries({ queryKey:["experiments"] });
      qc.invalidateQueries({ queryKey:["experiment", experimentId] });
      toast.success("實驗已更新");
      navigate("/");
    },
    onError:() => toast.error("更新失敗"),
  });

  const launchTrain = useMutation({
    mutationFn:({ id, body }) => api.post(`/experiments/${id}/train/`, body),
    onSuccess:d => {
      toast.success("訓練已啟動");
      navigate(`/run/${d.data.run_id}/status`);
    },
    onError:() => toast.error("啟動失敗"),
  });

  const onStep0 = handleSubmit(data => createExp.mutate({ ...data, feature_ids:[] }));
  const onStep1 = async () => {
    if (features.length < 2) {
      toast.error("請至少選擇 2 個特徵");
      return;
    }
    try {
      await api.patch(`/experiments/${expId}/`, { feature_ids:features });
      setStep(2);
    } catch {
      toast.error("特徵儲存失敗");
    }
  };
  const onStep2 = () => {
    if (!selectedArch) {
      toast.error("請選擇模型");
      return;
    }
    const a = models.find(m => m.id === selectedArch);
    const tx = Number(watch("transaction_cost"));
    setHparams({ ...(a?.default_hparams ?? {}), transaction_cost:Number.isFinite(tx) ? tx : 0.002 });
    setStep(3);
  };
  const onLaunch = () => launchTrain.mutate({ id:expId, body:{ model_arch_id:selectedArch, hparams } });

  const onSaveEdit = handleSubmit(data => {
    if (features.length < 2) {
      toast.error("請至少選擇 2 個特徵");
      return;
    }
    updateExp.mutate({
      id:experimentId,
      body:{
        name:data.name,
        description:data.description,
        ticker:data.ticker,
        benchmark:data.benchmark,
        date_start:data.date_start,
        date_end:data.date_end,
        feature_ids:features,
      },
    });
  });

  const latestRun = experiment?.runs?.[0];

  if (isEditMode && isExperimentLoading) {
    return (
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:300}}>
        <div style={{width:36,height:36,borderRadius:"50%",border:"3px solid rgba(99,102,241,0.2)",borderTop:"3px solid #6366f1",animation:"spin 0.8s linear infinite"}} />
      </div>
    );
  }

  if (isEditMode) {
    return (
      <div style={{maxWidth:860}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:28,gap:16}}>
          <div>
            <h1 style={{fontSize:22,fontWeight:800,color:"#f1f5f9",letterSpacing:"-0.02em"}}>🛠 編輯實驗</h1>
            <p style={{fontSize:13,color:"#475569",marginTop:4}}>調整實驗設定、特徵組合與歷史紀錄檢視</p>
          </div>
          <Link to="/" style={{padding:"10px 14px",borderRadius:9,border:"1px solid rgba(255,255,255,0.08)",background:"rgba(255,255,255,0.03)",color:"#cbd5e1",textDecoration:"none",fontSize:13}}>
            返回儀表板
          </Link>
        </div>

        <div style={{...cardStyle, marginBottom:16}}>
          <p style={{fontSize:13,fontWeight:600,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:20}}>📌 基本設定</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
            <Field label="實驗名稱">
              <input {...register("name", { required:true })} className="input-dark" />
            </Field>
            <Field label="描述">
              <input {...register("description")} className="input-dark" />
            </Field>
            <Field label="股票代碼">
              <input {...register("ticker", { required:true })} className="input-dark" />
            </Field>
            <Field label="基準指數">
              <input {...register("benchmark", { required:true })} className="input-dark" />
            </Field>
            <Field label="開始日期">
              <input type="date" {...register("date_start", { required:true })} className="input-dark" />
            </Field>
            <Field label="結束日期">
              <input type="date" {...register("date_end", { required:true })} className="input-dark" />
            </Field>
          </div>
        </div>

        <div style={{...cardStyle, marginBottom:16}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
            <p style={{fontSize:13,fontWeight:600,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.06em"}}>🧩 特徵選擇</p>
            <span style={{fontSize:12,color:features.length>=2?"#34d399":"#f59e0b",fontWeight:500}}>
              已選 {features.length} 個{features.length<2?" (至少2個)":""}
            </span>
          </div>
          <FeatureSelector value={features} onChange={setFeatures} />
        </div>

        <div style={{...cardStyle, marginBottom:16}}>
          <p style={{fontSize:13,fontWeight:600,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:16}}>📚 歷史執行紀錄</p>
          {!experiment?.runs?.length ? (
            <p style={{fontSize:13,color:"#64748b"}}>目前還沒有執行紀錄。</p>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {experiment.runs.map(run => (
                <div key={run.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:16,padding:"12px 14px",borderRadius:10,background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)"}}>
                  <div>
                    <p style={{fontSize:13,fontWeight:600,color:"#e2e8f0"}}>{run.model_name || "未命名模型"}</p>
                    <p style={{fontSize:11,color:"#64748b",marginTop:4}}>Run {run.id.slice(0, 8).toUpperCase()} · {run.status}</p>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    {run.status === "done" && (
                      <>
                        <Link to={`/run/${run.id}/backtest`} style={{padding:"6px 10px",borderRadius:7,fontSize:12,textDecoration:"none",background:"rgba(96,165,250,0.1)",color:"#93c5fd",border:"1px solid rgba(96,165,250,0.2)"}}>
                          回測
                        </Link>
                        <Link to={`/run/${run.id}/prediction`} style={{padding:"6px 10px",borderRadius:7,fontSize:12,textDecoration:"none",background:"rgba(139,92,246,0.1)",color:"#c4b5fd",border:"1px solid rgba(139,92,246,0.2)"}}>
                          預測
                        </Link>
                      </>
                    )}
                    {run.status === "training" && (
                      <Link to={`/run/${run.id}/status`} style={{padding:"6px 10px",borderRadius:7,fontSize:12,textDecoration:"none",background:"rgba(245,158,11,0.1)",color:"#fbbf24",border:"1px solid rgba(245,158,11,0.2)"}}>
                        訓練中
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{display:"flex",gap:12}}>
          <button onClick={onSaveEdit} disabled={updateExp.isPending} style={{...primaryBtn, flex:1}}>
            {updateExp.isPending ? "儲存中…" : "儲存修改"}
          </button>
          {latestRun?.status === "done" && (
            <Link to={`/run/${latestRun.id}/backtest`} style={{flex:1,textAlign:"center",padding:"12px 0",borderRadius:9,textDecoration:"none",background:"rgba(99,102,241,0.12)",border:"1px solid rgba(99,102,241,0.2)",color:"#a5b4fc",fontWeight:600}}>
              查看最新回測
            </Link>
          )}
        </div>
      </div>
    );
  }

  const summaryRows = [
    ["股票", watch("ticker")],
    ["基準", watch("benchmark")],
    ["期間", `${watch("date_start")} → ${watch("date_end")}`],
    ["手續費率", Number(watch("transaction_cost") || 0).toFixed(4)],
    ["特徵數", `${features.length} 個特徵`],
    ["模型", models.find(m => m.id === selectedArch)?.display_name],
  ];

  return (
    <div style={{maxWidth:780}}>
      <div style={{marginBottom:28}}>
        <h1 style={{fontSize:22,fontWeight:800,color:"#f1f5f9",letterSpacing:"-0.02em"}}>🧪 新建實驗</h1>
        <p style={{fontSize:13,color:"#475569",marginTop:4}}>四步驟完成模型訓練與策略回測</p>
      </div>

      <StepBar step={step} />

      {step === 0 && (
        <div style={cardStyle}>
          <p style={{fontSize:13,fontWeight:600,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:20}}>📌 基本設定</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
            <Field label="實驗名稱">
              <input {...register("name", { required:true })} placeholder="e.g. 長榮裸K測試" className="input-dark" />
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
            <button onClick={onStep0} disabled={createExp.isPending} style={primaryBtn}>
              {createExp.isPending ? "建立中…" : "下一步 →"}
            </button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div style={cardStyle}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
            <p style={{fontSize:13,fontWeight:600,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.06em"}}>🧩 特徵選擇</p>
            <span style={{fontSize:12,color:features.length>=2?"#34d399":"#f59e0b",fontWeight:500}}>
              已選 {features.length} 個{features.length<2?" (至少2個)":""}
            </span>
          </div>
          <FeatureSelector value={features} onChange={setFeatures} />
          <div style={{marginTop:20}}>
            <button onClick={onStep1} style={primaryBtn}>下一步 →</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div style={cardStyle}>
          <p style={{fontSize:13,fontWeight:600,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:20}}>🤖 選擇模型架構</p>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:20}}>
            {models.map(m => {
              const sel = selectedArch === m.id;
              return (
                <button key={m.id} onClick={() => setArch(m.id)} style={{
                  padding:"14px 12px",borderRadius:10,border:`1px solid ${sel?"rgba(99,102,241,0.5)":"rgba(255,255,255,0.06)"}`,
                  background:sel?"rgba(99,102,241,0.08)":"rgba(255,255,255,0.02)",
                  cursor:"pointer",textAlign:"left",transition:"all 0.15s",
                }}>
                  <p style={{fontSize:13,fontWeight:600,color:sel?"#a5b4fc":"#cbd5e1",marginBottom:4}}>{m.display_name}</p>
                  <p style={{fontSize:11,color:"#475569",lineHeight:1.5}} className="line-clamp-2">{m.description}</p>
                </button>
              );
            })}
          </div>
          <div style={{marginTop:20}}>
            <button onClick={onStep2} style={primaryBtn}>下一步 →</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div style={cardStyle}>
          <p style={{fontSize:13,fontWeight:600,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:20}}>🚀 確認啟動</p>
          <div style={{background:"rgba(255,255,255,0.02)",borderRadius:10,padding:"8px 16px",marginBottom:24}}>
            {summaryRows.map(([l, v]) => (
              <div key={l} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                <span style={{fontSize:12,color:"#475569"}}>{l}</span>
                <span style={{fontSize:12,fontWeight:500,color:"#e2e8f0",fontFamily:"'JetBrains Mono',monospace"}}>{v}</span>
              </div>
            ))}
          </div>
          <button onClick={onLaunch} disabled={launchTrain.isPending} style={{
            ...primaryBtn,
            padding:"14px 0",
            fontSize:15,
            letterSpacing:"-0.01em",
            background:launchTrain.isPending?"#3730a3":"linear-gradient(135deg,#6366f1,#8b5cf6)",
            boxShadow:"0 4px 24px rgba(99,102,241,0.3)",
          }}>
            {launchTrain.isPending ? "送出中…" : "開始訓練"}
          </button>
        </div>
      )}
    </div>
  );
}
