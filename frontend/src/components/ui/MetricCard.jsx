export default function MetricCard({ label, value, sub, trend, mono = false }) {
  const trendColor =
    trend === "positive" ? "#34d399" :
    trend === "negative" ? "#f87171" : "#94a3b8";

  return (
    <div className="card" style={{padding:"18px 20px"}}>
      <p style={{fontSize:10,fontWeight:600,color:"#475569",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>
        {label}
      </p>
      <p style={{
        fontSize:22,fontWeight:700,letterSpacing:"-0.02em",color: trendColor,
        fontFamily: mono ? "'JetBrains Mono',monospace" : "inherit",
      }}>
        {value ?? "—"}
      </p>
      {sub && <p style={{fontSize:11,color:"#475569",marginTop:4}}>{sub}</p>}
    </div>
  );
}
