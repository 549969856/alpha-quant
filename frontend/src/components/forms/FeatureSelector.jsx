import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import toast from "react-hot-toast";
import { Bookmark, Check, ChevronDown, Tag } from "lucide-react";

const CAT_META = {
  price_volume: { label:"裸K價量",      emoji:"📊", color:"#60a5fa" },
  momentum:     { label:"動能/均值回歸", emoji:"⚡", color:"#a78bfa" },
  trend:        { label:"趨勢",         emoji:"📈", color:"#34d399" },
  volatility:   { label:"波動率",       emoji:"🌊", color:"#f59e0b" },
  relative:     { label:"相對強弱",     emoji:"🆚", color:"#f87171" },
  custom:       { label:"自定義",       emoji:"🔧", color:"#94a3b8" },
};

export default function FeatureSelector({ value = [], onChange }) {
  const [open, setOpen]         = useState({ price_volume:true, momentum:true });
  const [showSave, setShowSave] = useState(false);
  const [presetName, setPname]  = useState("");
  const qc = useQueryClient();

  const { data: catalog = {} } = useQuery({
    queryKey:["features"],
    queryFn:()=>api.get("/features/").then(r=>r.data),
  });
  const { data: presets = [] } = useQuery({
    queryKey:["presets"],
    queryFn:()=>api.get("/feature-presets/").then(r=>r.data.results??r.data),
  });

  const savePreset = useMutation({
    mutationFn: body => api.post("/feature-presets/", body),
    onSuccess:  () => { toast.success("已儲存"); setShowSave(false); setPname(""); qc.invalidateQueries(["presets"]); },
  });

  const toggle = id => onChange(value.includes(id) ? value.filter(x=>x!==id) : [...value,id]);

  const allFeatures = Object.values(catalog).flat();

  return (
    <div>
      {/* Presets row */}
      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:16}}>
        <span style={{fontSize:11,color:"#475569",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em"}}>預設：</span>
        {presets.map(p => (
          <button key={p.id} onClick={()=>{ onChange(p.features?.map(f=>f.id)??[]); toast.success(`載入：${p.name}`); }}
            style={{padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:500,background:"rgba(99,102,241,0.1)",color:"#a5b4fc",border:"1px solid rgba(99,102,241,0.2)",cursor:"pointer"}}>
            {p.name}
          </button>
        ))}
        <button onClick={()=>setShowSave(s=>!s)}
          style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:6,fontSize:11,background:"rgba(255,255,255,0.05)",color:"#64748b",border:"1px solid rgba(255,255,255,0.07)",cursor:"pointer"}}>
          <Bookmark size={11}/> 儲存組合
        </button>
      </div>

      {/* Save form */}
      {showSave && (
        <div style={{display:"flex",gap:8,padding:12,marginBottom:12,background:"rgba(99,102,241,0.06)",borderRadius:8,border:"1px solid rgba(99,102,241,0.15)"}}>
          <input value={presetName} onChange={e=>setPname(e.target.value)} placeholder="組合名稱，例：裸K基礎版"
            className="input-dark" style={{flex:1}} />
          <button onClick={()=>savePreset.mutate({name:presetName,feature_ids:value})}
            disabled={!presetName||value.length===0}
            style={{padding:"8px 16px",borderRadius:7,fontSize:12,fontWeight:600,background:"#6366f1",color:"#fff",border:"none",cursor:"pointer",opacity:(!presetName||value.length===0)?0.4:1}}>
            儲存
          </button>
        </div>
      )}

      {/* Selected chips */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",minHeight:32,marginBottom:16}}>
        {value.length===0
          ? <span style={{fontSize:12,color:"#374151",fontStyle:"italic"}}>尚未選擇任何特徵…</span>
          : allFeatures.filter(f=>value.includes(f.id)).map(f=>(
            <button key={f.id} onClick={()=>toggle(f.id)}
              style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:500,background:"rgba(99,102,241,0.15)",color:"#a5b4fc",border:"1px solid rgba(99,102,241,0.3)",cursor:"pointer"}}>
              <Tag size={9}/>{f.name}
              <span style={{opacity:0.6,marginLeft:2}}>×</span>
            </button>
          ))
        }
      </div>

      {/* Category accordions */}
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {Object.entries(catalog).map(([cat, feats]) => {
          const meta = CAT_META[cat] ?? {label:cat,emoji:"•",color:"#94a3b8"};
          const isOpen = open[cat] !== false;
          const selCount = feats.filter(f=>value.includes(f.id)).length;

          return (
            <div key={cat} style={{border:"1px solid rgba(255,255,255,0.06)",borderRadius:10,overflow:"hidden"}}>
              <button onClick={()=>setOpen(s=>({...s,[cat]:!isOpen}))}
                style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",background:"rgba(255,255,255,0.02)",border:"none",cursor:"pointer"}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:13}}>{meta.emoji}</span>
                  <span style={{fontSize:13,fontWeight:500,color:"#cbd5e1"}}>{meta.label}</span>
                  {selCount>0 && (
                    <span style={{padding:"1px 7px",borderRadius:20,fontSize:10,fontWeight:600,background:`${meta.color}22`,color:meta.color}}>
                      {selCount}
                    </span>
                  )}
                </div>
                <ChevronDown size={13} color="#475569" style={{transform:isOpen?"rotate(180deg)":"none",transition:"transform 0.2s"}} />
              </button>

              {isOpen && (
                <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:6,padding:10}}>
                  {feats.map(feat => {
                    const sel = value.includes(feat.id);
                    return (
                      <button key={feat.id} onClick={()=>toggle(feat.id)}
                        style={{
                          display:"flex",alignItems:"flex-start",gap:10,padding:"10px 12px",
                          borderRadius:8,border:`1px solid ${sel?`${meta.color}40`:"rgba(255,255,255,0.05)"}`,
                          background: sel?`${meta.color}0d`:"rgba(255,255,255,0.02)",
                          cursor:"pointer",textAlign:"left",transition:"all 0.15s",
                        }}>
                        <div style={{width:16,height:16,borderRadius:5,flexShrink:0,marginTop:1,display:"flex",alignItems:"center",justifyContent:"center",
                          background:sel?meta.color:"rgba(255,255,255,0.06)",border:`1px solid ${sel?meta.color:"rgba(255,255,255,0.1)"}`}}>
                          {sel && <Check size={9} color="#fff" strokeWidth={3}/>}
                        </div>
                        <div>
                          <p style={{fontSize:12,fontWeight:500,color:"#e2e8f0",marginBottom:2}}>{feat.name}</p>
                          <p style={{fontSize:11,color:"#475569",lineHeight:1.4}} className="line-clamp-2">{feat.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
