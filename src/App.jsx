import { useState, useEffect, useRef, useMemo } from "react";

// ── STORAGE ───────────────────────────────────────────────────────────────────
// localStorage 기반 스토리지 (브라우저 직접 동작)
const store = {
  async get(k) { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch { return null; } },
  async set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ── HELPERS ───────────────────────────────────────────────────────────────────
const uid      = () => Date.now().toString(36) + Math.random().toString(36).slice(2,5);
const fmt      = n  => n.toLocaleString("ko-KR")+"원";
const today    = () => new Date().toISOString().split("T")[0];
const daysDiff = d  => Math.floor((new Date() - new Date(d)) / 86400000);
const fill     = (tpl="", vars={}) => tpl.replace(/\{(\w+)\}/g, (_,k) => vars[k] ?? "");
// ▼ 저장 함수 통합 — setter + storage key를 받아 업데이터 반환
const makeUp   = (setter, key) => v => { setter(v); store.set(key, v); };

// ── SHARED STYLES ─────────────────────────────────────────────────────────────
const S = {
  // 레이아웃
  row:         { display:"flex", justifyContent:"space-between", alignItems:"center" },
  rowMid:      { display:"flex", alignItems:"center" },
  // 텍스트
  sub:         { fontSize:11, color:"#888" },
  hint:        { fontSize:10, color:"#AAA", marginTop:2 },
  muted:       { fontSize:11, color:"#AAA", marginTop:2 },
  // 알림 카드 배경 (색상별)
  alertRed:    { background:"#FFF5F5",  borderRadius:14, padding:"14px 16px", marginBottom:10, border:"1px solid #FECACA" },
  alertGreen:  { background:"#F0FDF4",  borderRadius:14, padding:"14px 16px", marginBottom:14, border:"1px solid #BBF7D0" },
  alertBlue:   { background:"#EFF6FF",  borderRadius:12, padding:"10px 14px", marginBottom:12, border:"1px solid #DBEAFE" },
  alertYellow: { background:"#FFFBEB",  borderRadius:14, padding:"14px",      marginBottom:14, border:"1px solid #FEF3C7" },
  alertPurple: { background:"#F5F3FF",  borderRadius:14, padding:"14px",      marginBottom:14, border:"1px solid #DDD6FE" },
};

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const HAIKU        = "claude-haiku-4-5-20251001";
const USAGE_LIMITS = { vision:4, chat:20, kakao:10 };

const tryUseQuota = async (type) => {
  const d = today();
  const raw = await store.get("w4-usage");
  const u = (raw?.date===d) ? raw : {date:d,vision:0,chat:0,kakao:0};
  if ((u[type]||0) >= USAGE_LIMITS[type]) return false;
  await store.set("w4-usage", {...u, [type]:(u[type]||0)+1});
  return true;
};
const getQuotaLeft = async (type) => {
  const d = today();
  const raw = await store.get("w4-usage");
  const u = (raw?.date===d) ? raw : {date:d,vision:0,chat:0,kakao:0};
  return Math.max(0, USAGE_LIMITS[type] - (u[type]||0));
};

let aiCardsCache = { fp:"", cards:null };

// ── SEED DATA ─────────────────────────────────────────────────────────────────
const SEED_CUSTOMERS = [];
const SEED_QUOTES = [];
const SEED_SCHEDULES = [];
const DEFAULT_MATERIALS = [
  {id:"m1",label:"기본 청소 (10평)",price:100000,category:"기본"},
  {id:"m2",label:"기본 청소 (20평)",price:160000,category:"기본"},
  {id:"m3",label:"기본 청소 (30평)",price:220000,category:"기본"},
  {id:"m4",label:"기본 청소 (40평)",price:300000,category:"기본"},
  {id:"m5",label:"냉장고 내부 청소",price:30000,category:"추가"},
  {id:"m6",label:"에어컨 필터 청소",price:20000,category:"추가"},
  {id:"m7",label:"욕실 곰팡이 제거",price:25000,category:"추가"},
  {id:"m8",label:"베란다 물청소",price:30000,category:"추가"},
  {id:"m9",label:"오븐/가스레인지",price:35000,category:"추가"},
  {id:"m10",label:"붙박이장 내부",price:20000,category:"추가"},
];
const INTERIOR_MATERIALS = [
  {id:"im1",label:"철거 (10평)",price:1500000,category:"기본"},
  {id:"im2",label:"철거 (20평)",price:2500000,category:"기본"},
  {id:"im3",label:"철거 (30평)",price:3500000,category:"기본"},
  {id:"im4",label:"목공 (10평)",price:2000000,category:"기본"},
  {id:"im5",label:"목공 (20평)",price:3200000,category:"기본"},
  {id:"im6",label:"목공 (30평)",price:4500000,category:"기본"},
  {id:"im7",label:"도배-합지 (10평)",price:500000,category:"기본"},
  {id:"im8",label:"도배-실크 (10평)",price:800000,category:"기본"},
  {id:"im9",label:"장판 (10평)",price:600000,category:"기본"},
  {id:"im10",label:"강마루 (10평)",price:1200000,category:"기본"},
  {id:"im11",label:"욕실 리모델링 (1개소)",price:3500000,category:"추가"},
  {id:"im12",label:"주방 싱크대 교체",price:2500000,category:"추가"},
  {id:"im13",label:"타일 시공",price:1500000,category:"추가"},
  {id:"im14",label:"조명 교체",price:1500000,category:"추가"},
  {id:"im15",label:"전기 공사",price:1000000,category:"추가"},
  {id:"im16",label:"도장/페인트",price:800000,category:"추가"},
  {id:"im17",label:"붙박이장 설치",price:1500000,category:"추가"},
  {id:"im18",label:"창호/샷시 교체",price:5000000,category:"추가"},
  {id:"im19",label:"폐기물 처리",price:500000,category:"추가"},
  {id:"im20",label:"현관 타일",price:300000,category:"추가"},
];
const DEFAULT_PROFILE  = {bizName:"우리 업체",ownerName:"",phone:"",intro:"",industry:"청소"};
const DEFAULT_WORKERS  = [];
const DEFAULT_COSTS = {
  laborPerDay: 250000,
  materialRate: 30,
  fixedMonthly: 500000,
  taxRate: 10,
};
const INTERIOR_INVENTORY = [
  {id:"inv1",label:"실리콘",unit:"개",stock:10,minStock:3,perJob:1},
  {id:"inv2",label:"마스킹 테이프",unit:"개",stock:20,minStock:5,perJob:2},
  {id:"inv3",label:"사포",unit:"장",stock:30,minStock:10,perJob:5},
  {id:"inv4",label:"페인트 롤러",unit:"개",stock:5,minStock:2,perJob:1},
];
const DEFAULT_INVENTORY = [
  {id:"inv1",label:"다목적 세제",unit:"개",stock:5,minStock:2,perJob:0.5},
  {id:"inv2",label:"욕실 곰팡이 제거제",unit:"개",stock:3,minStock:1,perJob:0.3},
  {id:"inv3",label:"극세사 걸레",unit:"장",stock:20,minStock:5,perJob:2},
  {id:"inv4",label:"비닐장갑",unit:"켤레",stock:30,minStock:10,perJob:1},
];
const getDefaultMessages = (industry) => ({
  movingSeason1: industry==="인테리어"
    ? "봄 리모델링 시즌 특별 이벤트! 3~4월 시공 예약 시 도배 무료 제공 🏠\n인테리어 공사는 {bizName}에게 맡겨주세요. 꼼꼼하게 시공해드립니다!"
    : "봄 이사철 맞이 특별 이벤트! 3~4월 예약 시 에어컨 필터 청소 무료 제공 🏠\n이사 전후 청소는 {bizName}에게 맡겨주세요. 빠르고 꼼꼼하게 해드립니다!",
  movingSeason2: industry==="인테리어"
    ? "리모델링 계획 있으신가요? 합리적인 가격으로 새 공간 만들어드릴게요 😊\n지금 예약하시면 우선 배정해드립니다!"
    : "이사 앞두고 계신가요? 합리적인 가격으로 새 집 새 출발 도와드릴게요 😊\n지금 예약하시면 우선 배정해드립니다!",
  referral:"안녕하세요 {name}님 😊\n작업이 만족스러우셨으면 좋겠습니다!\n혹시 지인분 중에 필요하신 분이 계시다면 저희를 소개해주세요 🙏\n소개해주신 분께는 10% 할인 혜택 드립니다!",
  review:"안녕하세요 {name}님!\n오늘 작업은 만족스러우셨나요? 😊\n짧은 후기 한 줄만 남겨주시면 저희에게 큰 도움이 됩니다 🙏\n감사합니다!",
  overdue:"안녕하세요 {name}님 😊\n지난번 작업 관련하여 입금 확인이 어려워 연락드립니다.\n{amount} 입금 부탁드립니다. 감사합니다!",
});
const DEFAULT_MESSAGES = getDefaultMessages("청소");

const KR_HOLIDAYS = new Set([
  "2025-01-01","2025-01-28","2025-01-29","2025-01-30","2025-03-01","2025-05-05","2025-05-06","2025-06-06","2025-08-15","2025-10-03","2025-10-05","2025-10-06","2025-10-07","2025-10-09","2025-12-25",
  "2026-01-01","2026-01-28","2026-01-29","2026-01-30","2026-03-01","2026-05-05","2026-05-25","2026-06-06","2026-08-15","2026-09-24","2026-09-25","2026-09-26","2026-10-03","2026-10-09","2026-12-25",
]);

const PRIORITY_STYLE = {
  red:    {border:"#EF4444",bg:"#FFF5F5"},
  yellow: {border:"#F59E0B",bg:"#FFFBEB"},
  green:  {border:"#10B981",bg:"#F0FDF4"},
  blue:   {border:"#3B82F6",bg:"#EFF6FF"},
};

// ── APP ───────────────────────────────────────────────────────────────────────
function OnboardingModal({profile,upP,customers,upC,onClose}){
  const [step,setStep]=useState(1);
  const [bizName,setBizName]=useState(profile.bizName||"");
  const [phone,setPhone]=useState(profile.phone||"");
  const [industry,setIndustry]=useState(profile.industry||"청소");
  const [custName,setCustName]=useState("");
  const [custPhone,setCustPhone]=useState("");

  const steps=[
    {num:1,label:"업체 설정"},
    {num:2,label:"첫 고객 등록"},
    {num:3,label:"AI 기능 소개"},
  ];

  const saveProfile=()=>{
    if(!bizName.trim()) return;
    upP({...profile,bizName,phone,industry});
    store.set("w4-inventory", JSON.stringify(industry==="인테리어" ? INTERIOR_INVENTORY : DEFAULT_INVENTORY));
    store.set("w4-messages", JSON.stringify(getDefaultMessages(industry)));
    store.set("w4-materials", JSON.stringify(industry==="인테리어" ? INTERIOR_MATERIALS : DEFAULT_MATERIALS));
    setStep(2);
  };

  const saveCustomer=()=>{
    if(!custName.trim()) return;
    const c={id:uid(),name:custName,phone:custPhone,address:"",notes:"",createdAt:today()};
    upC([...customers,c]);
    setStep(3);
  };

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:"24px"}}>
      <div style={{background:"#fff",borderRadius:24,padding:"28px 24px",width:"100%",maxWidth:380,boxSizing:"border-box"}}>

        {/* 상단 진행바 */}
        <div style={{display:"flex",gap:6,marginBottom:24}}>
          {steps.map(s=>(
            <div key={s.num} style={{flex:1,height:4,borderRadius:99,background:step>=s.num?"#111":"#EEEEE9",transition:"background 0.3s"}}/>
          ))}
        </div>

        {step===1&&(
          <div>
            <div style={{fontSize:22,fontWeight:900,color:"#111",marginBottom:6}}>안녕하세요! 👋</div>
            <div style={{fontSize:14,color:"#555",lineHeight:1.7,marginBottom:20}}>
              사장님의 시간을 아껴드립니다.<br/><br/>
              카톡으로 견적 보내는 데 얼마나 걸리세요? WORKOS로 1분 안에 끝냅니다. 고객·일정·미수금까지 한 곳에서 관리하세요.<br/><br/>
              먼저 업체 정보를 입력해볼게요 😊
            </div>
            <div style={{fontSize:12,fontWeight:700,color:"#666",marginBottom:6}}>업종 선택 *</div>
<div style={{display:"flex",gap:8,marginBottom:16}}>
  {["청소","인테리어"].map(ind=>(
    <button key={ind} onClick={()=>setIndustry(ind)} style={{flex:1,padding:"12px",background:industry===ind?"#111":"transparent",color:industry===ind?"#fff":"#888",border:`1.5px solid ${industry===ind?"#111":"#EEEEE9"}`,borderRadius:12,fontSize:14,fontWeight:industry===ind?700:400,cursor:"pointer",fontFamily:"inherit"}}>
      {ind==="청소"?"🧹 청소업":"🔨 인테리어"}
    </button>
  ))}
</div>
            <div style={{fontSize:12,fontWeight:700,color:"#666",marginBottom:6}}>업체명 *</div>
            <input value={bizName} onChange={e=>setBizName(e.target.value)} placeholder="예: 깔끔이사청소" style={{width:"100%",border:"1.5px solid #EEEEE9",borderRadius:12,padding:"12px 14px",fontSize:14,fontFamily:"inherit",outline:"none",background:"#FAFAF7",boxSizing:"border-box",marginBottom:10,color:"#111"}}/>
            <div style={{fontSize:12,fontWeight:700,color:"#666",marginBottom:6}}>업체 연락처</div>
            <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="010-0000-0000" style={{width:"100%",border:"1.5px solid #EEEEE9",borderRadius:12,padding:"12px 14px",fontSize:14,fontFamily:"inherit",outline:"none",background:"#FAFAF7",boxSizing:"border-box",marginBottom:20,color:"#111"}}/>
            <button onClick={saveProfile} disabled={!bizName.trim()} style={{width:"100%",padding:14,background:!bizName.trim()?"#EEEEE9":"#111",color:!bizName.trim()?"#AAA":"#fff",border:"none",borderRadius:14,fontSize:15,fontWeight:700,cursor:!bizName.trim()?"not-allowed":"pointer",fontFamily:"inherit",marginBottom:10}}>다음</button>
            <button onClick={onClose} style={{width:"100%",padding:12,background:"transparent",color:"#AAA",border:"none",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>건너뛰기</button>
          </div>
        )}

        {step===2&&(
          <div>
            <div style={{fontSize:22,fontWeight:900,color:"#111",marginBottom:6}}>첫 고객을 등록해요 📋</div>
            <div style={{fontSize:14,color:"#555",lineHeight:1.7,marginBottom:20}}>
              고객 정보 기억하느라 머리 쓰지 마세요. 한 번 저장하면 재계약·일정·미수금 관리가 자동으로 연결됩니다.<br/><br/>
              카카오 대화를 붙여넣으면 AI가 자동으로 정보를 추출해주는 기능도 있답니다 ✨
            </div>
            <div style={{fontSize:12,fontWeight:700,color:"#666",marginBottom:6}}>고객명 *</div>
            <input value={custName} onChange={e=>setCustName(e.target.value)} placeholder="예: 김민정" style={{width:"100%",border:"1.5px solid #EEEEE9",borderRadius:12,padding:"12px 14px",fontSize:14,fontFamily:"inherit",outline:"none",background:"#FAFAF7",boxSizing:"border-box",marginBottom:10,color:"#111"}}/>
            <div style={{fontSize:12,fontWeight:700,color:"#666",marginBottom:6}}>연락처</div>
            <input value={custPhone} onChange={e=>setCustPhone(e.target.value)} placeholder="010-0000-0000" style={{width:"100%",border:"1.5px solid #EEEEE9",borderRadius:12,padding:"12px 14px",fontSize:14,fontFamily:"inherit",outline:"none",background:"#FAFAF7",boxSizing:"border-box",marginBottom:20,color:"#111"}}/>
            <button onClick={saveCustomer} disabled={!custName.trim()} style={{width:"100%",padding:14,background:!custName.trim()?"#EEEEE9":"#111",color:!custName.trim()?"#AAA":"#fff",border:"none",borderRadius:14,fontSize:15,fontWeight:700,cursor:!custName.trim()?"not-allowed":"pointer",fontFamily:"inherit",marginBottom:10}}>다음</button>
            <button onClick={onClose} style={{width:"100%",padding:12,background:"transparent",color:"#AAA",border:"none",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>건너뛰기</button>
          </div>
        )}

        {step===3&&(
          <div>
            <div style={{fontSize:22,fontWeight:900,color:"#111",marginBottom:6}}>이런 기능들이 있어요 🤖</div>
            <div style={{fontSize:13,color:"#555",lineHeight:1.7,marginBottom:16}}>사장님 시간을 아껴주는 기능들이에요 ⏱️</div>
            {[
              {icon:"✨",title:"카카오 대화 자동 추출",desc:"고객 카톡 내용 붙여넣으면 AI가 이름·주소·날짜 자동 추출"},
              {icon:"📸",title:"사진 분석 견적",desc:"하자 사진 찍으면 AI가 추가 청소 항목과 금액 자동 제안"},
              {icon:"📱",title:"견적서 카톡 문구 생성",desc:"항목 선택만 하면 보내기 좋은 카카오 문구 자동 완성"},
              {icon:"🤖",title:"AI 운영 도우미",desc:"매출·미수금·재고 등 뭐든 물어보면 데이터 기반으로 답변"},
            ].map(f=>(
              <div key={f.title} style={{display:"flex",gap:12,alignItems:"flex-start",marginBottom:14,background:"#F7F7F4",borderRadius:12,padding:"12px 14px"}}>
                <div style={{fontSize:20,flexShrink:0}}>{f.icon}</div>
                <div><div style={{fontSize:13,fontWeight:700,color:"#111",marginBottom:2}}>{f.title}</div><div style={{fontSize:11,color:"#888",lineHeight:1.5}}>{f.desc}</div></div>
              </div>
            ))}
            <button onClick={onClose} style={{width:"100%",padding:14,background:"#111",color:"#fff",border:"none",borderRadius:14,fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginTop:6}}>시작하기 🚀</button>
          </div>
        )}

      </div>
    </div>
  );
}
export default function App() {
  const [tab,setTab]             = useState("home");
  const [customers,setCustomers] = useState([]);
  const [quotes,setQuotes]       = useState([]);
  const [schedules,setSchedules] = useState([]);
  const [materials,setMaterials] = useState([]);
  const [profile,setProfile]     = useState(DEFAULT_PROFILE);
  const [workers,setWorkers]     = useState([]);
  const [inventory,setInventory] = useState([]);
  const [messages,setMessages]   = useState(DEFAULT_MESSAGES);
  const [loaded,setLoaded]       = useState(false);
  const [showOnboarding,setShowOnboarding] = useState(false);
  const [costs,setCosts] = useState(DEFAULT_COSTS);

  useEffect(()=>{
    (async()=>{
      setCustomers(await store.get("w4-customers")||SEED_CUSTOMERS);
      setQuotes(await store.get("w4-quotes")||SEED_QUOTES);
      setSchedules(await store.get("w4-schedules")||SEED_SCHEDULES);
      const savedProfile = await store.get("w4-profile")||DEFAULT_PROFILE;
      const defaultMats = savedProfile.industry==="인테리어" ? INTERIOR_MATERIALS : DEFAULT_MATERIALS;
      setMaterials(await store.get("w4-materials")||defaultMats);
      setProfile(savedProfile);
      setWorkers(await store.get("w4-workers")||DEFAULT_WORKERS);
      const defaultInv = savedProfile.industry==="인테리어" ? INTERIOR_INVENTORY : DEFAULT_INVENTORY;
      setInventory(await store.get("w4-inventory")||defaultInv);
      setMessages(await store.get("w4-messages")||getDefaultMessages(savedProfile.industry||"청소"));
      setCosts(await store.get("w4-costs")||DEFAULT_COSTS);
      const done = await store.get("w4-onboarding-done");
      if(!done) setShowOnboarding(true);
      setLoaded(true);
    })();
  },[]);

  // ▼ makeUp으로 통합 — 8개의 동일한 패턴을 한 줄씩으로 축약
  const upC   = makeUp(setCustomers, "w4-customers");
  const upQ   = makeUp(setQuotes,    "w4-quotes");
  const upS   = makeUp(setSchedules, "w4-schedules");
  const upM   = makeUp(setMaterials, "w4-materials");
  const upP   = makeUp(setProfile,   "w4-profile");
  const upW   = makeUp(setWorkers,   "w4-workers");
  const upI   = makeUp(setInventory, "w4-inventory");
  const upMsg = makeUp(setMessages,  "w4-messages");
  const upCosts = makeUp(setCosts, "w4-costs");

  if(!loaded) return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"sans-serif",color:"#999"}}>불러오는 중…</div>;

  const TABS=[
    {id:"home",    icon:"⌂", label:"홈"},
    {id:"clients", icon:"◈", label:"고객·견적"},
    {id:"schedule",icon:"◷", label:"일정"},
    {id:"stats",   icon:"▦", label:"분석"},
    {id:"more",    icon:"⋯", label:"더보기"},
  ];

  return (
    <div style={{minHeight:"100vh",background:"#F7F7F4",fontFamily:"'Noto Sans KR',sans-serif",maxWidth:430,margin:"0 auto",boxShadow:"0 0 60px rgba(0,0,0,0.07)"}}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap" rel="stylesheet"/>
      <div style={{paddingBottom:72}}>
        {showOnboarding && (
          <OnboardingModal
            profile={profile}
            upP={upP}
            customers={customers}
            upC={upC}
            onClose={()=>{store.set("w4-onboarding-done",true);setShowOnboarding(false);}}
          />
        )}
        {tab==="home"     && <HomeTab     customers={customers} quotes={quotes} schedules={schedules} profile={profile} workers={workers} inventory={inventory} messages={messages} setTab={setTab}/>}
        {tab==="clients"  && <ClientsTab  customers={customers} quotes={quotes} schedules={schedules} materials={materials} profile={profile} messages={messages} upC={upC} upQ={upQ} upS={upS}/>}
        {tab==="schedule" && <ScheduleTab schedules={schedules} upS={upS}/>}
        {tab==="stats"    && <StatsTab    quotes={quotes} customers={customers}/>}
        {tab==="more"     && <MoreTab     materials={materials} profile={profile} quotes={quotes} customers={customers} schedules={schedules} workers={workers} inventory={inventory} messages={messages} costs={costs} upM={upM} upP={upP} upW={upW} upI={upI} upMsg={upMsg} upCosts={upCosts}/>}
      </div>
      <nav style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,background:"#fff",borderTop:"1px solid #EEEEE9",display:"flex",zIndex:999}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,padding:"10px 0 12px",background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <span style={{fontSize:17,opacity:tab===t.id?1:0.3}}>{t.icon}</span>
            <span style={{fontSize:9,fontFamily:"inherit",color:tab===t.id?"#111":"#BBB",fontWeight:tab===t.id?700:400}}>{t.label}</span>
            {tab===t.id&&<span style={{width:3,height:3,borderRadius:"50%",background:"#111"}}/>}
          </button>
        ))}
      </nav>
    </div>
  );
}

