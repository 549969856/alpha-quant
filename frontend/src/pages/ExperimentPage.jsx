import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { api } from "../api/client";
import FeatureSelector from "../components/forms/FeatureSelector";
import ModelHparamsForm, { getDefaultHparams, normalizeHparams } from "../components/forms/ModelHparamsForm";
import ActionModal from "../components/ui/ActionModal";

const CREATE_STEPS = ["基本設定", "特徵與參數", "確認送出"];
const MIN_TRAIN_PERCENT = 10;

const cardStyle = {
  background: "#131929",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 16,
  padding: 24,
};

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function clampSplit(value, fallback = 0) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(0, Math.min(100, Math.round(next)));
}

function rebalanceSplit(current, key, value) {
  const maxEditable = 100 - MIN_TRAIN_PERCENT;
  const next = {
    val: clampSplit(current.val, 15),
    test: clampSplit(current.test, 15),
  };

  next[key] = clampSplit(value, next[key]);
  if (next.val + next.test > maxEditable) {
    const otherKey = key === "val" ? "test" : "val";
    next[otherKey] = Math.max(0, maxEditable - next[key]);
  }

  const train = Math.max(MIN_TRAIN_PERCENT, 100 - next.val - next.test);
  const overflow = next.val + next.test + train - 100;
  if (overflow > 0) {
    const targetKey = key === "val" ? "test" : "val";
    next[targetKey] = Math.max(0, next[targetKey] - overflow);
  }

  return {
    train: Math.max(MIN_TRAIN_PERCENT, 100 - next.val - next.test),
    val: next.val,
    test: next.test,
  };
}

function StepBar({ step }) {
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 22, flexWrap: "wrap" }}>
      {CREATE_STEPS.map((label, index) => {
        const active = index === step;
        const done = index < step;
        return (
          <div
            key={label}
            style={{
              padding: "10px 14px",
              borderRadius: 999,
              border: `1px solid ${active ? "rgba(96,165,250,0.4)" : "rgba(255,255,255,0.06)"}`,
              background: done ? "rgba(52,211,153,0.12)" : active ? "rgba(96,165,250,0.12)" : "rgba(255,255,255,0.02)",
              color: done ? "#6ee7b7" : active ? "#93c5fd" : "#94a3b8",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {index + 1}. {label}
          </div>
        );
      })}
    </div>
  );
}

function ActionRow({ onBack, onNext, nextLabel, pending }) {
  return (
    <div style={{ display: "flex", gap: 12, marginTop: 22 }}>
      <button
        type="button"
        onClick={onBack}
        disabled={!onBack}
        style={{
          flex: 1,
          padding: "12px 14px",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
          color: "#cbd5e1",
          cursor: onBack ? "pointer" : "not-allowed",
          opacity: onBack ? 1 : 0.45,
        }}
      >
        回上一步
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={pending}
        style={{
          flex: 1,
          padding: "12px 14px",
          borderRadius: 10,
          border: "none",
          background: "linear-gradient(135deg,#2563eb,#1d4ed8)",
          color: "#fff",
          cursor: "pointer",
          fontWeight: 700,
        }}
      >
        {pending ? "處理中..." : nextLabel}
      </button>
    </div>
  );
}

