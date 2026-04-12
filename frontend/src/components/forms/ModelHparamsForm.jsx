const FIELD_MAP = {
  transformer: [
    { key: "d_model", label: "d_model", type: "number", min: 8, step: 8 },
    { key: "nhead", label: "Attention Heads", type: "number", min: 1, step: 1 },
    { key: "num_layers", label: "Encoder Layers", type: "number", min: 1, step: 1 },
    { key: "dropout", label: "Dropout", type: "number", min: 0, max: 0.9, step: 0.05 },
  ],
  lstm: [
    { key: "hidden", label: "Hidden Size", type: "number", min: 8, step: 8 },
    { key: "num_layers", label: "Layers", type: "number", min: 1, step: 1 },
    { key: "dropout", label: "Dropout", type: "number", min: 0, max: 0.9, step: 0.05 },
  ],
  gru: [
    { key: "hidden", label: "Hidden Size", type: "number", min: 8, step: 8 },
    { key: "num_layers", label: "Layers", type: "number", min: 1, step: 1 },
    { key: "dropout", label: "Dropout", type: "number", min: 0, max: 0.9, step: 0.05 },
  ],
  tcn: [
    { key: "channels", label: "Channels", type: "number", min: 8, step: 8 },
    { key: "levels", label: "Levels", type: "number", min: 1, step: 1 },
    { key: "kernel_size", label: "Kernel Size", type: "number", min: 2, step: 1 },
  ],
  xgboost: [
    { key: "n_estimators", label: "Estimators", type: "number", min: 50, step: 50 },
    { key: "max_depth", label: "Max Depth", type: "number", min: 1, step: 1 },
    { key: "subsample", label: "Subsample", type: "number", min: 0.1, max: 1, step: 0.05 },
  ],
  lightgbm: [
    { key: "n_estimators", label: "Estimators", type: "number", min: 50, step: 50 },
    { key: "max_depth", label: "Max Depth", type: "number", min: -1, step: 1 },
    { key: "num_leaves", label: "Num Leaves", type: "number", min: 2, step: 1 },
  ],
};

const SHARED_FIELDS = [
  { key: "seq_length", label: "Sequence Length", type: "number", min: 10, step: 1 },
  { key: "lr", label: "Learning Rate", type: "number", min: 0.0001, step: 0.0001 },
  { key: "transaction_cost", label: "Transaction Cost", type: "number", min: 0, step: 0.0001 },
  { key: "confidence_threshold", label: "Confidence Threshold", type: "number", min: 0.1, max: 0.95, step: 0.01 },
];

const TORCH_ONLY = [
  { key: "epochs", label: "Epochs", type: "number", min: 1, step: 1 },
  { key: "batch_size", label: "Batch Size", type: "number", min: 8, step: 8 },
];

function toInputValue(value) {
  return value ?? "";
}

export function normalizeHparams(values) {
  const next = {};
  Object.entries(values || {}).forEach(([key, value]) => {
    if (value === "" || value == null) return;
    if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
      next[key] = Number(value);
      return;
    }
    next[key] = value;
  });
  return next;
}

export function getDefaultHparams(models, modelArchId) {
  const model = (models || []).find(item => item.id === modelArchId);
  return { ...(model?.default_hparams || {}) };
}

export default function ModelHparamsForm({ arch, hparams, onChange }) {
  if (!arch) {
    return (
      <p style={{ fontSize: 13, color: "#94a3b8" }}>
        先選模型，這裡就會展開對應的超參數設定。
      </p>
    );
  }

  const modelFields = FIELD_MAP[arch] || [];
  const allFields = [
    ...modelFields,
    ...(arch === "xgboost" || arch === "lightgbm" ? [] : TORCH_ONLY),
    ...SHARED_FIELDS,
  ];

  const updateValue = (key, raw) => {
    onChange({
      ...hparams,
      [key]: raw,
    });
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14 }}>
      {allFields.map(field => (
        <div key={field.key}>
          <label
            style={{
              display: "block",
              fontSize: 11,
              marginBottom: 6,
              color: "#94a3b8",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            {field.label}
          </label>
          <input
            className="input-dark"
            type={field.type}
            min={field.min}
            max={field.max}
            step={field.step}
            value={toInputValue(hparams?.[field.key])}
            onChange={e => updateValue(field.key, e.target.value)}
          />
        </div>
      ))}
    </div>
  );
}