// ── ACTION CARDS ──────────────────────────────────────────────────────────────
function ActionCards({customers,quotes,schedules,workers,inventory,setTab}){
  const [collapsed,setCollapsed]=useState(false);
  const [dismissed,setDismissed]=useState(new Set());
  const [aiCards,setAiCards]=useState(null);
  const [aiLoading,setAiLoading]=useState(false);
  const fpRef=useRef(null);
  const [copyOk,setCopyOk]=useState({});

  const fingerprint=[
    customers.length,
    quotes.filter(q=>q.payStatus==="미수금").length,
    quotes.filter(q=>q.status==="검토중").length,
    inventory.filter(i=>i.stock<=i.minStock).length,
    schedules.filter(s=>s.status==="예정").length,
    workers.filter(w=>w.isActive).length,
  ].join("|");

  useEffect(()=>{
    (async()=>{
      const [col,dis]=await Promise.all([store.get("w4-cards-collapsed"),store.get("w4-dismissed-cards")]);
      setCollapsed(!!col);
      if(dis?.fp===fingerprint) setDismissed(new Set(dis.ids));
      fpRef.current=fingerprint;
      if(aiCardsCache.fp===fingerprint&&aiCardsCache.cards!==null){setAiCards(aiCardsCache.cards);}
      else generateAiCards(fingerprint);
    })();
  },[]);

  useEffect(()=>{
    if(fpRef.current===null||fpRef.current===fingerprint) return;
    fpRef.current=fingerprint;
    setDismissed(new Set());
    store.set("w4-dismissed-cards",{fp:fingerprint,ids:[]});
    if(aiCardsCache.fp!==fingerprint){setAiCards(null);generateAiCards(fingerprint);}
  },[fingerprint]);

  const generateAiCards=async(fp)=>{
    setAiLoading(true);
    try{
      const month=new Date().getMonth()+1;
      const isMovingSeason=[2,3,4,9,10].includes(month);
      const completed=quotes.filter(q=>q.status==="계약완료");
      const convRate=quotes.length>0?Math.round(completed.length/quotes.length*100):0;
      const thisMonth=new Date().toISOString().slice(0,7);
      const payload={
        month,isMovingSeason,
        customers:customers.slice(-20).map(c=>({name:c.name,createdAt:c.createdAt})),
        quotes:quotes.slice(-20).map(q=>({customerName:q.customerName,total:q.total,status:q.status,payStatus:q.payStatus,date:q.date,createdAt:q.createdAt})),
        schedules:schedules.slice(-10).map(s=>({date:s.date,status:s.status})),
        workers:workers.map(w=>({name:w.name,isActive:w.isActive,specialty:w.specialty})),
        inventory:inventory.map(i=>({label:i.label,stock:i.stock,minStock:i.minStock,perJob:i.perJob})),
        stats:{convRate,monthRev:completed.filter(q=>q.date?.startsWith(thisMonth)).reduce((s,q)=>s+q.total,0),unpaidCount:quotes.filter(q=>q.payStatus==="미수금").length,activeWorkers:workers.filter(w=>w.isActive).length,upcomingCount:schedules.filter(s=>s.date>=today()&&s.status==="예정").length},
      };
        // Vercel 서버리스 필요
      const res=await fetch("/api/chat",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model:HAIKU,max_tokens:700,messages:[{role:"user",content:`너는 이사청소 업체 운영 AI야. 데이터를 종합해서 사장님이 지금 해야 할 액션 카드 최대 3개 생성.\n규칙 기반(미수금/재고부족/팔로업)은 이미 있으니 AI만 판단할 종합 인사이트만.\n반드시 JSON 배열만 응답. 마크다운 없음.\n[{"priority":"red|yellow|green|blue","title":"짧은제목","desc":"한줄설명","action":"버튼텍스트","actionType":"copy|navigate","actionTarget":"복사내용 또는 clients/schedule/more","dismissible":true}]\n없으면 []\n\n데이터:\n${JSON.stringify(payload)}`}]})
      });
      const data=await res.json();
      const raw=data.content?.[0]?.text||"[]";
      const match=raw.match(/\[[\s\S]*\]/);
      const cards=JSON.parse(match?match[0]:"[]");
      const withIds=cards.map((c,i)=>({...c,id:`ai-${i}-${Date.now()}`}));
      aiCardsCache={fp,cards:withIds};
      setAiCards(withIds);
    }catch{aiCardsCache={fp,cards:[]};setAiCards([]);}
    setAiLoading(false);
  };

  const ruleCards=useMemo(()=>{
    const cards=[];
    const unpaid=quotes.filter(q=>q.payStatus==="미수금");
    if(unpaid.length>0) cards.push({id:"rule-unpaid",priority:"red",title:`미수금 ${unpaid.length}건`,desc:`총 ${fmt(unpaid.reduce((s,q)=>s+q.total,0))} — 입금 확인 필요`,action:"독촉 문자 복사",actionType:"copy",actionTarget:unpaid.map(q=>`[${q.customerName}님] ${fmt(q.total)} 입금 부탁드립니다 😊`).join("\n"),dismissible:false});
    const stale=quotes.filter(q=>q.status==="검토중"&&daysDiff(q.createdAt||q.date)>=14);
    if(stale.length>0) cards.push({id:"rule-stale",priority:"yellow",title:`팔로업 필요 ${stale.length}건`,desc:"14일 이상 답변 없는 견적이 있어요",action:"고객·견적으로",actionType:"navigate",actionTarget:"clients",dismissible:true});
    const lowStock=inventory.filter(i=>i.stock<=i.minStock);
    if(lowStock.length>0) cards.push({id:"rule-stock",priority:"blue",title:`재고 부족 ${lowStock.length}개`,desc:lowStock.map(i=>i.label).join(", "),action:"재고 관리로",actionType:"navigate",actionTarget:"more",dismissible:true});
    return cards;
  },[quotes,inventory]);

  const allRaw=[...ruleCards,...(aiCards||[])];
  const visible=allRaw.filter(c=>!dismissed.has(c.id));

  const dismiss=async(id)=>{
    const next=new Set([...dismissed,id]);
    setDismissed(next);
    store.set("w4-dismissed-cards",{fp:fingerprint,ids:[...next]});
  };
  const toggleCollapse=()=>{const next=!collapsed;setCollapsed(next);store.set("w4-cards-collapsed",next);};
  const handleAction=async(card)=>{
    if(card.actionType==="navigate") setTab(card.actionTarget);
    else{
      try{await navigator.clipboard.writeText(card.actionTarget);}catch{}
      setCopyOk(p=>({...p,[card.id]:true}));
      setTimeout(()=>setCopyOk(p=>({...p,[card.id]:false})),2000);
    }
  };

  return(
    <div style={{marginBottom:14}}>
      <div style={{...S.row,marginBottom:8}}>
        <div style={{...S.rowMid,gap:7}}>
          <span style={{fontSize:13,fontWeight:700,color:"#111"}}>AI 액션</span>
          {(visible.length>0||aiLoading)&&<span style={{fontSize:10,background:"#111",color:"#fff",padding:"2px 8px",borderRadius:99,fontWeight:700}}>{aiLoading&&visible.length===0?"…":visible.length}</span>}
        </div>
        <button onClick={toggleCollapse} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:"#888",fontFamily:"inherit"}}>{collapsed?"펼치기":"접기"}</button>
      </div>
      {!collapsed&&(
        <div>
          {aiLoading&&[0,1].map(i=>(
            <div key={i} style={{background:"#F7F7F4",borderRadius:14,padding:"14px 16px",marginBottom:8,border:"1px solid #EEEEE9",borderLeft:"3px solid #E0E0DB",animation:"skPulse 1.4s ease infinite"}}>
              <div style={{height:11,background:"#EEEEE9",borderRadius:6,width:"55%",marginBottom:8}}/>
              <div style={{height:9,background:"#EEEEE9",borderRadius:6,width:"75%",marginBottom:12}}/>
              <div style={{height:26,background:"#EEEEE9",borderRadius:8,width:"30%"}}/>
            </div>
          ))}
          {visible.map(card=>{
            const st=PRIORITY_STYLE[card.priority]||PRIORITY_STYLE.blue;
            return(
              <div key={card.id} style={{background:st.bg,borderRadius:14,padding:"14px 16px",marginBottom:8,borderLeft:`3px solid ${st.border}`,border:`1px solid ${st.border}33`,position:"relative"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#111",flex:1,paddingRight:card.dismissible?24:0}}>{card.title}</div>
                  {card.dismissible&&<button onClick={()=>dismiss(card.id)} style={{position:"absolute",top:12,right:12,background:"none",border:"none",cursor:"pointer",color:"#BBB",fontSize:16,padding:0,lineHeight:1}}>×</button>}
                </div>
                <div style={{fontSize:11,color:"#555",marginBottom:10,lineHeight:1.5}}>{card.desc}</div>
                <button onClick={()=>handleAction(card)} style={{padding:"7px 14px",background:copyOk[card.id]?"#10B981":st.border,color:"#fff",border:"none",borderRadius:8,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",transition:"background 0.2s"}}>
                  {copyOk[card.id]?"✓ 복사됨":card.action}
                </button>
              </div>
            );
          })}
          {!aiLoading&&visible.length===0&&(
            <div style={{background:"#F0FDF4",borderRadius:14,padding:"16px",textAlign:"center",border:"1px solid #BBF7D0",marginBottom:4}}>
              <div style={{fontSize:13,color:"#059669",fontWeight:600}}>오늘 할 일이 없어요 ✓</div>
              <div style={{fontSize:11,color:"#888",marginTop:4}}>고객과 견적을 등록하면 AI가 할 일을 알려드려요</div>
            </div>
          )}
        </div>
      )}
      <style>{`@keyframes skPulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
    </div>
  );
}

// ── HOME ──────────────────────────────────────────────────────────────────────
function HomeTab({customers,quotes,schedules,profile,workers,inventory,messages,setTab}){
  const completed=quotes.filter(q=>q.status==="계약완료");
  const totalRev=completed.reduce((s,q)=>s+q.total,0);
  const unpaid=quotes.filter(q=>q.payStatus==="미수금");
  const unpaidTotal=unpaid.reduce((s,q)=>s+q.total,0);
  const upcoming=schedules.filter(s=>s.date>=today()).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,2);
  const thisMonth=new Date().toISOString().slice(0,7);
  const monthRev=completed.filter(q=>q.date?.startsWith(thisMonth)).reduce((s,q)=>s+q.total,0);
  const month=new Date().getMonth()+1;
  const isMovingSeason=[2,3,4,9,10].includes(month);
  const isInterior=profile.industry==="인테리어";
  const nextSeason=isInterior
    ?(month<=4?"봄 리모델링 시즌 (3~4월)":month<=9?"가을 리모델링 시즌 (9~10월)":"봄 리모델링 시즌 (3~4월)")
    :(month<=4?"봄 이사철 (3~4월)":month<=9?"가을 이사철 (9~10월)":"봄 이사철 (3~4월)");

  return(
    <div>
      <div style={{background:"#111",padding:"52px 24px 24px",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:-50,right:-50,width:180,height:180,borderRadius:"50%",background:"rgba(255,255,255,0.02)"}}/>
        <div style={{fontSize:10,color:"#555",letterSpacing:3,marginBottom:8}}>WORKOS · {profile.bizName} | 운영을 더 쉽게</div>
        <div style={{fontSize:11,color:"#666",marginBottom:4}}>누적 매출</div>
        <div style={{fontSize:34,fontWeight:900,color:"#fff",letterSpacing:-1}}>{fmt(totalRev)}</div>
        <div style={{fontSize:12,color:"#555",marginTop:4}}>이번달 {fmt(monthRev)}</div>
        {unpaidTotal>0&&(
          <div style={{marginTop:16,background:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.25)",borderRadius:12,padding:"10px 14px",...S.row}}>
            <div><div style={{fontSize:11,color:"#F87171",fontWeight:700}}>⚠ 미수금 {unpaid.length}건</div><div style={{fontSize:10,color:"#888",marginTop:1}}>입금 확인 필요</div></div>
            <div style={{fontSize:16,fontWeight:900,color:"#F87171"}}>{fmt(unpaidTotal)}</div>
          </div>
        )}
      </div>
      <div style={{padding:"16px 16px 0"}}>
        <ActionCards customers={customers} quotes={quotes} schedules={schedules} workers={workers} inventory={inventory} setTab={setTab}/>
        <div style={{background:isMovingSeason?"#111":"#fff",borderRadius:14,padding:"16px",marginBottom:12,border:isMovingSeason?"none":"1px solid #EEEEE9"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <div style={{fontSize:11,color:isMovingSeason?"#F0B429":"#AAA",fontWeight:700,marginBottom:4}}>{isMovingSeason?(isInterior?"🔨 지금 리모델링 시즌이에요!":"🔥 지금 이사철이에요!"):"📅 "+nextSeason+" 준비하세요"}</div>
              <div style={{fontSize:13,color:isMovingSeason?"#fff":"#555",fontWeight:isMovingSeason?700:400,lineHeight:1.6}}>{isMovingSeason?"홍보 문자·SNS 지금 올리면 효과 2배예요.":"이사철 전 미리 홍보를 준비해두세요."}</div>
            </div>
            <div style={{fontSize:28}}>{isMovingSeason?"🏠":"📋"}</div>
          </div>
          {isMovingSeason&&<MovingSeasonMsg bizName={profile.bizName} messages={messages}/>}
        </div>
        <div style={{display:"flex",gap:10,marginBottom:12}}>
          {[{l:"총 고객",v:customers.length+"명",c:"#3B82F6",t:"clients"},{l:"검토중",v:quotes.filter(q=>q.status==="검토중").length+"건",c:"#F59E0B",t:"clients"},{l:"예정 일정",v:upcoming.length+"건",c:"#10B981",t:"schedule"}].map(s=>(
            <div key={s.l} onClick={()=>setTab(s.t)} style={{flex:1,background:"#fff",borderRadius:14,padding:"14px",border:"1px solid #EEEEE9",cursor:"pointer",textAlign:"center"}}>
              <div style={{fontSize:22,fontWeight:900,color:s.c}}>{s.v}</div>
              <div style={S.hint}>{s.l}</div>
            </div>
          ))}
        </div>
        {upcoming.length>0&&(
          <div style={{marginBottom:12}}>
            <RL label="다가오는 일정" action="전체 →" onAction={()=>setTab("schedule")}/>
            {upcoming.map(s=>(
              <Card key={s.id}>
                <div style={S.row}>
                  <div><div style={{fontSize:14,fontWeight:700}}>{s.customerName}</div><div style={{...S.sub,marginTop:2}}>{s.address}</div></div>
                  <div style={{textAlign:"right"}}><div style={{fontSize:13,fontWeight:700,color:"#3B82F6"}}>{s.date}</div><div style={S.hint}>{s.time}</div></div>
                </div>
              </Card>
            ))}
          </div>
        )}
        {unpaid.length>0&&(
          <div style={{marginBottom:12}}>
            <RL label="💸 미수금 목록"/>
            {unpaid.map(q=>(
              <div key={q.id} style={{...S.alertRed,...S.row,marginBottom:8}}>
                <div><div style={{fontSize:14,fontWeight:700}}>{q.customerName}</div><div style={S.muted}>{q.date}</div></div>
                <div style={{textAlign:"right"}}><div style={{fontSize:15,fontWeight:900,color:"#EF4444"}}>{fmt(q.total)}</div><OverdueMsg name={q.customerName} amount={q.total} messages={messages}/></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MovingSeasonMsg({bizName,messages}){
  const [idx,setIdx]=useState(0);
  const [ok,setOk]=useState(false);
  const msgs=[fill(messages.movingSeason1,{bizName}),fill(messages.movingSeason2,{bizName})];
  const copy=async()=>{await navigator.clipboard.writeText(msgs[idx]);setOk(true);setTimeout(()=>setOk(false),2000);};
  return(
    <div style={{marginTop:12}}>
      <div style={{display:"flex",gap:6,marginBottom:8}}>
        {msgs.map((_,i)=><button key={i} onClick={()=>setIdx(i)} style={{padding:"4px 10px",background:idx===i?"#F0B429":"rgba(255,255,255,0.1)",color:idx===i?"#111":"#888",border:"none",borderRadius:99,fontSize:10,cursor:"pointer",fontWeight:idx===i?700:400}}>문구 {i+1}</button>)}
      </div>
      <div style={{background:"rgba(255,255,255,0.06)",borderRadius:10,padding:"10px 12px",fontSize:11,color:"#AAA",lineHeight:1.7,whiteSpace:"pre-wrap",marginBottom:8}}>{msgs[idx]}</div>
      <button onClick={copy} style={{width:"100%",padding:"10px",background:ok?"#10B981":"rgba(255,255,255,0.1)",color:ok?"#fff":"#CCC",border:"none",borderRadius:10,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>{ok?"✓ 복사됐어요!":"홍보 문구 복사"}</button>
    </div>
  );
}

function OverdueMsg({name,amount,messages}){
  const [ok,setOk]=useState(false);
  const msg=fill(messages.overdue,{name,amount:fmt(amount)});
  const copy=async()=>{await navigator.clipboard.writeText(msg);setOk(true);setTimeout(()=>setOk(false),1500);};
  return <button onClick={copy} style={{marginTop:4,padding:"3px 8px",background:ok?"#10B981":"#FEE2E2",color:ok?"#fff":"#EF4444",border:"none",borderRadius:6,fontSize:9,cursor:"pointer",fontFamily:"inherit",fontWeight:700}}>{ok?"✓복사":"독촉문자"}</button>;
}

// ── CUSTOMER TIMELINE ─────────────────────────────────────────────────────────
function CustomerTimeline({customer, quotes, schedules}) {
  const cqs = quotes.filter(q => q.customerId === customer.id);
  const cSched = schedules.filter(s => s.customerId === customer.id);

  const events = [];

  // 첫 문의 (고객 등록일)
  events.push({
    date: customer.createdAt,
    type: "문의",
    icon: "💬",
    color: "#8B5CF6",
    label: "첫 문의",
    desc: customer.notes ? `"${customer.notes}"` : "고객 등록됨",
  });

  // 견적 관련 이벤트
  cqs.forEach(q => {
    // 견적 발송
    events.push({
      date: q.createdAt || q.date,
      type: "견적",
      icon: "📋",
      color: "#3B82F6",
      label: `견적 발송`,
      desc: `${q.items?.map(i => i.label).join(", ")} · ${fmt(q.total)}`,
    });

    // 계약 완료
    if (q.status === "계약완료") {
      events.push({
        date: q.date,
        type: "계약",
        icon: "✅",
        color: "#10B981",
        label: "계약 완료",
        desc: `${fmt(q.total)} 계약 확정`,
      });
    }

    // 취소
    if (q.status === "취소") {
      events.push({
        date: q.date,
        type: "취소",
        icon: "❌",
        color: "#EF4444",
        label: "견적 취소",
        desc: fmt(q.total),
      });
    }

    // 입금 완료
    if (q.payStatus === "입금완료") {
      events.push({
        date: q.date,
        type: "결제",
        icon: "💰",
        color: "#F59E0B",
        label: "입금 완료",
        desc: `${fmt(q.total)} 수령`,
      });
    }

    // 미수금
    if (q.payStatus === "미수금") {
      events.push({
        date: q.date,
        type: "미수금",
        icon: "⚠️",
        color: "#EF4444",
        label: "미수금 발생",
        desc: `${fmt(q.total)} 미입금`,
      });
    }
  });

  // 작업 일정 이벤트
  cSched.forEach(s => {
    if (s.status === "완료") {
      events.push({
        date: s.date,
        type: "작업완료",
        icon: "🏠",
        color: "#10B981",
        label: "작업 완료",
        desc: s.actualHours ? `실소요 ${s.actualHours}h` : s.notes || "작업 완료",
      });
    } else if (s.status === "예정") {
      events.push({
        date: s.date,
        type: "작업예정",
        icon: "📅",
        color: "#3B82F6",
        label: "작업 예정",
        desc: `${s.time} · ${s.address || ""}`,
        future: s.date >= today(),
      });
    }
  });

  // 날짜순 정렬
  events.sort((a, b) => a.date.localeCompare(b.date));

  if (events.length === 0) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      <SL>고객 타임라인</SL>
      <div style={{ background: "#fff", borderRadius: 16, padding: "16px", border: "1px solid #EEEEE9" }}>
        {events.map((ev, i) => (
          <div key={i} style={{ display: "flex", gap: 12, position: "relative" }}>
            {/* 세로선 */}
            {i < events.length - 1 && (
              <div style={{
                position: "absolute", left: 17, top: 34,
                width: 2, height: "calc(100% - 10px)",
                background: ev.future ? "#EEEEE9" : "#F0F0F0",
                zIndex: 0,
              }} />
            )}
            {/* 아이콘 원 */}
            <div style={{
              width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
              background: ev.future ? "#F7F7F4" : `${ev.color}15`,
              border: `2px solid ${ev.future ? "#EEEEE9" : ev.color}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 15, zIndex: 1, position: "relative",
            }}>
              {ev.icon}
            </div>
            {/* 내용 */}
            <div style={{ flex: 1, paddingBottom: i < events.length - 1 ? 16 : 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{
                  fontSize: 13, fontWeight: 700,
                  color: ev.future ? "#AAA" : "#111",
                }}>
                  {ev.label}
                  {ev.future && (
                    <span style={{
                      marginLeft: 6, fontSize: 9, padding: "2px 6px",
                      background: "#DBEAFE", color: "#3B82F6",
                      borderRadius: 99, fontWeight: 700,
                    }}>예정</span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: "#AAA", flexShrink: 0, marginLeft: 8 }}>
                  {ev.date}
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#888", marginTop: 2, lineHeight: 1.5 }}>
                {ev.desc}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── CLIENTS ───────────────────────────────────────────────────────────────────
function ClientsTab({ customers, quotes, schedules, materials, profile, messages, upC, upQ, upS }) {
  const [view, setView] = useState("list");
  const [selCustomer, setSelCustomer] = useState(null);
  const [search, setSearch] = useState("");
  const [lastQ, setLastQ] = useState(null);
  const [cloneItems, setCloneItems] = useState(null);
  const [newCustForm, setNewCustForm] = useState({ name: "", phone: "", address: "", notes: "" });
  const filtered = customers.filter(c => c.name.includes(search) || c.phone.includes(search));

  if (view === "list") return (
    <div>
      <PH title="고객 · 견적" />
      <div style={{ padding: "0 16px" }}>
        <KakaoExtractor customers={customers} upC={upC} onDone={c => { setSelCustomer(c); setView("detail"); }} />
        <BigBtn onClick={() => setView("addCustomer")}>+ 새 고객 등록</BigBtn>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="이름 또는 연락처 검색" style={{ ...IS, marginBottom: 12 }} />
        {filtered.length === 0 ? <Empty text="등록된 고객이 없어요" /> : filtered.map(c => {
          const cqs = quotes.filter(q => q.customerId === c.id);
          const lastDone = cqs.filter(q => q.status === "계약완료").sort((a, b) => b.date.localeCompare(a.date))[0];
          const hasMissing = cqs.some(q => q.payStatus === "미수금");
          return (
            <Card key={c.id} onClick={() => { setSelCustomer(c); setView("detail"); }} style={{ marginBottom: 10, cursor: "pointer", ...S.row, padding: "16px" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111" }}>{c.name} {hasMissing && <span style={{ fontSize: 10, color: "#EF4444" }}>미수금</span>}</div>
                <div style={S.muted}>{c.phone || "연락처 없음"}</div>
                <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>견적 {cqs.length}건 {lastDone ? `· 최근 ${lastDone.date}` : ""}</div>
              </div>
              <span style={{ color: "#CCC", fontSize: 20 }}>›</span>
            </Card>
          );
        })}
      </div>
    </div>
  );

  if (view === "addCustomer") return (
    <div>
      <PH title="고객 등록" onBack={() => setView("list")} />
      <div style={{ padding: "0 16px" }}>
        {[{ k: "name", p: "고객명 *" }, { k: "phone", p: "연락처" }, { k: "address", p: "주소" }, { k: "notes", p: "메모" }].map(x => (
          <div key={x.k} style={{ marginBottom: 10 }}>
            <input value={newCustForm[x.k]} onChange={e => setNewCustForm(p => ({ ...p, [x.k]: e.target.value }))} placeholder={x.p} style={IS} />
          </div>
        ))}
        <BigBtn onClick={() => {
          if (!newCustForm.name) return;
          const c = { id: uid(), ...newCustForm, createdAt: today() };
          upC([...customers, c]); setSelCustomer(c);
          setNewCustForm({ name: "", phone: "", address: "", notes: "" });
          setView("detail");
        }}>등록 후 상세보기</BigBtn>
      </div>
    </div>
  );

  if (view === "detail" && selCustomer) {
    const c = selCustomer;
    const cqs = quotes.filter(q => q.customerId === c.id).sort((a, b) => b.date.localeCompare(a.date));
    const spent = cqs.filter(q => q.status === "계약완료").reduce((s, q) => s + q.total, 0);
    const hasMissing = cqs.some(q => q.payStatus === "미수금");
    const upPay = (qid, ps) => upQ(quotes.map(q => q.id === qid ? { ...q, payStatus: ps } : q));
    const upSt = (qid, st) => upQ(quotes.map(q => q.id === qid ? { ...q, status: st } : q));
    const handleClone = (q) => {
      setCloneItems(q.items.map(i => ({ ...i, id: uid() })));
      setView("newQuote");
    };

    return (
      <div>
        <PH title={c.name} onBack={() => setView("list")} />
        <div style={{ padding: "0 16px" }}>
          <div style={{ background: "#111", borderRadius: 16, padding: "20px", marginBottom: 14, color: "#fff" }}>
            <div style={{ fontSize: 20, fontWeight: 900 }}>{c.name}</div>
            {c.phone && <div style={{ fontSize: 13, color: "#888", marginTop: 6 }}>📞 {c.phone}</div>}
            {c.address && <div style={{ fontSize: 13, color: "#888", marginTop: 2 }}>📍 {c.address}</div>}
            {c.notes && <div style={{ fontSize: 12, color: "#666", marginTop: 8, paddingTop: 8, borderTop: "1px solid #222" }}>💬 {c.notes}</div>}
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            {[{ l: "총 견적", v: cqs.length + "건", c: "#3B82F6" }, { l: "계약", v: cqs.filter(q => q.status === "계약완료").length + "건", c: "#10B981" }, { l: "총매출", v: (spent / 10000).toFixed(0) + "만", c: "#F59E0B" }].map(s => (
              <div key={s.l} style={{ flex: 1, background: "#fff", borderRadius: 12, padding: "12px", border: "1px solid #EEEEE9", textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: s.c }}>{s.v}</div>
                <div style={S.hint}>{s.l}</div>
              </div>
            ))}
          </div>

          {hasMissing && (
            <div style={{ ...S.alertRed, borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: "#EF4444", fontWeight: 700 }}>⚠ 미수금이 있어요</div>
              <div style={{ ...S.sub, marginTop: 2 }}>아래 견적에서 입금 상태를 업데이트하세요</div>
            </div>
          )}

          {/* 타임라인 */}
          <CustomerTimeline customer={c} quotes={quotes} schedules={schedules} />

          <ReferralBox customerName={c.name} messages={messages} />
          <BigBtn onClick={() => { setCloneItems(null); setView("newQuote"); }}>+ 새 견적 작성</BigBtn>

          {cqs.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <SL>견적 이력</SL>
              {cqs.map(q => (
                <Card key={q.id} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, color: "#555" }}>{q.items?.map(i => i.label).join(", ")}</div>
                      <div style={S.muted}>{q.date}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 15, fontWeight: 900 }}>{fmt(q.total)}</div>
                      <SBadge s={q.status} />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 6 }}>
                    {["검토중", "계약완료", "취소"].map(st => <Chip key={st} label={st} active={q.status === st} onClick={() => upSt(q.id, st)} color="#3B82F6" />)}
                  </div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                    {["미청구", "미수금", "입금완료"].map(ps => <Chip key={ps} label={ps} active={q.payStatus === ps} onClick={() => upPay(q.id, ps)} color={ps === "입금완료" ? "#10B981" : ps === "미수금" ? "#EF4444" : "#888"} />)}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => handleClone(q)}
                      style={{
                        flex: 1, padding: "7px 0",
                        background: "#EFF6FF", color: "#3B82F6",
                        border: "1px solid #BFDBFE", borderRadius: 8,
                        fontSize: 11, cursor: "pointer",
                        fontFamily: "inherit", fontWeight: 700,
                      }}
                    >
                      복제하기
                    </button>
                    {q.message && <div style={{ flex: 2 }}><CopyBtn msg={q.message} /></div>}
                  </div>
                </Card>
              ))}
            </div>
          )}

          <OutBtn onClick={() => { if (!window.confirm("삭제?")) return; upC(customers.filter(cc => cc.id !== c.id)); setView("list"); }} style={{ color: "#EF4444" }}>고객 삭제</OutBtn>
        </div>
      </div>
    );
  }

  if (view === "newQuote" && selCustomer) return (
    <NewQuoteFlow
      customer={selCustomer}
      materials={materials}
      quotes={quotes}
      schedules={schedules}
      profile={profile}
      upQ={upQ}
      upS={upS}
      initialItems={cloneItems}
      onDone={q => { setLastQ(q); setView("quoteResult"); }}
      onBack={() => { setCloneItems(null); setView("detail"); }}
    />
  );

  if (view === "quoteResult" && lastQ) return (
    <div>
      <PH title="견적서 완성 ✓" />
      <div style={{ padding: "0 16px" }}>
        <div style={{ background: "#111", borderRadius: 16, padding: "20px", marginBottom: 14, color: "#fff" }}>
          <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>{lastQ.customerName} · {lastQ.date}</div>
          <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: -1 }}>{fmt(lastQ.total)}</div>
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #222" }}>
            {lastQ.items?.map(i => <div key={i.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#888", marginBottom: 3 }}><span>{i.label}</span><span style={{ color: "#fff" }}>{fmt(i.price)}</span></div>)}
          </div>
        </div>
        <SL>📱 카카오톡 문구</SL>
        <div style={{ background: "#fff", borderRadius: 14, padding: "16px", fontSize: 12, lineHeight: 1.9, color: "#333", whiteSpace: "pre-wrap", border: "1px solid #EEEEE9", marginBottom: 10 }}>{lastQ.message}</div>
        <CopyBtn msg={lastQ.message} />
        <div style={{ height: 10 }} />
        <OutBtn onClick={() => setView("detail")}>← 고객 상세로</OutBtn>
      </div>
    </div>
  );

  return null;
}

// ── KAKAO EXTRACTOR ───────────────────────────────────────────────────────────
function KakaoExtractor({customers,upC,onDone}){
  const [open,setOpen]=useState(false);
  const [text,setText]=useState("");
  const [loading,setLoading]=useState(false);
  const [result,setResult]=useState(null);
  const [err,setErr]=useState("");
  const [quotaLeft,setQuotaLeft]=useState(USAGE_LIMITS.kakao);
  useEffect(()=>{getQuotaLeft("kakao").then(setQuotaLeft);},[]);

  const extract=async()=>{
    if(!text.trim()||loading) return;
    const allowed=await tryUseQuota("kakao");
    if(!allowed){setErr(`오늘 사용 한도(${USAGE_LIMITS.kakao}회)를 초과했어요.`);return;}
    setQuotaLeft(p=>p-1);setLoading(true);setResult(null);setErr("");
    try{
      // Vercel 서버리스 필요
      const res=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model:HAIKU,max_tokens:400,messages:[{role:"user",content:`카카오톡 대화에서 고객 정보를 추출해줘. 반드시 JSON 객체만 응답해. 마크다운 없음.\n{"name":"","phone":"","address":"","date":"YYYY-MM-DD 또는 빈문자열","notes":""}\n\n대화:\n${text.slice(0,1500)}`}]})
      });
      const data=await res.json();
      const raw=data.content?.[0]?.text||"{}";
      const match=raw.match(/\{[\s\S]*\}/);
      const parsed=JSON.parse(match?match[0]:raw);
      setResult({name:"",phone:"",address:"",date:"",notes:"",...parsed});
    }catch{setErr("추출 실패. 대화를 더 구체적으로 붙여넣어보세요.");}
    setLoading(false);
  };

  const save=()=>{
    if(!result) return;
    const c={id:uid(),name:result.name||"미확인",phone:result.phone||"",address:result.address||"",notes:result.notes||"",createdAt:today()};
    upC([...customers,c]);setText("");setResult(null);setOpen(false);setErr("");
    onDone(c);
  };

  return(
    <div style={{marginBottom:12}}>
      <button onClick={()=>{setOpen(!open);setResult(null);setErr("");}} style={{width:"100%",padding:13,background:open?"#F0F0F0":"#8B5CF6",color:open?"#888":"#fff",border:"none",borderRadius:14,fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginBottom:open?10:0}}>
        ✨ 카톡 내용 자동 변환 {open?"닫기":""}
      </button>
      {open&&(
        <div style={{background:"#fff",borderRadius:16,padding:"16px",border:"1px solid #EEEEE9"}}>
          <div style={{...S.row,marginBottom:8}}>
            <div style={S.sub}>카톡 대화 붙여넣기 → 자동 추출</div>
            <div style={{fontSize:10,color:quotaLeft<=2?"#EF4444":"#AAA"}}>남은횟수 {quotaLeft}/{USAGE_LIMITS.kakao}</div>
          </div>
          <textarea value={text} onChange={e=>{setText(e.target.value);setResult(null);setErr("");}} placeholder={"고객: 안녕하세요 이사 청소 문의드려요\n고객: 강남구 역삼동 5월 10일 가능할까요?\n고객: 010-1234-5678이에요"} style={{...IS,height:100,resize:"none",lineHeight:1.6,marginBottom:8,fontSize:12}}/>
          {err&&<div style={{fontSize:11,color:"#EF4444",marginBottom:8}}>{err}</div>}
          {!result&&<button onClick={extract} disabled={loading||!text.trim()||quotaLeft<=0} style={{width:"100%",padding:12,background:loading||!text.trim()||quotaLeft<=0?"#EEEEE9":"#8B5CF6",color:loading||!text.trim()||quotaLeft<=0?"#AAA":"#fff",border:"none",borderRadius:12,fontSize:14,fontWeight:700,cursor:loading||!text.trim()||quotaLeft<=0?"not-allowed":"pointer",fontFamily:"inherit"}}>{loading?"AI가 읽는 중...":quotaLeft<=0?"오늘 한도 초과":"🔍 자동 추출"}</button>}
          {result&&(
            <div style={{...S.alertPurple,borderRadius:12,marginBottom:0}}>
              <div style={{fontSize:11,color:"#7C3AED",fontWeight:700,marginBottom:10}}>✓ 추출 완료 — 수정 후 등록</div>
              {[{k:"name",l:"고객명"},{k:"phone",l:"연락처"},{k:"address",l:"주소"},{k:"date",l:"희망날짜"},{k:"notes",l:"특이사항"}].map(f=>(
                <div key={f.k} style={{marginBottom:8}}>
                  <div style={{fontSize:10,color:"#888",marginBottom:3}}>{f.l}</div>
                  <input value={result[f.k]||""} onChange={e=>setResult(p=>({...p,[f.k]:e.target.value}))} style={{...IS,fontSize:13,padding:"10px 12px"}}/>
                </div>
              ))}
              <div style={{display:"flex",gap:8,marginTop:4}}>
                <button onClick={()=>{setResult(null);setErr("");}} style={{flex:1,padding:10,background:"transparent",color:"#888",border:"1.5px solid #EEEEE9",borderRadius:10,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>다시 추출</button>
                <button onClick={save} style={{flex:2,padding:10,background:"#111",color:"#fff",border:"none",borderRadius:10,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>고객으로 등록 →</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── NEW QUOTE FLOW ────────────────────────────────────────────────────────────
function NewQuoteFlow({customer,materials,quotes,schedules,profile,upQ,upS,onDone,onBack,initialItems}){
  const [step,setStep]=useState(1);
  const [selItems,setSelItems]=useState(initialItems||[]);
  const [serviceItems,setServiceItems]=useState([]);
  const [serviceInput,setServiceInput]=useState("");
  const [customLabel,setCustomLabel]=useState("");
  const [customPrice,setCustomPrice]=useState("");
  const [schedDate,setSchedDate]=useState("");
  const [schedTime,setSchedTime]=useState("10:00");
  const [notes,setNotes]=useState("");
  const [visionLoading,setVisionLoading]=useState(false);
  const [visionData,setVisionData]=useState(null);
  const [visionPreview,setVisionPreview]=useState(null);
  const [visionQuota,setVisionQuota]=useState(USAGE_LIMITS.vision);
  const fileRef=useRef(null);
  useEffect(()=>{getQuotaLeft("vision").then(setVisionQuota);},[]);

  const analyzePhoto=async(file)=>{
    const allowed=await tryUseQuota("vision");
    if(!allowed){alert(`오늘 사진 분석 한도(${USAGE_LIMITS.vision}회)를 초과했어요.`);return;}
    setVisionQuota(p=>p-1);setVisionLoading(true);setVisionData(null);
    try{
      const base64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(file);});
      const preview=await new Promise((res)=>{const r=new FileReader();r.onload=()=>res(r.result);r.readAsDataURL(file);});
      setVisionPreview(preview);
      // Vercel 서버리스 필요
      const resp=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:HAIKU,max_tokens:600,messages:[{role:"user",content:[{type:"image",source:{type:"base64",media_type:file.type||"image/jpeg",data:base64}},{type:"text",text:`이사청소 전문가로서 이 사진에서 추가 청소 비용 항목을 찾아주세요.\nJSON만 답하세요:\n{"severity":"경미|보통|심각","summary":"한줄요약","items":[{"label":"항목명","price":숫자,"reason":"이유"}]}\n항목없으면 items:[]. price는 10000~80000.`}]}]})});
      const data=await resp.json();
      const raw=(data.content?.[0]?.text||"{}").replace(/```json|```/g,"").trim();
      const match=raw.match(/\{[\s\S]*\}/);
      setVisionData(JSON.parse(match?match[0]:raw));
    }catch{setVisionData({severity:"분석실패",summary:"다시 시도해주세요",items:[]});}
    setVisionLoading(false);
  };

  const total=selItems.reduce((s,i)=>s+i.price,0);
  const toggle=item=>setSelItems(prev=>prev.find(i=>i.id===item.id)?prev.filter(i=>i.id!==item.id):[...prev,item]);
  const addCustom=()=>{if(!customLabel||!customPrice)return;setSelItems(p=>[...p,{id:uid(),label:customLabel,price:Number(customPrice)}]);setCustomLabel("");setCustomPrice("");};
  const removeItem=id=>setSelItems(p=>p.filter(i=>i.id!==id));

  const save=()=>{
    const msg=[`안녕하세요! ${profile.bizName} 견적서 보내드립니다 😊`,``,`👤 ${customer.name}`,customer.phone?`📞 ${customer.phone}`:null,schedDate?`📅 작업일: ${schedDate} ${schedTime}`:null,customer.address?`📍 ${customer.address}`:null,``,`💰 견적 내역`,...selItems.map(i=>`  • ${i.label}: ${fmt(i.price)}`),``,`━━━━━━━━━━━━━━━`,`💎 합계: ${fmt(total)}`,
               serviceItems.length>0?`\n🎁 서비스 항목`:null,
               ...serviceItems.map(s=>`  • ${s}`),
               notes?`\n📝 ${notes}`:null,``,`문의사항은 편하게 연락 주세요!`,profile.phone?`📞 ${profile.phone}`:``,].filter(l=>l!==null).join("\n");
    const q={id:uid(),customerId:customer.id,customerName:customer.name,items:selItems,total,status:"검토중",payStatus:"미청구",date:schedDate||today(),createdAt:today(),message:msg};
    upQ([...quotes,q]);
    if(schedDate) upS([...schedules,{id:uid(),customerId:customer.id,customerName:customer.name,quoteId:q.id,date:schedDate,time:schedTime,address:customer.address||"",status:"예정",notes}]);
    onDone(q);
  };

  if(step===1) return(
    <div>
      <PH title="견적 작성" sub={customer.name} onBack={onBack}/>
      <div style={{padding:"0 16px"}}>
        {quotes.filter(q=>q.customerId===customer.id).length>0&&(
          <div style={S.alertBlue}>
            <div style={{fontSize:11,color:"#3B82F6",fontWeight:700,marginBottom:4}}>이전 방문 이력</div>
            {quotes.filter(q=>q.customerId===customer.id).slice(0,2).map(q=><div key={q.id} style={{fontSize:11,color:"#555",marginTop:2}}>• {q.date} {fmt(q.total)}</div>)}
          </div>
        )}
        <div style={S.alertPurple}>
          <div style={{...S.row,marginBottom:10}}>
            <div><div style={{fontSize:12,fontWeight:700,color:"#7C3AED"}}>📸 AI 사진 분석</div><div style={{fontSize:10,color:"#A78BFA",marginTop:1}}>하자 사진 → 추가 항목 자동 제안</div></div>
            <div style={{...S.rowMid,gap:8}}>
              <span style={{fontSize:10,color:visionQuota<=1?"#EF4444":"#A78BFA"}}>남은횟수 {visionQuota}/{USAGE_LIMITS.vision}</span>
              {visionPreview&&<button onClick={()=>{setVisionPreview(null);setVisionData(null);if(fileRef.current)fileRef.current.value="";}} style={{background:"none",border:"none",cursor:"pointer",color:"#C4B5FD",fontSize:18,padding:0}}>×</button>}
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(f) analyzePhoto(f);}}/>
          {!visionPreview&&!visionLoading&&<button onClick={()=>visionQuota>0?fileRef.current?.click():null} style={{width:"100%",padding:"12px",background:visionQuota>0?"#7C3AED":"#EEEEE9",color:visionQuota>0?"#fff":"#AAA",border:"none",borderRadius:10,cursor:visionQuota>0?"pointer":"not-allowed",fontSize:13,fontWeight:700,fontFamily:"inherit"}}>{visionQuota>0?"📷 사진 업로드해서 분석하기":"오늘 한도 초과"}</button>}
          {visionPreview&&<div style={{marginBottom:10}}><img src={visionPreview} alt="" style={{width:"100%",borderRadius:10,maxHeight:160,objectFit:"cover",display:"block"}}/>{!visionLoading&&<button onClick={()=>visionQuota>0?fileRef.current?.click():null} style={{width:"100%",marginTop:6,padding:"8px",background:"rgba(124,58,237,0.08)",color:"#7C3AED",border:"1px solid #DDD6FE",borderRadius:8,cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>🔄 다른 사진으로 재분석</button>}</div>}
          {visionLoading&&<div style={{textAlign:"center",padding:"16px 0"}}><div style={{display:"flex",justifyContent:"center",gap:6,marginBottom:8}}>{[0,1,2].map(i=><div key={i} style={{width:8,height:8,borderRadius:"50%",background:"#7C3AED",animation:`vB 1s infinite ${i*0.18}s`}}/>)}</div><div style={{fontSize:12,color:"#7C3AED",fontWeight:600}}>AI가 사진 분석 중…</div></div>}
          {visionData&&!visionLoading&&(
            <div>
              <div style={{...S.rowMid,gap:8,marginBottom:10,padding:"8px 10px",background:"rgba(255,255,255,0.6)",borderRadius:8}}>
                <span style={{padding:"3px 10px",borderRadius:99,fontSize:11,fontWeight:700,flexShrink:0,background:visionData.severity==="심각"?"#FEE2E2":visionData.severity==="보통"?"#FEF3C7":"#D1FAE5",color:visionData.severity==="심각"?"#DC2626":visionData.severity==="보통"?"#D97706":"#059669"}}>{visionData.severity}</span>
                <span style={{fontSize:12,color:"#444"}}>{visionData.summary}</span>
              </div>
              {visionData.items?.length>0&&visionData.items.map((item,i)=>{
                const vid=`vision-${i}-${item.label}`;const isChecked=!!selItems.find(s=>s.id===vid);
                return(<div key={vid} onClick={()=>{if(isChecked)setSelItems(p=>p.filter(s=>s.id!==vid));else setSelItems(p=>[...p,{id:vid,label:item.label,price:item.price}]);}} style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",padding:"10px 12px",borderRadius:10,marginBottom:7,cursor:"pointer",border:`1.5px solid ${isChecked?"#7C3AED":"#EDE9FE"}`,background:isChecked?"rgba(124,58,237,0.08)":"#fff"}}>
                  <div style={{display:"flex",gap:8,alignItems:"flex-start",flex:1}}><div style={{width:18,height:18,borderRadius:4,flexShrink:0,marginTop:1,border:`2px solid ${isChecked?"#7C3AED":"#C4B5FD"}`,background:isChecked?"#7C3AED":"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"#fff",fontWeight:700}}>{isChecked?"✓":""}</div><div><div style={{fontSize:12,fontWeight:600,color:"#1F1035"}}>{item.label}</div><div style={{fontSize:10,color:"#888",marginTop:2}}>{item.reason}</div></div></div>
                  <div style={{fontSize:12,fontWeight:700,flexShrink:0,marginLeft:8,color:isChecked?"#7C3AED":"#6B7280"}}>+{fmt(item.price)}</div>
                </div>);
              })}
            </div>
          )}
        </div>
        <div style={S.alertYellow}>
          <div style={{fontSize:12,fontWeight:700,color:"#D97706",marginBottom:10}}>➕ 추가비용 직접 입력</div>
          <div style={{display:"flex",gap:8,marginBottom:8}}><input value={customLabel} onChange={e=>setCustomLabel(e.target.value)} placeholder="항목명" style={{...IS,flex:2,marginBottom:0}}/><input value={customPrice} onChange={e=>setCustomPrice(e.target.value)} placeholder="금액" type="number" style={{...IS,flex:1,marginBottom:0}}/></div>
          <button onClick={addCustom} style={{width:"100%",padding:"10px",background:"#F59E0B",color:"#fff",border:"none",borderRadius:10,cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit"}}>추가하기</button>
        </div>
        <SL>기본 항목</SL>
        {materials.filter(m=>m.category==="기본").map(item=><IToggle key={item.id} item={item} sel={!!selItems.find(i=>i.id===item.id)} onT={()=>toggle(item)}/>)}
        <SL style={{marginTop:12}}>추가 항목</SL>
        {materials.filter(m=>m.category==="추가").map(item=><IToggle key={item.id} item={item} sel={!!selItems.find(i=>i.id===item.id)} onT={()=>toggle(item)}/>)}
        {selItems.length>0&&(
          <div style={{background:"#F0FDF4",borderRadius:12,padding:"12px 14px",margin:"14px 0",border:"1px solid #BBF7D0"}}>
            <div style={{fontSize:11,color:"#059669",fontWeight:700,marginBottom:8}}>선택된 항목</div>
            {selItems.map(i=>(
              <div key={i.id} style={{...S.row,fontSize:12,color:"#333",marginBottom:4}}>
                <span>{i.label}</span>
                <div style={{...S.rowMid,gap:8}}><span style={{fontWeight:700}}>{fmt(i.price)}</span><button onClick={()=>removeItem(i.id)} style={{background:"none",border:"none",cursor:"pointer",color:"#CCC",fontSize:14,padding:0,lineHeight:1}}>×</button></div>
              </div>
            ))}
            <div style={{...S.row,fontSize:15,fontWeight:900,color:"#111",borderTop:"1px solid #BBF7D0",paddingTop:8,marginTop:4}}><span>합계</span><span>{fmt(total)}</span></div>
          </div>
        )}
        <div style={S.alertGreen}>
          <div style={{fontSize:12,fontWeight:700,color:"#059669",marginBottom:10}}>🎁 서비스 항목 (무료 제공)</div>
          <div style={{display:"flex",gap:8,marginBottom:8}}>
            <input value={serviceInput} onChange={e=>setServiceInput(e.target.value)} placeholder="예: 피톤치드 스프레이" style={{...IS,flex:1,marginBottom:0}}/>
            <button onClick={()=>{if(!serviceInput.trim())return;setServiceItems(p=>[...p,serviceInput.trim()]);setServiceInput("");}} style={{padding:"0 14px",background:"#059669",color:"#fff",border:"none",borderRadius:10,cursor:"pointer",fontFamily:"inherit",fontWeight:700,fontSize:13}}>추가</button>
          </div>
          {serviceItems.map((s,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
              <span style={{fontSize:12,color:"#059669"}}>✓ {s}</span>
              <button onClick={()=>setServiceItems(p=>p.filter((_,j)=>j!==i))} style={{background:"none",border:"none",cursor:"pointer",color:"#CCC",fontSize:14,padding:0}}>×</button>
            </div>
          ))}
        </div>
        <BigBtn onClick={()=>setStep(2)} disabled={selItems.length===0}>다음 — 일정 설정</BigBtn>
      </div>
      <style>{`@keyframes vB{0%,80%,100%{transform:translateY(0);opacity:.6}40%{transform:translateY(-7px);opacity:1}}`}</style>
    </div>
  );

  return(
    <div>
      <PH title="일정 설정" onBack={()=>setStep(1)}/>
      <div style={{padding:"0 16px"}}>
        <SL>작업 예정일</SL><input type="date" value={schedDate} onChange={e=>setSchedDate(e.target.value)} style={{...IS,marginBottom:10}}/>
        <SL>시간</SL><input type="time" value={schedTime} onChange={e=>setSchedTime(e.target.value)} style={{...IS,marginBottom:10}}/>
        <SL>메모</SL><textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="특이사항, 주차 여부 등" style={{...IS,height:70,resize:"none",lineHeight:1.6,marginBottom:14}}/>
        <div style={{background:"#F7F7F4",borderRadius:14,padding:"14px 16px",marginBottom:14,border:"1px solid #EEEEE9"}}>
          <div style={S.sub}>최종 금액</div>
          <div style={{fontSize:26,fontWeight:900,color:"#111",marginTop:2}}>{fmt(total)}</div>
          <div style={S.muted}>{customer.name} · {selItems.length}개 항목</div>
        </div>
        <BigBtn onClick={save}>견적서 저장</BigBtn>
      </div>
    </div>
  );
}

function ReferralBox({customerName,messages}){
  const [open,setOpen]=useState(false);const [type,setType]=useState("소개");
  const msgs={소개:fill(messages.referral,{name:customerName}),후기:fill(messages.review,{name:customerName})};
  return(
    <div style={S.alertGreen}>
      <div style={{...S.row,marginBottom:open?10:0}}>
        <div style={{fontSize:13,fontWeight:700,color:"#059669"}}>📣 소개·후기 요청</div>
        <button onClick={()=>setOpen(!open)} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:"#888",fontFamily:"inherit"}}>{open?"닫기":"열기"}</button>
      </div>
      {open&&(
        <div>
          <div style={{display:"flex",gap:6,marginBottom:10}}>{["소개","후기"].map(t=><button key={t} onClick={()=>setType(t)} style={{padding:"5px 14px",background:type===t?"#059669":"transparent",color:type===t?"#fff":"#888",border:`1.5px solid ${type===t?"#059669":"#BBF7D0"}`,borderRadius:99,fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:type===t?700:400}}>{t} 요청</button>)}</div>
          <div style={{background:"#fff",borderRadius:10,padding:"10px 12px",fontSize:11,color:"#555",lineHeight:1.8,whiteSpace:"pre-wrap",marginBottom:8}}>{msgs[type]}</div>
          <CopyBtn msg={msgs[type]} label="문구 복사"/>
        </div>
      )}
    </div>
  );
}

// ── SCHEDULE ──────────────────────────────────────────────────────────────────
function SC({s,onUpdate,onDelete}){
  const [showHours,setShowHours]=useState(false);const [hours,setHours]=useState("");const [toast,setToast]=useState(false);
  const handleStatus=(st)=>{if(st==="완료"&&!s.actualHours){setShowHours(true);return;}onUpdate(s.id,{status:st});};
  const saveHours=()=>{if(!hours)return;onUpdate(s.id,{status:"완료",actualHours:parseFloat(hours)});setShowHours(false);setToast(true);setTimeout(()=>setToast(false),2000);};
  return(
    <Card>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
        <div><div style={{fontSize:14,fontWeight:700}}>{s.customerName}</div><div style={{...S.sub,marginTop:2}}>{s.address||"주소 없음"}</div>{s.notes&&<div style={{fontSize:10,color:"#AAA",marginTop:1}}>💬 {s.notes}</div>}{s.actualHours&&<div style={{fontSize:10,color:"#10B981",marginTop:2}}>✓ 실소요 {s.actualHours}h (AI 반영됨)</div>}</div>
        <div style={{textAlign:"right"}}><div style={{fontSize:13,fontWeight:700,color:"#3B82F6"}}>{s.date}</div><div style={S.hint}>{s.time}</div></div>
      </div>
      <div style={{display:"flex",gap:6,alignItems:"center"}}>
        {["예정","완료","취소"].map(st=><Chip key={st} label={st} active={s.status===st} onClick={()=>handleStatus(st)} color="#3B82F6"/>)}
        <button onClick={()=>onDelete(s.id)} style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:"#DDD",fontSize:16,padding:0}}>×</button>
      </div>
      {showHours&&<div style={{marginTop:10,background:"#F0FDF4",borderRadius:10,padding:"10px 12px",border:"1px solid #BBF7D0"}}><div style={{fontSize:11,color:"#059669",fontWeight:700,marginBottom:6}}>실제 소요시간 입력</div><div style={{display:"flex",gap:8}}><input value={hours} onChange={e=>setHours(e.target.value)} type="number" step="0.5" placeholder="예: 3.5" style={{...IS,flex:1,marginBottom:0,padding:"8px 12px",fontSize:13}}/><button onClick={saveHours} style={{padding:"8px 16px",background:"#111",color:"#fff",border:"none",borderRadius:10,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>저장</button></div></div>}
      {toast&&<div style={{marginTop:8,fontSize:11,color:"#10B981",fontWeight:700,textAlign:"center"}}>✓ 피드백이 AI에 반영됐어요!</div>}
    </Card>
  );
}

function ScheduleTab({schedules,upS}){
  const [viewMode,setViewMode]=useState("calendar");const [showAdd,setShowAdd]=useState(false);
  const [form,setForm]=useState({customerName:"",date:"",time:"10:00",address:"",notes:"",status:"예정"});
  const [curYear,setCurYear]=useState(new Date().getFullYear());const [curMonth,setCurMonth]=useState(new Date().getMonth());const [selDate,setSelDate]=useState(today());
  const sorted=[...schedules].sort((a,b)=>a.date.localeCompare(b.date));
  const upcoming=sorted.filter(s=>s.date>=today());
  const addS=()=>{if(!form.customerName||!form.date)return;upS([...schedules,{id:uid(),...form}]);setForm({customerName:"",date:"",time:"10:00",address:"",notes:"",status:"예정"});setShowAdd(false);};
  const onUpdate=(id,data)=>upS(schedules.map(sc=>sc.id===id?{...sc,...data}:sc));
  const onDelete=(id)=>upS(schedules.filter(sc=>sc.id!==id));
  const firstDay=new Date(curYear,curMonth,1).getDay();const daysInMonth=new Date(curYear,curMonth+1,0).getDate();const prevMonthDays=new Date(curYear,curMonth,0).getDate();
  const monthKey=`${curYear}-${String(curMonth+1).padStart(2,"0")}`;
  const scheduleDates={};
  schedules.forEach(s=>{if(s.date?.startsWith(monthKey)){const d=parseInt(s.date.split("-")[2]);if(!scheduleDates[d])scheduleDates[d]=[];scheduleDates[d].push(s);}});
  const selSchedules=schedules.filter(s=>s.date===selDate).sort((a,b)=>a.time.localeCompare(b.time));
  const todayStr=today();const DAYS=["일","월","화","수","목","금","토"];
  const prevMonth=()=>{if(curMonth===0){setCurYear(y=>y-1);setCurMonth(11);}else setCurMonth(m=>m-1);};
  const nextMonth=()=>{if(curMonth===11){setCurYear(y=>y+1);setCurMonth(0);}else setCurMonth(m=>m+1);};

  return(
    <div>
      <div style={{padding:"52px 24px 0",background:"#fff",borderBottom:"1px solid #EEEEE9"}}>
        <div style={{...S.row,marginBottom:16}}>
          <div style={{fontSize:22,fontWeight:900,color:"#111"}}>일정 관리</div>
          <div style={{...S.rowMid,gap:8}}>
            <div style={{display:"flex",background:"#F7F7F4",borderRadius:10,padding:3,gap:2}}>{[{v:"calendar",icon:"▦"},{v:"list",icon:"≡"}].map(b=><button key={b.v} onClick={()=>setViewMode(b.v)} style={{padding:"6px 12px",background:viewMode===b.v?"#111":"transparent",color:viewMode===b.v?"#fff":"#888",border:"none",borderRadius:8,cursor:"pointer",fontSize:14,fontFamily:"inherit"}}>{b.icon}</button>)}</div>
            <button onClick={()=>setShowAdd(!showAdd)} style={{width:34,height:34,borderRadius:10,background:"#111",color:"#fff",border:"none",cursor:"pointer",fontSize:20,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
          </div>
        </div>
        {viewMode==="calendar"&&(
          <div>
            <div style={{...S.row,marginBottom:14}}>
              <button onClick={prevMonth} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:"#888",padding:"4px 8px"}}>‹</button>
              <div style={{fontSize:16,fontWeight:700,color:"#111"}}>{curYear}년 {curMonth+1}월</div>
              <button onClick={nextMonth} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:"#888",padding:"4px 8px"}}>›</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",marginBottom:4}}>{DAYS.map((d,i)=><div key={d} style={{textAlign:"center",fontSize:11,color:i===0?"#EF4444":i===6?"#3B82F6":"#AAA",fontWeight:600,padding:"4px 0"}}>{d}</div>)}</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",marginBottom:4}}>
              {Array.from({length:firstDay},(_,i)=><div key={`p-${i}`} style={{padding:"6px 0",textAlign:"center",opacity:0.2}}><span style={{fontSize:13,color:"#888"}}>{prevMonthDays-firstDay+1+i}</span></div>)}
              {Array.from({length:daysInMonth},(_,i)=>{
                const day=i+1;const dateStr=`${curYear}-${String(curMonth+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
                const isToday=dateStr===todayStr;const isSel=dateStr===selDate;const dayScheds=scheduleDates[day]||[];
                const dow=(firstDay+i)%7;const isHoliday=KR_HOLIDAYS.has(dateStr)||dow===0;const isSat=dow===6;
                return(
                  <div key={day} onClick={()=>setSelDate(dateStr)} style={{padding:"6px 0",textAlign:"center",cursor:"pointer",position:"relative"}}>
                    <div style={{width:32,height:32,borderRadius:"50%",background:isSel?"#111":isToday?"#F0F0F0":"transparent",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto",transition:"background 0.15s"}}>
                      <span style={{fontSize:14,fontWeight:isToday||isSel?700:400,color:isSel?"#fff":isToday?"#111":isHoliday?"#EF4444":isSat?"#3B82F6":"#333"}}>{day}</span>
                    </div>
                    {dayScheds.length>0&&<div style={{display:"flex",justifyContent:"center",gap:2,marginTop:2}}>{dayScheds.slice(0,3).map((s,idx)=><div key={idx} style={{width:5,height:5,borderRadius:"50%",background:s.status==="완료"?"#10B981":s.status==="취소"?"#DDD":"#3B82F6"}}/>)}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <div style={{padding:"0 16px"}}>
        {showAdd&&<div style={{marginTop:14}}><div style={{background:"#fff",borderRadius:16,padding:"16px",marginBottom:14,border:"1px solid #EEEEE9"}}>
          <input value={form.customerName} onChange={e=>setForm(p=>({...p,customerName:e.target.value}))} placeholder="고객명 *" style={{...IS,marginBottom:8}}/>
          <input value={form.address} onChange={e=>setForm(p=>({...p,address:e.target.value}))} placeholder="주소" style={{...IS,marginBottom:8}}/>
          <input value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} placeholder="메모" style={{...IS,marginBottom:10}}/>
          <div style={{display:"flex",gap:8,marginBottom:12}}><div style={{flex:1}}><SL>날짜</SL><input type="date" value={form.date} onChange={e=>setForm(p=>({...p,date:e.target.value}))} style={IS}/></div><div style={{flex:1}}><SL>시간</SL><input type="time" value={form.time} onChange={e=>setForm(p=>({...p,time:e.target.value}))} style={IS}/></div></div>
          <BigBtn onClick={addS}>저장</BigBtn><OutBtn onClick={()=>setShowAdd(false)}>닫기</OutBtn>
        </div></div>}
        {viewMode==="calendar"&&(
          <div style={{marginTop:14}}>
            <SL style={{marginBottom:10}}>{selDate===todayStr?"오늘":selDate} · {selSchedules.length}건</SL>
            {selSchedules.length===0?<div style={{background:"#fff",borderRadius:14,padding:"24px",textAlign:"center",border:"1px solid #EEEEE9",color:"#CCC",fontSize:13}}>이 날 일정이 없어요</div>:selSchedules.map(s=><SC key={s.id} s={s} onUpdate={onUpdate} onDelete={onDelete}/>)}
            <div style={{marginTop:16}}>
              <SL>이번달 전체 일정</SL>
              {schedules.filter(s=>s.date?.startsWith(monthKey)).sort((a,b)=>a.date.localeCompare(b.date)).map(s=>(
                <div key={s.id} onClick={()=>setSelDate(s.date)} style={{background:"#fff",borderRadius:12,padding:"10px 14px",marginBottom:6,border:`1px solid ${s.date===selDate?"#3B82F6":"#EEEEE9"}`,cursor:"pointer",...S.row}}>
                  <div style={{...S.rowMid,gap:10}}><div style={{width:8,height:8,borderRadius:"50%",background:s.status==="완료"?"#10B981":s.status==="취소"?"#DDD":"#3B82F6",flexShrink:0}}/><div><div style={{fontSize:13,fontWeight:600,color:"#111"}}>{s.customerName}</div><div style={S.hint}>{s.time} · {s.address||"주소 없음"}</div></div></div>
                  <div style={{fontSize:12,fontWeight:700,color:"#3B82F6"}}>{parseInt(s.date.split("-")[2])}일</div>
                </div>
              ))}
              {schedules.filter(s=>s.date?.startsWith(monthKey)).length===0&&<div style={{color:"#CCC",fontSize:12,textAlign:"center",padding:"20px"}}>이번달 일정이 없어요</div>}
            </div>
          </div>
        )}
        {viewMode==="list"&&(
          <div style={{marginTop:14}}>
            {upcoming.length>0&&<><SL>예정된 일정</SL>{upcoming.map(s=><SC key={s.id} s={s} onUpdate={onUpdate} onDelete={onDelete}/>)}</>}
            {sorted.filter(s=>s.date<today()).length>0&&<><SL style={{color:"#AAA",marginTop:8}}>지난 일정</SL>{sorted.filter(s=>s.date<today()).slice(-5).reverse().map(s=><SC key={s.id} s={s} onUpdate={onUpdate} onDelete={onDelete}/>)}</>}
            {schedules.length===0&&<Empty text="일정이 없어요"/>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── STATS ─────────────────────────────────────────────────────────────────────
function StatsTab({quotes,customers}){
  const [animated,setAnimated]=useState(false);
  useEffect(()=>{const t=setTimeout(()=>setAnimated(true),100);return()=>clearTimeout(t);},[]);
  const completed=quotes.filter(q=>q.status==="계약완료");const totalRev=completed.reduce((s,q)=>s+q.total,0);
  const convRate=quotes.length>0?Math.round(completed.length/quotes.length*100):0;
  const unpaid=quotes.filter(q=>q.payStatus==="미수금").reduce((s,q)=>s+q.total,0);
  const months=Array.from({length:6},(_,i)=>{const d=new Date();d.setMonth(d.getMonth()-5+i);const key=d.toISOString().slice(0,7);return{key,label:`${d.getMonth()+1}월`,rev:completed.filter(q=>q.date?.startsWith(key)).reduce((s,q)=>s+q.total,0)};});
  const maxRev=Math.max(...months.map(m=>m.rev),1);
  const itemMap={};completed.forEach(q=>q.items?.forEach(i=>{if(!itemMap[i.label])itemMap[i.label]={count:0,total:0};itemMap[i.label].count++;itemMap[i.label].total+=i.price;}));
  const topItems=Object.entries(itemMap).sort((a,b)=>b[1].total-a[1].total).slice(0,5);const maxItem=topItems[0]?.[1]?.total||1;
  return(
    <div>
      <PH title="매출 분석"/>
      <div style={{padding:"0 16px"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
          {[{l:"누적 매출",v:(totalRev/10000).toFixed(0)+"만원",c:"#fff",bg:"#111"},{l:"전환율",v:convRate+"%",c:convRate>=50?"#10B981":"#F59E0B",bg:"#fff"},{l:"미수금",v:fmt(unpaid),c:unpaid>0?"#EF4444":"#10B981",bg:"#fff"},{l:"총 고객",v:customers.length+"명",c:"#3B82F6",bg:"#fff"}].map(s=>(
            <div key={s.l} style={{background:s.bg,borderRadius:14,padding:"16px",border:s.bg==="#fff"?"1px solid #EEEEE9":"none"}}><div style={{fontSize:10,color:s.bg==="#111"?"#555":"#AAA",marginBottom:4}}>{s.l}</div><div style={{fontSize:20,fontWeight:900,color:s.c}}>{s.v}</div></div>
          ))}
        </div>
        <div style={{background:"#fff",borderRadius:16,padding:"20px",marginBottom:14,border:"1px solid #EEEEE9"}}>
          <div style={{fontSize:13,fontWeight:700,color:"#111",marginBottom:20}}>월별 매출</div>
          <div style={{display:"flex",alignItems:"flex-end",gap:8,height:130}}>
            {months.map((m,i)=>{const pct=m.rev>0?(m.rev/maxRev*100):3;const isCur=m.key===new Date().toISOString().slice(0,7);return(
              <div key={m.key} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4,height:"100%",justifyContent:"flex-end"}}>
                {m.rev>0&&<div style={{fontSize:9,color:"#888",textAlign:"center"}}>{(m.rev/10000).toFixed(0)}만</div>}
                <div style={{width:"100%",height:animated?`${Math.max(4,pct)}%`:"4%",background:isCur?"#111":"#E0E0DB",borderRadius:"6px 6px 3px 3px",transition:`height 0.6s cubic-bezier(0.34,1.56,0.64,1) ${i*0.08}s`,position:"relative"}}>{isCur&&<div style={{position:"absolute",top:-18,left:"50%",transform:"translateX(-50%)",fontSize:8,color:"#111",fontWeight:700,whiteSpace:"nowrap"}}>이번달</div>}</div>
                <div style={{fontSize:10,color:isCur?"#111":"#AAA",fontWeight:isCur?700:400}}>{m.label}</div>
              </div>
            );})}
          </div>
        </div>
        {topItems.length>0&&(
          <div style={{background:"#fff",borderRadius:16,padding:"20px",marginBottom:14,border:"1px solid #EEEEE9"}}>
            <div style={{fontSize:13,fontWeight:700,color:"#111",marginBottom:16}}>항목별 수익</div>
            {topItems.map(([label,data],i)=>(
              <div key={label} style={{marginBottom:14}}>
                <div style={{...S.row,marginBottom:5}}><div style={{fontSize:12,color:"#333",fontWeight:500}}>{label}</div><div style={{fontSize:12,fontWeight:700}}>{fmt(data.total)} <span style={{fontSize:10,color:"#AAA",fontWeight:400}}>({data.count}건)</span></div></div>
                <div style={{height:6,background:"#F5F5F0",borderRadius:99,overflow:"hidden"}}><div style={{height:"100%",width:animated?`${data.total/maxItem*100}%`:"0%",background:["#111","#3B82F6","#10B981","#F59E0B","#8B5CF6"][i],borderRadius:99,transition:`width 0.7s cubic-bezier(0.34,1.56,0.64,1) ${i*0.1}s`}}/></div>
              </div>
            ))}
          </div>
        )}
        <div style={{background:"#fff",borderRadius:16,padding:"20px",marginBottom:16,border:"1px solid #EEEEE9"}}>
          <div style={{fontSize:13,fontWeight:700,color:"#111",marginBottom:14}}>견적 전환율</div>
          <div style={{display:"flex",gap:8,marginBottom:12}}>
            {[{l:"전체",v:quotes.length,bg:"#F7F7F4"},{l:"계약",v:completed.length,bg:"#111"},{l:"검토중",v:quotes.filter(q=>q.status==="검토중").length,bg:"#FFFBEB"},{l:"취소",v:quotes.filter(q=>q.status==="취소").length,bg:"#FFF5F5"}].map(s=>(
              <div key={s.l} style={{flex:1,background:s.bg,borderRadius:12,padding:"10px 6px",textAlign:"center"}}><div style={{fontSize:18,fontWeight:900,color:s.bg==="#111"?"#fff":s.bg==="#FFFBEB"?"#D97706":s.bg==="#FFF5F5"?"#EF4444":"#333"}}>{s.v}</div><div style={{fontSize:9,color:s.bg==="#111"?"#888":"#AAA",marginTop:2}}>{s.l}</div></div>
            ))}
          </div>
          <div style={{height:8,background:"#F5F5F0",borderRadius:99,overflow:"hidden"}}><div style={{height:"100%",width:animated?`${convRate}%`:"0%",background:"#111",borderRadius:99,transition:"width 0.8s ease"}}/></div>
          <div style={{fontSize:11,color:"#888",marginTop:6}}>전환율 {convRate}% {convRate>=50?"✓ 양호":"— 개선 필요"}</div>
        </div>
      </div>
    </div>
  );
}

// ── MORE TAB ──────────────────────────────────────────────────────────────────
function MoreTab({materials,profile,quotes,customers,schedules,workers,inventory,messages,costs,upM,upP,upW,upI,upMsg,upCosts}){
  const [section,setSection]=useState("main");
  if(section==="materials") return <MaterialsSection materials={materials} upM={upM} onBack={()=>setSection("main")}/>;
  if(section==="profile")   return <ProfileSection   profile={profile}    upP={upP} onBack={()=>setSection("main")}/>;
  if(section==="workers")   return <WorkersSection   workers={workers}    upW={upW} onBack={()=>setSection("main")} profile={profile}/>;
  if(section==="inventory") return <InventorySection inventory={inventory} upI={upI} schedules={schedules} onBack={()=>setSection("main")}/>;
  if(section==="messages")  return <MessagesSection  messages={messages}  upMsg={upMsg} onBack={()=>setSection("main")}/>;
  if(section==="costs") return <CostsSection costs={costs} upCosts={upCosts} quotes={quotes} onBack={()=>setSection("main")}/>;
  if(section==="chat")      return <ChatSection      quotes={quotes} customers={customers} schedules={schedules} profile={profile} workers={workers} inventory={inventory} onBack={()=>setSection("main")}/>;
  const menus=[
    {id:"costs",     icon:"💰",label:"원가 관리",       sub:"인건비·재료비·순이익 분석",  color:"#10B981"},
    {id:"chat",      icon:"🤖",label:"AI 운영 도우미",  sub:"매출·견적 분석 챗봇",       color:"#8B5CF6"},
    {id:"workers",   icon:"👷",label:"직원 관리",        sub:"팀원 현황 및 작업 배정",    color:"#F59E0B"},
    {id:"inventory", icon:"📦",label:"재고 관리",        sub:"소모품 현황 및 발주 알림",  color:"#EF4444"},
    {id:"messages",  icon:"✏️",label:"문구 관리",        sub:"카카오 문구 커스터마이징", color:"#EC4899"},
    {id:"materials", icon:"📋",label:"단가표 관리",      sub:"기본·추가 항목 단가 설정",  color:"#3B82F6"},
    {id:"profile",   icon:"🏪",label:"업체 프로필",      sub:"상호명, 연락처 설정",       color:"#10B981"},
  ];
  return(
    <div>
      <PH title="더보기"/>
      <div style={{padding:"0 16px"}}>
        {menus.map(m=>(
          <Card key={m.id} onClick={()=>setSection(m.id)} style={{borderRadius:16,padding:"18px",marginBottom:10,cursor:"pointer",...S.rowMid,gap:14}}>
            <div style={{width:44,height:44,borderRadius:12,background:`${m.color}15`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>{m.icon}</div>
            <div style={{flex:1}}><div style={{fontSize:14,fontWeight:700,color:"#111"}}>{m.label}</div><div style={S.muted}>{m.sub}</div></div>
            <span style={{color:"#CCC",fontSize:20}}>›</span>
          </Card>
        ))}
        <div style={{marginTop:20,padding:"14px",background:"#F7F7F4",borderRadius:14,border:"1px solid #EEEEE9",textAlign:"center"}}>
          <div style={S.sub}>WORKOS · 사장님의 시간을 아껴드립니다</div>
        </div>
      </div>
    </div>
  );
}

// ── MESSAGES SECTION ──────────────────────────────────────────────────────────
function MessagesSection({messages,upMsg,onBack}){
  const [form,setForm]=useState({...messages});const [saved,setSaved]=useState(false);
  const FIELDS=[
    {k:"movingSeason1",l:"이사철 홍보 문구 1",hint:"{bizName} 사용 가능"},
    {k:"movingSeason2",l:"이사철 홍보 문구 2",hint:""},
    {k:"referral",     l:"소개 요청 문구",    hint:"{name} 사용 가능"},
    {k:"review",       l:"후기 요청 문구",    hint:"{name} 사용 가능"},
    {k:"overdue",      l:"미수금 독촉 문구",  hint:"{name}, {amount} 사용 가능"},
  ];
  const save=()=>{upMsg({...form});setSaved(true);setTimeout(()=>setSaved(false),2000);};
  return(
    <div>
      <PH title="문구 관리" sub="카카오 문구 직접 편집" onBack={onBack}/>
      <div style={{padding:"0 16px"}}>
        <div style={{...S.alertBlue,marginBottom:16}}>
          <div style={{fontSize:11,color:"#3B82F6",fontWeight:700,marginBottom:2}}>플레이스홀더 사용법</div>
          <div style={{fontSize:10,color:"#888",lineHeight:1.7}}>{"{name} → 고객명  {amount} → 금액  {bizName} → 업체명"}</div>
        </div>
        {FIELDS.map(f=>(
          <div key={f.k} style={{marginBottom:16}}>
            <div style={{...S.row,marginBottom:6}}>
              <SL style={{marginBottom:0}}>{f.l}</SL>
              {f.hint&&<span style={{fontSize:10,color:"#AAA"}}>{f.hint}</span>}
            </div>
            <textarea value={form[f.k]} onChange={e=>setForm(p=>({...p,[f.k]:e.target.value}))} style={{...IS,height:80,resize:"none",lineHeight:1.7,fontSize:12}}/>
            <div style={{fontSize:10,color:"#AAA",marginTop:4}}>미리보기: {form[f.k].slice(0,50)}{form[f.k].length>50?"…":""}</div>
          </div>
        ))}
        <BigBtn onClick={save}>{saved?"✓ 저장됐어요!":"저장"}</BigBtn>
        <OutBtn onClick={()=>setForm({...DEFAULT_MESSAGES})}>기본값으로 초기화</OutBtn>
      </div>
    </div>
  );
}

function MaterialsSection({materials,upM,onBack}){
  const [form,setForm]=useState({label:"",price:"",category:"추가"});
  const add=()=>{if(!form.label||!form.price)return;upM([...materials,{id:uid(),label:form.label,price:Number(form.price),category:form.category}]);setForm({label:"",price:"",category:"추가"});};
  const remove=id=>upM(materials.filter(m=>m.id!==id));
  const updatePrice=(id,price)=>upM(materials.map(m=>m.id===id?{...m,price:Number(price)||m.price}:m));
  return(
    <div>
      <PH title="단가표 관리" sub="견적 작성 시 자동 반영돼요" onBack={onBack}/>
      <div style={{padding:"0 16px"}}>
        {["기본","추가"].map(cat=>(
          <div key={cat} style={{marginBottom:20}}>
            <SL>{cat} 항목</SL>
            {materials.filter(m=>m.category===cat).map(m=>(
              <div key={m.id} style={{background:"#fff",borderRadius:12,padding:"12px 14px",marginBottom:8,border:"1px solid #EEEEE9",...S.rowMid,gap:10}}>
                <div style={{flex:1,fontSize:13,color:"#111",fontWeight:500}}>{m.label}</div>
                <input defaultValue={m.price} onBlur={e=>updatePrice(m.id,e.target.value)} style={{width:80,padding:"6px 10px",border:"1.5px solid #EEEEE9",borderRadius:8,fontSize:13,textAlign:"right",fontFamily:"inherit",outline:"none"}}/>
                <span style={{fontSize:12,color:"#888"}}>원</span>
                <button onClick={()=>remove(m.id)} style={{background:"none",border:"none",cursor:"pointer",color:"#DDD",fontSize:18,padding:0}}>×</button>
              </div>
            ))}
          </div>
        ))}
        <SL>새 항목 추가</SL>
        <div style={{background:"#fff",borderRadius:16,padding:"16px",border:"1px solid #EEEEE9"}}>
          <input value={form.label} onChange={e=>setForm(p=>({...p,label:e.target.value}))} placeholder="항목명" style={{...IS,marginBottom:8}}/>
          <input value={form.price} onChange={e=>setForm(p=>({...p,price:e.target.value}))} placeholder="기본 금액" type="number" style={{...IS,marginBottom:12}}/>
          <div style={{display:"flex",gap:8,marginBottom:14}}>{["기본","추가"].map(c=><button key={c} onClick={()=>setForm(p=>({...p,category:c}))} style={{flex:1,padding:"10px",border:`1.5px solid ${form.category===c?"#111":"#EEEEE9"}`,background:form.category===c?"#111":"transparent",color:form.category===c?"#fff":"#888",borderRadius:10,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>{c}</button>)}</div>
          <BigBtn onClick={add}>항목 추가</BigBtn>
        </div>
      </div>
    </div>
  );
}

function ProfileSection({profile,upP,onBack}){
  const [form,setForm]=useState(profile);
  return(
    <div>
      <PH title="업체 프로필" onBack={onBack}/>
      <div style={{padding:"0 16px"}}>
        {[{k:"bizName",l:"상호명",p:"예: 우리 청소"},{k:"ownerName",l:"사장님 이름",p:"홍길동"},{k:"phone",l:"업체 연락처",p:"010-0000-0000"},{k:"intro",l:"업체 소개",p:"한 줄 소개"}].map(f=>(
          <div key={f.k} style={{marginBottom:12}}><SL>{f.l}</SL><input value={form[f.k]} onChange={e=>setForm(p=>({...p,[f.k]:e.target.value}))} placeholder={f.p} style={IS}/></div>
        ))}
        <div style={{height:10}}/><BigBtn onClick={()=>{upP(form);onBack();}}>저장</BigBtn>
      </div>
    </div>
  );
}

function WorkersSection({workers,upW,onBack,profile}){
  const [form,setForm]=useState({name:"",phone:"",specialty:"입주청소"});
  const specialties=profile?.industry==="인테리어"
  ? ["도배","장판","타일","목공","전기","전체"]
  : ["입주청소","이사짐정리","특수청소","전체"];
const [customSpecialty,setCustomSpecialty]=useState("");
  return(
    <div>
      <PH title="직원 관리" sub="팀원 현황 및 작업 배정" onBack={onBack}/>
      <div style={{padding:"0 16px"}}>
        {workers.length===0&&<Empty text="등록된 직원이 없어요"/>}
        {workers.map(w=>(
          <Card key={w.id} style={{marginBottom:10,...S.row}}>
            <div style={{...S.rowMid,gap:12}}>
              <div style={{width:40,height:40,borderRadius:"50%",background:w.isActive?"#111":"#EEEEE9",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>👷</div>
              <div><div style={{fontSize:14,fontWeight:700,color:"#111"}}>{w.name}</div><div style={S.muted}>{w.specialty} · {w.phone}</div></div>
            </div>
            <div style={{...S.rowMid,gap:8}}>
              <button onClick={()=>upW(workers.map(ww=>ww.id===w.id?{...ww,isActive:!ww.isActive}:ww))} style={{padding:"5px 12px",background:w.isActive?"#D1FAE5":"#F3F4F6",color:w.isActive?"#059669":"#999",border:"none",borderRadius:99,fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:700}}>{w.isActive?"활성":"비활성"}</button>
              <button onClick={()=>{if(!window.confirm("삭제?"))return;upW(workers.filter(ww=>ww.id!==w.id));}} style={{background:"none",border:"none",cursor:"pointer",color:"#DDD",fontSize:18,padding:0}}>×</button>
            </div>
          </Card>
        ))}
        <div style={{background:"#fff",borderRadius:16,padding:"16px",border:"1px solid #EEEEE9",marginTop:8}}>
          <SL>새 직원 추가</SL>
          <input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="이름 *" style={{...IS,marginBottom:8}}/>
          <input value={form.phone} onChange={e=>setForm(p=>({...p,phone:e.target.value}))} placeholder="연락처" style={{...IS,marginBottom:10}}/>
          <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>{specialties.map(s=><button key={s} onClick={()=>setForm(p=>({...p,specialty:s}))} style={{padding:"7px 14px",background:form.specialty===s?"#111":"transparent",color:form.specialty===s?"#fff":"#888",border:`1.5px solid ${form.specialty===s?"#111":"#EEEEE9"}`,borderRadius:99,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>{s}</button>)}</div>
          <div style={{display:"flex",gap:8,marginBottom:14}}>
  <input value={customSpecialty} onChange={e=>setCustomSpecialty(e.target.value)} placeholder="직접 입력" style={{...IS,flex:1,marginBottom:0}}/>
  <button onClick={()=>{if(!customSpecialty.trim())return;setForm(p=>({...p,specialty:customSpecialty.trim()}));setCustomSpecialty("");}} style={{padding:"0 14px",background:"#111",color:"#fff",border:"none",borderRadius:10,cursor:"pointer",fontFamily:"inherit",fontWeight:700,fontSize:13}}>선택</button>
</div>
          <BigBtn onClick={()=>{if(!form.name)return;upW([...workers,{id:uid(),...form,isActive:true}]);setForm({name:"",phone:"",specialty:"입주청소"});}}>직원 추가</BigBtn>
        </div>
      </div>
    </div>
  );
}

function InventorySection({inventory,upI,schedules,onBack}){
  const [form,setForm]=useState({label:"",unit:"개",stock:"",minStock:"",perJob:""});
  const upcomingCount=schedules.filter(s=>s.date>=today()&&s.date<=new Date(Date.now()+7*86400000).toISOString().split("T")[0]).length;
  return(
    <div>
      <PH title="재고 관리" sub="소모품 현황 및 발주 알림" onBack={onBack}/>
      <div style={{padding:"0 16px"}}>
        {upcomingCount>0&&(
          <div style={{...S.alertBlue,padding:"12px 14px",marginBottom:14}}>
            <div style={{fontSize:12,color:"#3B82F6",fontWeight:700}}>📅 이번주 예정 작업 {upcomingCount}건 기준 예상 소모량</div>
          </div>
        )}
        {inventory.length===0&&<Empty text="등록된 재고가 없어요"/>}
        {inventory.map(item=>{
          const isLow=item.stock<=item.minStock;const expectedUse=parseFloat((item.perJob*upcomingCount).toFixed(1));const afterUse=parseFloat((item.stock-expectedUse).toFixed(1));
          return(
            <div key={item.id} style={{background:isLow?"#FFF5F5":"#fff",borderRadius:14,padding:"14px 16px",marginBottom:10,border:`1px solid ${isLow?"#FECACA":"#EEEEE9"}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                <div><div style={{fontSize:14,fontWeight:700,color:"#111"}}>{item.label}</div>{isLow&&<div style={{fontSize:10,color:"#EF4444",fontWeight:700,marginTop:2}}>⚠ 재고 부족 — 발주 필요</div>}{upcomingCount>0&&<div style={{fontSize:10,color:"#888",marginTop:2}}>이번주 예상 소모 {expectedUse}{item.unit} → 잔여 {afterUse}{item.unit}</div>}</div>
                <button onClick={()=>upI(inventory.filter(i=>i.id!==item.id))} style={{background:"none",border:"none",cursor:"pointer",color:"#DDD",fontSize:18,padding:0}}>×</button>
              </div>
              <div style={{...S.rowMid,gap:8}}>
                <span style={S.sub}>현재</span>
                <input defaultValue={item.stock} onBlur={e=>upI(inventory.map(i=>i.id===item.id?{...i,stock:parseFloat(e.target.value)||i.stock}:i))} type="number" style={{width:60,padding:"6px 10px",border:`1.5px solid ${isLow?"#FECACA":"#EEEEE9"}`,borderRadius:8,fontSize:13,textAlign:"center",fontFamily:"inherit",outline:"none"}}/>
                <span style={S.sub}>{item.unit} / 최소 {item.minStock}{item.unit}</span>
              </div>
            </div>
          );
        })}
        <div style={{background:"#fff",borderRadius:16,padding:"16px",border:"1px solid #EEEEE9",marginTop:8}}>
          <SL>새 재고 항목</SL>
          {[{k:"label",p:"항목명 *"},{k:"unit",p:"단위 (개,장,리터)"},{k:"stock",p:"현재 재고",t:"number"},{k:"minStock",p:"최소 재고",t:"number"},{k:"perJob",p:"작업 1건당 소비량",t:"number"}].map(f=>(
            <input key={f.k} value={form[f.k]} onChange={e=>setForm(p=>({...p,[f.k]:e.target.value}))} placeholder={f.p} type={f.t||"text"} style={{...IS,marginBottom:8}}/>
          ))}
          <BigBtn onClick={()=>{if(!form.label||!form.stock)return;upI([...inventory,{id:uid(),label:form.label,unit:form.unit||"개",stock:parseFloat(form.stock),minStock:parseFloat(form.minStock)||0,perJob:parseFloat(form.perJob)||0}]);setForm({label:"",unit:"개",stock:"",minStock:"",perJob:""});}}>항목 추가</BigBtn>
        </div>
      </div>
    </div>
  );
}
function CostsSection({costs,upCosts,quotes,onBack}){
  const [form,setForm]=useState({...costs});
  const [saved,setSaved]=useState(false);
  const completed=quotes.filter(q=>q.status==="계약완료");
  const thisMonth=new Date().toISOString().slice(0,7);
  const monthRev=completed.filter(q=>q.date?.startsWith(thisMonth)).reduce((s,q)=>s+q.total,0);
  const tax=Math.round(monthRev*(form.taxRate/100));
  const material=Math.round(monthRev*(form.materialRate/100));
  const netProfit=monthRev-form.fixedMonthly-material-tax;
  const margin=monthRev>0?Math.round(netProfit/monthRev*100):0;
  const save=()=>{upCosts({...form});setSaved(true);setTimeout(()=>setSaved(false),2000);};
  return(
    <div>
      <PH title="원가 관리" sub="순이익·마진율 분석" onBack={onBack}/>
      <div style={{padding:"0 16px"}}>
        <div style={{background:"#111",borderRadius:16,padding:"20px",marginBottom:14,color:"#fff"}}>
          <div style={{fontSize:11,color:"#555",marginBottom:4}}>이번달 순이익 추정</div>
          <div style={{fontSize:34,fontWeight:900,letterSpacing:-1,color:netProfit>=0?"#fff":"#F87171"}}>{fmt(netProfit)}</div>
          <div style={{display:"flex",gap:16,marginTop:12,paddingTop:12,borderTop:"1px solid #222"}}>
            <div><div style={{fontSize:10,color:"#555"}}>매출</div><div style={{fontSize:13,fontWeight:700}}>{fmt(monthRev)}</div></div>
            <div><div style={{fontSize:10,color:"#555"}}>재료비</div><div style={{fontSize:13,fontWeight:700,color:"#F87171"}}>-{fmt(material)}</div></div>
            <div><div style={{fontSize:10,color:"#555"}}>고정비</div><div style={{fontSize:13,fontWeight:700,color:"#F87171"}}>-{fmt(form.fixedMonthly)}</div></div>
            <div><div style={{fontSize:10,color:"#555"}}>세금</div><div style={{fontSize:13,fontWeight:700,color:"#F87171"}}>-{fmt(tax)}</div></div>
          </div>
          <div style={{marginTop:10,fontSize:12,color:"#888"}}>마진율 <span style={{color:margin>=30?"#10B981":margin>=20?"#F59E0B":"#F87171",fontWeight:700}}>{margin}%</span> {margin>=30?"✓ 양호":margin>=20?"— 보통":"⚠ 낮음"}</div>
        </div>
        <div style={{...S.alertBlue,marginBottom:14}}>
          <div style={{fontSize:11,color:"#3B82F6",fontWeight:700,marginBottom:2}}>💡 마진율 가이드</div>
          <div style={{fontSize:10,color:"#888",lineHeight:1.7}}>{"청소업: 평균 35~45% · 인테리어: 평균 20~30%\n30% 이하면 단가 조정을 고려해보세요"}</div>
        </div>
        <SL>고정비 (월)</SL>
        <input value={form.fixedMonthly} onChange={e=>setForm(p=>({...p,fixedMonthly:Number(e.target.value)||0}))} placeholder="차량·공구·보험 등" type="number" style={{...IS,marginBottom:12}}/>
        <SL>재료비 비율 (%)</SL>
        <input value={form.materialRate} onChange={e=>setForm(p=>({...p,materialRate:Number(e.target.value)||0}))} placeholder="매출 대비 재료비 %" type="number" style={{...IS,marginBottom:12}}/>
        <SL>세금 비율 (%)</SL>
        <input value={form.taxRate} onChange={e=>setForm(p=>({...p,taxRate:Number(e.target.value)||0}))} placeholder="부가세 등 (기본 10%)" type="number" style={{...IS,marginBottom:14}}/>
        <BigBtn onClick={save}>{saved?"✓ 저장됐어요!":"저장"}</BigBtn>
      </div>
    </div>
  );
}
// ── AI CHAT ───────────────────────────────────────────────────────────────────
function ChatSection({quotes,customers,schedules,profile,workers,inventory,onBack}){
  const [msgs,setMsgs]=useState([{role:"assistant",text:`안녕하세요! ${profile.bizName} 운영 도우미입니다 🤖\n\n매출, 견적, 직원, 재고 뭐든 물어보세요!`}]);
  const [input,setInput]=useState("");const [loading,setLoading]=useState(false);const [quotaLeft,setQuotaLeft]=useState(USAGE_LIMITS.chat);
  const bottomRef=useRef(null);
  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:"smooth"});},[msgs]);
  useEffect(()=>{getQuotaLeft("chat").then(setQuotaLeft);},[]);
  const completed=quotes.filter(q=>q.status==="계약완료");const totalRev=completed.reduce((s,q)=>s+q.total,0);
  const unpaid=quotes.filter(q=>q.payStatus==="미수금");const thisMonth=new Date().toISOString().slice(0,7);
  const monthRev=completed.filter(q=>q.date?.startsWith(thisMonth)).reduce((s,q)=>s+q.total,0);
  const convRate=quotes.length>0?Math.round(completed.length/quotes.length*100):0;
  const activeWorkers=workers?.filter(w=>w.isActive).map(w=>`${w.name}(${w.specialty})`).join(", ")||"정보없음";
  const lowStock=inventory?.filter(i=>i.stock<=i.minStock).map(i=>i.label).join(", ")||"없음";
  const doneScheds=schedules.filter(s=>s.actualHours);
  const avgHours=doneScheds.length>0?(doneScheds.reduce((s,sc)=>s+sc.actualHours,0)/doneScheds.length).toFixed(1):"데이터없음";
  const systemPrompt=`너는 "${profile.bizName}" ${profile.industry==="인테리어"?"인테리어 업체":"이사청소 업체"} 운영 도우미야. 친근하고 실용적인 어시스턴트.\n\n현황:\n- 고객 ${customers.length}명 / 견적 ${quotes.length}건 / 계약완료 ${completed.length}건 / 전환율 ${convRate}%\n- 누적매출 ${totalRev.toLocaleString()}원 / 이번달 ${monthRev.toLocaleString()}원\n- 미수금 ${unpaid.length}건 (${unpaid.reduce((s,q)=>s+q.total,0).toLocaleString()}원)\n- 활성직원: ${activeWorkers}\n- 재고부족: ${lowStock}\n- 평균작업시간: ${avgHours}h\n고객: ${customers.map(c=>c.name).join(", ")}\n최근견적: ${quotes.slice(-3).map(q=>`${q.customerName} ${q.total.toLocaleString()}원(${q.status})`).join(", ")}\n\n짧고 실용적으로. 한국어. 이모지 적당히.`;
  const send=async()=>{
    if(!input.trim()||loading) return;
    const allowed=await tryUseQuota("chat");
    if(!allowed){setMsgs(p=>[...p,{role:"assistant",text:`오늘 AI 대화 한도(${USAGE_LIMITS.chat}회)를 초과했어요. 내일 다시 이용해주세요!`}]);return;}
    setQuotaLeft(p=>p-1);
    const userMsg={role:"user",text:input};const newMsgs=[...msgs,userMsg];
    setMsgs(newMsgs);setInput("");setLoading(true);
    try{
      // Vercel 서버리스 필요
      const res=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:HAIKU,max_tokens:800,system:systemPrompt,messages:newMsgs.filter(m=>m.role!=="assistant"||newMsgs.indexOf(m)>0).map(m=>({role:m.role==="user"?"user":"assistant",content:m.text}))})});
      const data=await res.json();
      setMsgs(p=>[...p,{role:"assistant",text:data.content?.[0]?.text||"잠시 후 다시 시도해주세요."}]);
    }catch{setMsgs(p=>[...p,{role:"assistant",text:"연결에 문제가 있어요."}]);}
    setLoading(false);
  };
  const suggestions=["이번달 매출 분석해줘","미수금 어떻게 해야 해?","직원 배정 조언","재고 부족 대응","이사철 홍보 전략"];
  return(
    <div style={{display:"flex",flexDirection:"column",height:"100vh"}}>
      <PH title="AI 운영 도우미" sub="업체 데이터 기반으로 답해드려요" onBack={onBack}/>
      <div style={{flex:1,overflowY:"auto",padding:"16px",paddingBottom:90}}>
        {msgs.map((m,i)=>(
          <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start",marginBottom:12}}>
            {m.role==="assistant"&&<div style={{width:28,height:28,borderRadius:"50%",background:"#111",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,marginRight:8,flexShrink:0,alignSelf:"flex-end"}}>🤖</div>}
            <div style={{maxWidth:"78%",padding:"12px 14px",borderRadius:m.role==="user"?"16px 16px 4px 16px":"16px 16px 16px 4px",background:m.role==="user"?"#111":"#fff",color:m.role==="user"?"#fff":"#333",fontSize:13,lineHeight:1.7,whiteSpace:"pre-wrap",border:m.role==="assistant"?"1px solid #EEEEE9":"none"}}>{m.text}</div>
          </div>
        ))}
        {loading&&(
          <div style={{...S.rowMid,gap:8,marginBottom:12}}>
            <div style={{width:28,height:28,borderRadius:"50%",background:"#111",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>🤖</div>
            <div style={{background:"#fff",border:"1px solid #EEEEE9",borderRadius:"16px 16px 16px 4px",padding:"12px 16px"}}>
              <div style={{display:"flex",gap:4}}>{[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:"#CCC",animation:`bounce 1s infinite ${i*0.2}s`}}/>)}</div>
            </div>
          </div>
        )}
        {msgs.length===1&&<div style={{marginTop:8}}><div style={{fontSize:11,color:"#AAA",marginBottom:8,textAlign:"center"}}>자주 묻는 질문</div><div style={{display:"flex",flexWrap:"wrap",gap:6}}>{suggestions.map(s=><button key={s} onClick={()=>setInput(s)} style={{padding:"7px 12px",background:"#fff",border:"1px solid #EEEEE9",borderRadius:99,fontSize:11,color:"#555",cursor:"pointer",fontFamily:"inherit"}}>{s}</button>)}</div></div>}
        <div ref={bottomRef}/>
      </div>
      <div style={{position:"fixed",bottom:72,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,background:"#fff",borderTop:"1px solid #EEEEE9",padding:"8px 16px 10px",boxSizing:"border-box"}}>
        <div style={{fontSize:10,color:quotaLeft<=5?"#EF4444":"#AAA",marginBottom:5,textAlign:"right"}}>남은횟수 {quotaLeft}/{USAGE_LIMITS.chat}</div>
        <div style={{display:"flex",gap:8}}>
          <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="매출, 직원, 재고 뭐든 물어보세요" style={{...IS,flex:1,marginBottom:0}}/>
          <button onClick={send} disabled={loading||!input.trim()||quotaLeft<=0} style={{padding:"12px 16px",background:loading||!input.trim()||quotaLeft<=0?"#EEEEE9":"#111",color:loading||!input.trim()||quotaLeft<=0?"#AAA":"#fff",border:"none",borderRadius:12,cursor:loading||!input.trim()||quotaLeft<=0?"not-allowed":"pointer",fontSize:14,fontWeight:700,fontFamily:"inherit"}}>전송</button>
        </div>
      </div>
      <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}`}</style>
    </div>
  );
}

// ── SHARED COMPONENTS ─────────────────────────────────────────────────────────
function PH({title,sub,onBack}){return(<div style={{padding:"52px 24px 20px",background:"#fff",borderBottom:"1px solid #EEEEE9"}}>{onBack&&<button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#888",fontFamily:"inherit",marginBottom:6,padding:0}}>← 뒤로</button>}<div style={{fontSize:22,fontWeight:900,color:"#111",letterSpacing:-0.5}}>{title}</div>{sub&&<div style={S.muted}>{sub}</div>}</div>);}
function SL({children,style}){return <div style={{fontSize:12,fontWeight:700,color:"#666",marginBottom:8,...style}}>{children}</div>;}
function RL({label,action,onAction}){return(<div style={{...S.row,marginBottom:10}}><span style={{fontSize:13,fontWeight:700,color:"#111"}}>{label}</span>{action&&<span onClick={onAction} style={{fontSize:11,color:"#888",cursor:"pointer"}}>{action}</span>}</div>);}
// ▼ Card: style, onClick props 추가 — 필요한 곳에서 오버라이드 가능
function Card({children,style,onClick}){return <div style={{background:"#fff",borderRadius:14,padding:"14px 16px",marginBottom:8,border:"1px solid #EEEEE9",...style}} onClick={onClick}>{children}</div>;}
function BigBtn({children,onClick,disabled}){return <button onClick={onClick} disabled={disabled} style={{width:"100%",padding:14,background:disabled?"#EEEEE9":"#111",color:disabled?"#AAA":"#fff",border:"none",borderRadius:14,fontSize:15,fontWeight:700,cursor:disabled?"not-allowed":"pointer",marginBottom:14,fontFamily:"inherit"}}>{children}</button>;}
function OutBtn({children,onClick,style}){return <button onClick={onClick} style={{width:"100%",padding:13,background:"transparent",color:"#888",border:"1.5px solid #EEEEE9",borderRadius:14,fontSize:14,fontWeight:600,cursor:"pointer",marginBottom:10,fontFamily:"inherit",...style}}>{children}</button>;}
function Chip({label,active,onClick,color}){return <button onClick={onClick} style={{padding:"5px 10px",border:`1.5px solid ${active?color:"#EEEEE9"}`,background:active?color:"transparent",color:active?"#fff":"#888",borderRadius:99,fontSize:10,cursor:"pointer",fontFamily:"inherit",fontWeight:active?700:400}}>{label}</button>;}
function IToggle({item,sel,onT}){return(<div onClick={onT} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px",borderRadius:12,marginBottom:7,border:`1.5px solid ${sel?"#111":"#EEEEE9"}`,background:sel?"#111":"#fff",cursor:"pointer"}}><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:18,height:18,borderRadius:4,border:`2px solid ${sel?"#fff":"#DDD"}`,background:sel?"#fff":"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"#111",fontWeight:700}}>{sel?"✓":""}</div><span style={{fontSize:13,fontWeight:500,color:sel?"#fff":"#111"}}>{item.label}</span></div><span style={{fontSize:13,fontWeight:700,color:sel?"#fff":"#666"}}>+{fmt(item.price)}</span></div>);}
function SBadge({s}){const m={"계약완료":["#D1FAE5","#059669"],"검토중":["#FEF3C7","#D97706"],"취소":["#FEE2E2","#DC2626"],"예정":["#DBEAFE","#2563EB"],"완료":["#D1FAE5","#059669"]};const[bg,c]=m[s]||["#F3F4F6","#6B7280"];return <span style={{fontSize:10,background:bg,color:c,padding:"2px 7px",borderRadius:99,fontWeight:600,display:"inline-block",marginTop:2}}>{s}</span>;}
function CopyBtn({msg,label}){const[ok,setOk]=useState(false);const copy=async()=>{await navigator.clipboard.writeText(msg);setOk(true);setTimeout(()=>setOk(false),2000);};return <button onClick={copy} style={{width:"100%",marginTop:8,padding:12,background:ok?"#10B981":"#111",color:"#fff",border:"none",borderRadius:12,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",transition:"background 0.2s"}}>{ok?"✓ 복사됐어요!":(label||"카카오 문구 복사")}</button>;}
function Empty({text}){return <div style={{textAlign:"center",padding:"40px",color:"#CCC",fontSize:13}}>{text}</div>;}
const IS={width:"100%",border:"1.5px solid #EEEEE9",borderRadius:12,padding:"12px 14px",fontSize:14,fontFamily:"'Noto Sans KR',sans-serif",outline:"none",background:"#FAFAF7",boxSizing:"border-box",color:"#111",marginBottom:0};