function SplitEditor({ splitConfig, setSplitConfig }) {
  const onChange = (key, value) => {
    setSplitConfig(current => rebalanceSplit(current, key, value));
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 12, alignItems: "center" }}>
        <div>
          <label style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>Validation</label>
          <input
            type="range"
            min="0"
            max={100 - MIN_TRAIN_PERCENT}
            value={splitConfig.val}
            onChange={e => onChange("val", e.target.value)}
            style={{ width: "100%" }}
          />
        </div>
        <input
          className="input-dark"
          type="number"
          min="0"
          max={100 - MIN_TRAIN_PERCENT}
          value={splitConfig.val}
          onChange={e => onChange("val", e.target.value)}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 12, alignItems: "center" }}>
        <div>
          <label style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>Test</label>
          <input
            type="range"
            min="0"
            max={100 - MIN_TRAIN_PERCENT}
            value={splitConfig.test}
            onChange={e => onChange("test", e.target.value)}
            style={{ width: "100%" }}
          />
        </div>
        <input
          className="input-dark"
          type="number"
          min="0"
          max={100 - MIN_TRAIN_PERCENT}
          value={splitConfig.test}
          onChange={e => onChange("test", e.target.value)}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12 }}>
        <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.22)" }}>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>Train</div>
          <div style={{ color: "#6ee7b7", fontSize: 18, fontWeight: 800 }}>{splitConfig.train}%</div>
          <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 4 }}>自動計算</div>
        </div>
        <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)" }}>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>Val</div>
          <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 800 }}>{splitConfig.val}%</div>
        </div>
        <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)" }}>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>Test</div>
          <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 800 }}>{splitConfig.test}%</div>
        </div>
      </div>
      <p style={{ fontSize: 12, color: "#94a3b8" }}>
        系統會自動維持 `Train = 100 - Val - Test`，並保留至少 {MIN_TRAIN_PERCENT}% 給 Train。
      </p>
    </div>
  );
}

function ModelPicker({ models, selectedArchId, onSelect }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10, marginBottom: 18 }}>
      {models.map(model => {
        const selected = selectedArchId === model.id;
        return (
          <button
            key={model.id}
            type="button"
            onClick={() => onSelect(model.id)}
            style={{
              textAlign: "left",
              borderRadius: 12,
              padding: 14,
              border: `1px solid ${selected ? "rgba(96,165,250,0.45)" : "rgba(255,255,255,0.06)"}`,
              background: selected ? "rgba(59,130,246,0.12)" : "rgba(255,255,255,0.02)",
              color: "#f8fafc",
              cursor: "pointer",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{model.display_name}</div>
            <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>{model.description}</div>
          </button>
        );
      })}
    </div>
  );
}

