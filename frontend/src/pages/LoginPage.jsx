import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { authApi } from "../api/client";
import toast from "react-hot-toast";
import { TrendingUp, Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const navigate = useNavigate();
  const { setTokens, setUser } = useAuthStore();
  const [mode, setMode]   = useState("login");
  const [u, setU]         = useState("");
  const [p, setP]         = useState("");
  const [show, setShow]   = useState(false);
  const [loading, setLoad] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoad(true);
    try {
      if (mode === "register") {
        await authApi.register(u, p);
        toast.success("註冊成功"); setMode("login"); return;
      }
      const { data } = await authApi.login(u, p);
      setTokens(data.access, data.refresh);
      const me = await authApi.me();
      setUser(me.data);
      navigate("/");
    } catch { toast.error(mode === "login" ? "帳號或密碼錯誤" : "註冊失敗"); }
    finally { setLoad(false); }
  };

  return (
    <div style={{minHeight:"100vh",background:"#0b0e17",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      {/* Glow blobs */}
      <div style={{position:"fixed",top:-160,left:-160,width:500,height:500,borderRadius:"50%",background:"radial-gradient(circle,rgba(99,102,241,0.12) 0%,transparent 70%)",pointerEvents:"none"}} />
      <div style={{position:"fixed",bottom:-120,right:-100,width:400,height:400,borderRadius:"50%",background:"radial-gradient(circle,rgba(139,92,246,0.08) 0%,transparent 70%)",pointerEvents:"none"}} />

      <div style={{width:"100%",maxWidth:400,position:"relative"}}>
        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:40}}>
          <div style={{width:52,height:52,borderRadius:14,background:"linear-gradient(135deg,#6366f1,#8b5cf6)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}>
            <TrendingUp size={22} color="#fff" />
          </div>
          <h1 style={{fontSize:24,fontWeight:800,color:"#f1f5f9",letterSpacing:"-0.03em",margin:0}}>AlphaQuant</h1>
          <p style={{fontSize:13,color:"#475569",marginTop:4}}>Transformer 量化交易研究平台</p>
        </div>

        {/* Card */}
        <div style={{background:"#131929",border:"1px solid rgba(255,255,255,0.07)",borderRadius:16,padding:32}}>
          {/* Tab */}
          <div style={{display:"flex",background:"#0b0e17",borderRadius:10,padding:4,marginBottom:28,border:"1px solid rgba(255,255,255,0.06)"}}>
            {["login","register"].map(m => (
              <button key={m} onClick={()=>setMode(m)} style={{flex:1,padding:"8px 0",borderRadius:7,fontSize:13,fontWeight:500,border:"none",cursor:"pointer",transition:"all 0.15s",
                background: mode===m?"#1e2a45":"transparent",
                color: mode===m?"#a5b4fc":"#475569",
              }}>
                {m==="login"?"登入":"註冊"}
              </button>
            ))}
          </div>

          <form onSubmit={submit}>
            <div style={{marginBottom:16}}>
              <label style={{display:"block",fontSize:11,fontWeight:500,color:"#64748b",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em"}}>帳號</label>
              <input required autoFocus value={u} onChange={e=>setU(e.target.value)} placeholder="your_username"
                className="input-dark" />
            </div>
            <div style={{marginBottom:24,position:"relative"}}>
              <label style={{display:"block",fontSize:11,fontWeight:500,color:"#64748b",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em"}}>密碼</label>
              <input required type={show?"text":"password"} value={p} onChange={e=>setP(e.target.value)} placeholder="••••••••"
                className="input-dark" style={{paddingRight:40}} />
              <button type="button" onClick={()=>setShow(s=>!s)}
                style={{position:"absolute",right:12,top:34,background:"none",border:"none",cursor:"pointer",color:"#4b5563",padding:0}}>
                {show ? <EyeOff size={15}/> : <Eye size={15}/>}
              </button>
            </div>

            <button type="submit" disabled={loading} style={{
              width:"100%",padding:"11px 0",borderRadius:9,fontSize:14,fontWeight:600,
              color:"#fff",border:"none",cursor:"pointer",transition:"all 0.15s",
              background: loading?"#3730a3":"linear-gradient(135deg,#6366f1,#8b5cf6)",
              opacity: loading?0.7:1,
            }}>
              {loading ? "處理中…" : mode==="login" ? "登入" : "建立帳號"}
            </button>
          </form>
        </div>

        <p style={{textAlign:"center",fontSize:11,color:"#374151",marginTop:20}}>
          本平台僅供量化研究，不構成任何投資建議
        </p>
      </div>
    </div>
  );
}
