import { useEffect, useState } from "react";

const overlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(2, 6, 23, 0.72)",
  backdropFilter: "blur(6px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  zIndex: 200,
};

const cardStyle = {
  width: "min(100%, 480px)",
  background: "#0f172a",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 18,
  padding: 24,
  boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
};

export default function ActionModal({
  open,
  title,
  message,
  confirmLabel = "確認",
  cancelLabel = "取消",
  onCancel,
  onConfirm,
  loading = false,
  inputLabel,
  inputPlaceholder,
  inputDefaultValue = "",
  requireInput = false,
}) {
  const [value, setValue] = useState(inputDefaultValue);

  useEffect(() => {
    if (open) {
      setValue(inputDefaultValue || "");
    }
  }, [open, inputDefaultValue]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = event => {
      if (event.key === "Escape" && !loading) {
        onCancel?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loading, onCancel, open]);

  if (!open) return null;

  const disabledConfirm = loading || (requireInput && !value.trim());

  return (
    <div style={overlayStyle} onClick={() => !loading && onCancel?.()}>
      <div style={cardStyle} onClick={event => event.stopPropagation()}>
        <h3 style={{ color: "#f8fafc", fontSize: 22, marginBottom: 10 }}>{title}</h3>
        <p style={{ color: "#94a3b8", lineHeight: 1.7, marginBottom: inputLabel ? 16 : 22 }}>{message}</p>

        {inputLabel && (
          <div style={{ marginBottom: 22 }}>
            <label style={{ display: "block", color: "#cbd5e1", marginBottom: 8, fontSize: 13 }}>{inputLabel}</label>
            <input
              className="input-dark"
              value={value}
              placeholder={inputPlaceholder}
              onChange={event => setValue(event.target.value)}
              autoFocus
            />
          </div>
        )}

        <div style={{ display: "flex", gap: 12 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            style={{
              flex: 1,
              padding: "12px 14px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              color: "#e2e8f0",
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.5 : 1,
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => onConfirm?.(value.trim())}
            disabled={disabledConfirm}
            style={{
              flex: 1,
              padding: "12px 14px",
              borderRadius: 10,
              border: "none",
              background: "linear-gradient(135deg,#2563eb,#1d4ed8)",
              color: "#fff",
              fontWeight: 700,
              cursor: disabledConfirm ? "not-allowed" : "pointer",
              opacity: disabledConfirm ? 0.6 : 1,
            }}
          >
            {loading ? "處理中..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
