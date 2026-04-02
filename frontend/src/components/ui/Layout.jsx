import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../../store/authStore";
import { TrendingUp, FlaskConical, LayoutDashboard, LogOut, Activity } from "lucide-react";
import clsx from "clsx";

const NAV = [
  { to: "/",               Icon: LayoutDashboard, label: "總覽" },
  { to: "/experiment/new", Icon: FlaskConical,     label: "新建實驗" },
];

export default function Layout() {
  const { pathname } = useLocation();
  const { logout, user } = useAuthStore();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen" style={{background:"#0b0e17"}}>
      {/* Sidebar */}
      <aside className="fixed top-0 left-0 h-full flex flex-col"
        style={{width:220, background:"#0e1220", borderRight:"1px solid rgba(255,255,255,0.06)", zIndex:50}}>

        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5" style={{borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
          <div style={{width:32,height:32,borderRadius:8,background:"linear-gradient(135deg,#6366f1,#8b5cf6)",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <TrendingUp size={16} color="#fff" />
          </div>
          <div>
            <p style={{fontWeight:700,fontSize:14,color:"#f1f5f9",letterSpacing:"-0.02em"}}>AlphaQuant</p>
            <p style={{fontSize:10,color:"#475569"}}>量化交易平台</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5">
          {NAV.map(({to,Icon,label}) => {
            const active = pathname === to;
            return (
              <Link key={to} to={to}
                style={{
                  display:"flex", alignItems:"center", gap:10, padding:"9px 12px",
                  borderRadius:8, fontSize:13, fontWeight: active?600:400,
                  color: active?"#a5b4fc":"#94a3b8",
                  background: active?"rgba(99,102,241,0.12)":"transparent",
                  transition:"all 0.15s",
                }}>
                <Icon size={15} />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* User */}
        <div className="p-3" style={{borderTop:"1px solid rgba(255,255,255,0.06)"}}>
          <div className="flex items-center gap-2.5 px-2 py-2 mb-1">
            <div style={{width:28,height:28,borderRadius:"50%",background:"linear-gradient(135deg,#6366f1,#8b5cf6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#fff"}}>
              {(user?.username?.[0] ?? "U").toUpperCase()}
            </div>
            <div>
              <p style={{fontSize:12,fontWeight:500,color:"#e2e8f0"}}>{user?.username ?? "User"}</p>
              <p style={{fontSize:10,color:"#475569"}}>{user?.tier ?? "free"}</p>
            </div>
          </div>
          <button onClick={() => { logout(); navigate("/login"); }}
            style={{display:"flex",alignItems:"center",gap:8,width:"100%",padding:"8px 12px",borderRadius:8,fontSize:12,color:"#64748b",background:"transparent",border:"none",cursor:"pointer",transition:"all 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.color="#f87171"}
            onMouseLeave={e=>e.currentTarget.style.color="#64748b"}>
            <LogOut size={13} />
            登出
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={{marginLeft:220,flex:1,padding:"32px 40px",minHeight:"100vh"}}>
        <Outlet />
      </main>
    </div>
  );
}