export default function ExperimentPage() {
  const navigate = useNavigate();
  const { id: experimentId } = useParams();
  const isEditMode = Boolean(experimentId);
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);
  const [features, setFeatures] = useState([]);
  const [selectedArchId, setSelectedArchId] = useState("");
  const [selectedArch, setSelectedArch] = useState("");
  const [hparams, setHparams] = useState({});
  const [splitConfig, setSplitConfig] = useState({ train: 70, val: 15, test: 15 });
  const [expId, setExpId] = useState(experimentId || null);
  const [modalState, setModalState] = useState({ type: null, values: null });

  const form = useForm({
    defaultValues: {
      name: "",
      description: "",
      ticker: "2603.TW",
      benchmark: "0050.TW",
      date_start: "2020-01-01",
      date_end: yesterday(),
      random_seed: 42,
    },
  });

  const { register, handleSubmit, watch, reset, clearErrors } = form;

  const { data: models = [] } = useQuery({
    queryKey: ["models"],
    queryFn: () => api.get("/models/").then(r => r.data),
  });

  const { data: experiment, isLoading: loadingExperiment } = useQuery({
    queryKey: ["experiment", experimentId],
    queryFn: () => api.get(`/experiments/${experimentId}/`).then(r => r.data),
    enabled: isEditMode,
  });

  const latestRun = experiment?.runs?.[0] || null;
  const modelLookup = useMemo(() => {
    const map = new Map();
    models.forEach(model => {
      map.set(model.id, model);
      map.set(model.arch, model);
    });
    return map;
  }, [models]);

  useEffect(() => {
    if (!experiment) return;
    reset({
      name: experiment.name || "",
      description: experiment.description || "",
      ticker: experiment.ticker || "2603.TW",
      benchmark: experiment.benchmark || "0050.TW",
      date_start: experiment.date_start || "2020-01-01",
      date_end: experiment.date_end || yesterday(),
      random_seed: experiment.random_seed ?? 42,
    });
    setFeatures(experiment.feature_ids || []);
    setSplitConfig(experiment.split_config || { train: 70, val: 15, test: 15 });
    setExpId(experiment.id);
    if (experiment.runs?.length) {
      const run = experiment.runs[0];
      setSelectedArchId(run.model_arch_id || "");
      setHparams(run.hparams || {});
    }
  }, [experiment, reset]);

  useEffect(() => {
    const model = modelLookup.get(selectedArchId);
    setSelectedArch(model?.arch || "");
  }, [modelLookup, selectedArchId]);

  const createExp = useMutation({
    mutationFn: body => api.post("/experiments/", body),
    onSuccess: res => {
      setExpId(res.data.id);
      queryClient.invalidateQueries({ queryKey: ["experiments"] });
    },
    onError: () => toast.error("建立實驗失敗"),
  });

  const updateExp = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/experiments/${id}/`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["experiments"] });
      queryClient.invalidateQueries({ queryKey: ["experiment", experimentId] });
    },
    onError: () => toast.error("儲存實驗失敗"),
  });

  const launchTrain = useMutation({
    mutationFn: ({ id, body }) => api.post(`/experiments/${id}/train/`, body),
    onSuccess: res => {
      toast.success("研究任務已送出");
      navigate(`/run/${res.data.run_id}/status`);
    },
    onError: () => toast.error("啟動訓練失敗"),
  });

  const retrainMutation = useMutation({
    mutationFn: ({ id, body }) => api.post(`/experiments/${id}/retrain/`, body),
    onSuccess: res => {
      queryClient.invalidateQueries({ queryKey: ["experiments"] });
      queryClient.invalidateQueries({ queryKey: ["experiment", experimentId] });
      toast.success(res.data.action === "forked" ? "已建立分支並啟動訓練" : "已重新訓練");
      if (res.data.action === "forked") {
        navigate(`/experiment/${res.data.experiment_id}`);
        return;
      }
      navigate(`/run/${res.data.run_id}/status`);
    },
    onError: err => {
      toast.error(err?.response?.data?.error || "重新訓練失敗");
    },
  });

  const persistExperiment = async values => {
    const payload = {
      ...values,
      random_seed: Number(values.random_seed || 42),
      split_config: splitConfig,
      feature_ids: features,
    };
    if (!expId) {
      const res = await createExp.mutateAsync(payload);
      return res?.data?.id;
    }
    await updateExp.mutateAsync({ id: expId, body: payload });
    return expId;
  };

  const selectModel = archId => {
    const defaults = getDefaultHparams(models, archId);
    setSelectedArchId(archId);
    setHparams(defaults);
    clearErrors();
  };

  const handleBack = nextStep => {
    clearErrors();
    setStep(nextStep);
  };

  const nextBasic = handleSubmit(async values => {
    if (!selectedArchId) {
      toast.error("請先選擇模型架構");
      return;
    }
    const id = await persistExperiment(values);
    if (id) {
      setExpId(id);
      setStep(1);
    }
  });

  const nextParams = async () => {
    if (features.length < 2) {
      toast.error("至少要選 2 個特徵");
      return;
    }
    if (!selectedArchId) {
      toast.error("請先選擇模型架構");
      return;
    }
    const values = watch();
    await persistExperiment(values);
    clearErrors();
    setStep(2);
  };

  const submitAll = async () => {
    const normalized = normalizeHparams(hparams);
    if (!selectedArchId) {
      toast.error("請先選擇模型架構");
      return;
    }
    launchTrain.mutate({
      id: expId,
      body: {
        model_arch_id: selectedArchId,
        hparams: normalized,
      },
    });
  };

  const buildRetrainPayload = values => ({
    name: values.name,
    description: values.description,
    ticker: values.ticker,
    benchmark: values.benchmark,
    date_start: values.date_start,
    date_end: values.date_end,
    random_seed: Number(values.random_seed || 42),
    split_config: splitConfig,
    feature_ids: features,
    model_arch_id: selectedArchId || latestRun?.model_arch_id,
    hparams: normalizeHparams(hparams),
  });

  const closeModal = () => setModalState({ type: null, values: null });

  const handleRetrain = handleSubmit(async values => {
    const payload = buildRetrainPayload(values);
    if (!payload.model_arch_id) {
      toast.error("沒有可用的模型架構，請先選擇模型");
      return;
    }

    if (experiment?.status === "done") {
      setModalState({
        type: "fork",
        values: {
          payload,
          defaultForkName: `${values.name} Fork`,
        },
      });
      return;
    }

    setModalState({
      type: "retrain",
      values: { payload },
    });
  });

  if (isEditMode && loadingExperiment) {
    return <div style={{ color: "#94a3b8" }}>讀取實驗中...</div>;
  }

  const summary = [
    ["名稱", watch("name") || "-"],
    ["股票", watch("ticker") || "-"],
    ["基準", watch("benchmark") || "-"],
    ["日期區間", `${watch("date_start")} -> ${watch("date_end")}`],
    ["Random Seed", String(watch("random_seed"))],
    ["資料切分", `Train ${splitConfig.train}% / Val ${splitConfig.val}% / Test ${splitConfig.test}%`],
    ["特徵數", String(features.length)],
    ["模型", modelLookup.get(selectedArchId)?.display_name || latestRun?.model_name || "-"],
  ];

  return (
    <div style={{ maxWidth: 920 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 26, color: "#f8fafc", marginBottom: 6 }}>
            {isEditMode ? "編輯研究實驗" : "建立新研究實驗"}
          </h1>
          <p style={{ color: "#94a3b8", fontSize: 14 }}>
            研究回測與實戰部署已分流。這裡只處理研究設定、回測，以及重新訓練或建立分支。
          </p>
        </div>
        <Link to="/" style={{ color: "#93c5fd", textDecoration: "none" }}>回 Dashboard</Link>
      </div>

      {!isEditMode && <StepBar step={step} />}

      {(isEditMode || step === 0) && (
        <div style={cardStyle}>
          <h2 style={{ color: "#f8fafc", marginBottom: 18 }}>基本設定與模型</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14 }}>
            <input className="input-dark" placeholder="實驗名稱" {...register("name", { required: true })} />
            <input className="input-dark" placeholder="描述" {...register("description")} />
            <input className="input-dark" placeholder="Ticker" {...register("ticker", { required: true })} />
            <input className="input-dark" placeholder="Benchmark" {...register("benchmark", { required: true })} />
            <input className="input-dark" type="date" {...register("date_start", { required: true })} />
            <input className="input-dark" type="date" {...register("date_end", { required: true })} />
            <input className="input-dark" type="number" {...register("random_seed", { required: true })} />
          </div>

          <div style={{ marginTop: 22 }}>
            <h3 style={{ color: "#e2e8f0", marginBottom: 12, fontSize: 14 }}>資料切分</h3>
            <SplitEditor splitConfig={splitConfig} setSplitConfig={setSplitConfig} />
          </div>

          <div style={{ marginTop: 22 }}>
            <h3 style={{ color: "#e2e8f0", marginBottom: 12, fontSize: 14 }}>模型架構</h3>
            <ModelPicker models={models} selectedArchId={selectedArchId} onSelect={selectModel} />
          </div>

          {!isEditMode && (
            <ActionRow
              onBack={null}
              onNext={nextBasic}
              nextLabel="前往特徵與參數"
              pending={createExp.isPending || updateExp.isPending}
            />
          )}
        </div>
      )}

      {(isEditMode || step === 1) && (
        <div style={{ ...cardStyle, marginTop: isEditMode ? 16 : 0 }}>
          <h2 style={{ color: "#f8fafc", marginBottom: 18 }}>特徵與超參數</h2>
          <FeatureSelector value={features} onChange={setFeatures} />
          <div style={{ marginTop: 20 }}>
            <ModelHparamsForm
              key={selectedArchId || "no-model"}
              arch={selectedArch}
              hparams={hparams}
              onChange={setHparams}
            />
          </div>
          {!isEditMode && (
            <ActionRow
              onBack={() => handleBack(0)}
              onNext={nextParams}
              nextLabel="前往確認"
              pending={updateExp.isPending}
            />
          )}
        </div>
      )}

      {!isEditMode && step === 2 && (
        <div style={cardStyle}>
          <h2 style={{ color: "#f8fafc", marginBottom: 18 }}>確認送出</h2>
          <div style={{ display: "grid", gap: 10 }}>
            {summary.map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <span style={{ color: "#94a3b8" }}>{label}</span>
                <span style={{ color: "#f8fafc", fontFamily: "'JetBrains Mono',monospace" }}>{value}</span>
              </div>
            ))}
          </div>
          <ActionRow
            onBack={() => handleBack(1)}
            onNext={submitAll}
            nextLabel="啟動研究回測"
            pending={launchTrain.isPending}
          />
        </div>
      )}

      {isEditMode && (
        <div style={{ ...cardStyle, marginTop: 16 }}>
          <h2 style={{ color: "#f8fafc", marginBottom: 18 }}>編輯動作</h2>
          <div style={{ display: "grid", gap: 10, marginBottom: 18 }}>
            {summary.map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <span style={{ color: "#94a3b8" }}>{label}</span>
                <span style={{ color: "#f8fafc", fontFamily: "'JetBrains Mono',monospace" }}>{value}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button
              type="button"
              onClick={handleSubmit(async values => {
                await persistExperiment(values);
                toast.success("實驗已儲存");
              })}
              style={{
                flex: 1,
                padding: "12px 14px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.03)",
                color: "#e2e8f0",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              儲存變更
            </button>
            <button
              type="button"
              onClick={handleRetrain}
              disabled={retrainMutation.isPending}
              style={{
                flex: 1,
                padding: "12px 14px",
                borderRadius: 10,
                border: "none",
                background: "linear-gradient(135deg,#2563eb,#1d4ed8)",
                color: "#fff",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              {retrainMutation.isPending ? "處理中..." : "重新訓練"}
            </button>
          </div>
        </div>
      )}

      <ActionModal
        open={modalState.type === "retrain"}
        title="重新訓練實驗"
        message="確定要使用目前畫面上的參數直接覆蓋原實驗，並重新啟動訓練嗎？"
        confirmLabel="確認重訓"
        cancelLabel="先不要"
        loading={retrainMutation.isPending}
        onCancel={closeModal}
        onConfirm={() => {
          retrainMutation.mutate({
            id: experimentId,
            body: modalState.values?.payload,
          }, {
            onSettled: closeModal,
          });
        }}
      />

      <ActionModal
        open={modalState.type === "fork"}
        title="建立分支後重新訓練"
        message="這個實驗已經完成。為了保留既有對帳與回測紀錄，系統會先建立一個新的實驗分支，再用目前參數重新訓練。"
        inputLabel="新實驗名稱"
        inputPlaceholder="例如：My Strategy Fork"
        inputDefaultValue={modalState.values?.defaultForkName || ""}
        requireInput
        confirmLabel="建立分支並訓練"
        cancelLabel="取消"
        loading={retrainMutation.isPending}
        onCancel={closeModal}
        onConfirm={forkName => {
          retrainMutation.mutate({
            id: experimentId,
            body: {
              ...modalState.values?.payload,
              fork_name: forkName,
            },
          }, {
            onSettled: closeModal,
          });
        }}
      />
    </div>
  );
}
