
let BASE = null;

const state = {
  globalFpGrowth: 0,
  view: "home",
  level: "pres", // pres, sen, dip, alc
  year: 2024,
  scenario: "moderado",
  allianceType: "none",
  allianceTransfer: 85,

  seatsMode: "190", // 190 | 170 | manual
  manualSeats: null, // { key: seats } persisted local
  teamPolls: [],
  _pollMerged: [],
  pollingEnabled: false,
  // Encuestas: dos variables (candidato y simpatía partidaria)
  pollsCand: { FP: 30, PRM: 50, PLD: 15, OTROS: 5 },
  pollsParty: { FP: 28, PRM: 52, PLD: 12, OTROS: 8 },
  pollWeightCand: 0.80, // prioridad (0.50 - 0.95)
  selectedProv: null,
  fpSwingByProv: {}, // prov_code -> swing pp
  seatsByProvCirc: {}, // "prov-circ" -> seats
};


function safeStorage(){
  try{
    STORE ? STORE.setItem : ((k,v)=>{})("_t","1"); STORE ? STORE.removeItem : (k=>{})("_t");
    return localStorage;
  }catch(e){
    try{ sessionStorage.setItem("_t","1"); sessionStorage.removeItem("_t"); return sessionStorage; }catch(e2){ return null; }
  }
}
const STORE = safeStorage();

const STORAGE_KEYS = {
  presScenarios: 'fp2028_pres_scenarios_v1',
  seatsManual: 'fp2028_seats_manual_v1',
  seatsMode: 'fp2028_seats_mode_v1'


function loadPollStore(){
  try{
    const raw = STORE ? STORE.getItem : (k=>null)(STORAGE_KEYS.pollStore);
    return raw ? JSON.parse(raw) : [];
  }catch(e){ return []; }
}
function savePollStore(items){
  try{
    STORE ? STORE.setItem : ((k,v)=>{})(STORAGE_KEYS.pollStore, JSON.stringify(items||[]));
  }catch(e){}
}

function refreshPollStoreUI(){
  const sel = document.getElementById("pollStoreSelect");
  const hint = document.getElementById("pollStoreHint");
  if(!sel) return;

  const local = loadPollStore();
  const team = Array.isArray(state.teamPolls) ? state.teamPolls : [];
  const items = [
    ...team.map(it=>({...it, __src:"TEAM"})),
    ...local.map(it=>({...it, __src:"LOCAL"}))
  ];

  sel.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "— Selecciona —";
  sel.appendChild(opt0);

  items.forEach((it, idx)=>{
    const o = document.createElement("option");
    o.value = String(idx);
    const src = it.__src==="TEAM" ? "Equipo" : "Local";
    o.textContent = `${it.encuestadora || "Encuesta"} · ${it.fecha || ""} · ${src}`;
    sel.appendChild(o);
  });

  if(hint){
    hint.textContent = `Equipo: ${team.length} · Local: ${local.length} · Para compartir: edita data/encuestas.json en GitHub.`;
  }

  state._pollMerged = items;
}


function loadSeatsPrefs(){
  try{
    const mode = STORE ? STORE.getItem : (k=>null)(STORAGE_KEYS.seatsMode);
    if(mode) state.seatsMode = mode;
    const raw = STORE ? STORE.getItem : (k=>null)(STORAGE_KEYS.seatsManual);
    if(raw) state.manualSeats = JSON.parse(raw);
  }catch(e){}
}
function saveSeatsPrefs(){
  try{
    STORE ? STORE.setItem : ((k,v)=>{})(STORAGE_KEYS.seatsMode, state.seatsMode);
    if(state.manualSeats) STORE ? STORE.setItem : ((k,v)=>{})(STORAGE_KEYS.seatsManual, JSON.stringify(state.manualSeats));
  }catch(e){}
}

function computeSeats170Provisional(){
  // Reduce 190->170 proportionally by "electores" sum per circ (fallback: validos) from diputados rows.
  const rows = BASE.results.diputados[String(state.year)];
  // base seats from rows.seats (per circ)
  const circMap = {}; // key -> {baseSeats, w}
  rows.forEach(r=>{
    const key = `${r.prov_code}-${r.circ_code}`;
    const w = (typeof r.electores==="number" && r.electores>0) ? r.electores
            : (typeof r.validos==="number" && r.validos>0) ? r.validos
            : 1;
    if(!circMap[key]) circMap[key] = { baseSeats: (r.seats||0), w:0 };
    circMap[key].w += w;
  });
  const keys = Object.keys(circMap);
  const baseTotal = keys.reduce((s,k)=>s+(circMap[k].baseSeats||0),0) || 190;
  const targetTotal = 170;

  // initial allocation with floor and at least 1 if baseSeats>0
  const alloc = {};
  const rema = [];
  let sum = 0;
  keys.forEach(k=>{
    const b = circMap[k].baseSeats||0;
    if(b<=0){ alloc[k]=0; return; }
    const raw = b * (targetTotal / baseTotal);
    let a = Math.floor(raw);
    if(a<1) a=1;
    alloc[k]=a;
    sum += a;
    rema.push([k, raw - Math.floor(raw)]);
  });

  // adjust to match targetTotal
  rema.sort((a,b)=>b[1]-a[1]);
  if(sum < targetTotal){
    let i=0;
    while(sum < targetTotal && i < rema.length*5){
      const k = rema[i % rema.length][0];
      alloc[k] += 1;
      sum += 1;
      i += 1;
    }
  }else if(sum > targetTotal){
    // remove from smallest rema, but keep >=1
    rema.sort((a,b)=>a[1]-b[1]);
    let i=0;
    while(sum > targetTotal && i < rema.length*10){
      const k = rema[i % rema.length][0];
      if(alloc[k] > 1){
        alloc[k] -= 1;
        sum -= 1;
      }
      i += 1;
    }
  }
  return alloc; // key -> seats
}

function getSeatsByMode(){
  if(state.seatsMode === "manual" && state.manualSeats){
    return state.manualSeats;
  }
  if(state.seatsMode === "170"){
    return computeSeats170Provisional();
  }
  // default 190 uses state.seatsByProvCirc already loaded from BASE defaults
  return state.seatsByProvCirc;
}
};

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function normalizePct(obj){
  const keys = Object.keys(obj);
  const sum = keys.reduce((s,k)=>s+(+obj[k]||0),0);
  if(sum<=0) return obj;
  const out = {};
  keys.forEach(k=> out[k]= (+obj[k]||0) * 100 / sum );
  return out;
}

function safeNum(v, fallback=0){
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function getBlendedPolls(){
  if(!state.pollingEnabled) return null;
  const cand = normalizePct({...state.pollsCand});
  const party = normalizePct({...state.pollsParty});
  const sumCand = Object.values(cand).reduce((s,v)=>s+v,0);
  const sumParty = Object.values(party).reduce((s,v)=>s+v,0);
  if(sumCand<=0 && sumParty<=0) return null;
  if(sumCand>0 && sumParty<=0) return cand;
  if(sumParty>0 && sumCand<=0) return party;
  const w = clamp(state.pollWeightCand,0.5,0.95);
  const mix = {
    FP: w*cand.FP + (1-w)*party.FP,
    PRM: w*cand.PRM + (1-w)*party.PRM,
    PLD: w*cand.PLD + (1-w)*party.PLD,
    OTROS: w*cand.OTROS + (1-w)*party.OTROS,
  };
  return normalizePct(mix);
}


function winnerFromPctLevel(level, pct){
  const entries = Object.entries(pct).sort((a,b)=>b[1]-a[1]);
  const top1 = entries[0];
  const top2 = entries[1] || ["",0];
  // Presidential in RD requires 50% + 1 vote (i.e., > 50%) to avoid runoff.
  if(level === "pres" && top1[1] <= 50){
    return { winner: "2DA VUELTA", top: [top1, top2], runoff: true };
  }
  return { winner: top1[0], top: entries.slice(0,2), runoff: false };
}

function applySwing(pct, swing){
  // swing on FP (pp), redistribute from others proportionally.
  const out = {...pct};
  const s = swing || 0;
  if(Math.abs(s) < 1e-9) return out;

  const fp0 = out.FP ?? 0;
  out.FP = clamp(fp0 + s, 0, 100);

  const restKeys = Object.keys(out).filter(k=>k!=="FP");
  const restSum0 = restKeys.reduce((t,k)=>t+(out[k]||0),0);
  if(restSum0 <= 0){
    // nothing to take from
    restKeys.forEach(k=> out[k]=0);
    return normalizePct(out);
  }
  const restTarget = 100 - out.FP;
  restKeys.forEach(k=>{
    out[k] = (out[k]||0) * restTarget / restSum0;
  });
  return out;
}


function buildTeamPollEntry(){
  const partido = document.getElementById("pollPartido")?.value || "FP";
  const candidato = (document.getElementById("pollCandidato")?.value || "").trim();
  const encuestadora = (document.getElementById("pollEncuestadora")?.value || "").trim();
  const fecha = document.getElementById("pollFecha")?.value || (new Date()).toISOString().slice(0,10);
  const moe = parseFloat(document.getElementById("pollMOE")?.value || "");
  if(!encuestadora) return {error:"Falta encuestadora."};
  if(!fecha) return {error:"Falta fecha."};
  if(!candidato) return {error:"Falta candidato."};

  // poll numbers (from UI)
  const fp = parseFloat(document.getElementById("pollFP")?.value||"0");
  const prm = parseFloat(document.getElementById("pollPRM")?.value||"0");
  const pld = parseFloat(document.getElementById("pollPLD")?.value||"0");
  const otros = parseFloat(document.getElementById("pollOTROS")?.value||"0");
  const sum = fp+prm+pld+otros;
  if(!isFinite(sum) || sum<=0) return {error:"Valores inválidos."};
  const scale = 100/sum;

  const entry = {
    partido,
    candidato,
    margen_error: isFinite(moe) ? moe : null,
    fecha,
    encuestadora,
    // números (para aplicar)
    year: state.year,
    pollParty: {
      FP: +(fp*scale).toFixed(2),
      PRM: +(prm*scale).toFixed(2),
      PLD: +(pld*scale).toFixed(2),
      OTROS: +(otros*scale).toFixed(2)
    },
    pollingEnabled: true,
    pollWeights: {cand:0, party:1}
  };
  return {entry};
}

function saveTeamPollFromUI(){
  const built = buildTeamPollEntry();
  if(built.error) return alert(built.error);

  // Merge into existing team polls (loaded from file) + local additions
  const team = Array.isArray(state.teamPolls) ? state.teamPolls.slice() : [];
  team.unshift(built.entry);

  // Update UI + download updated file
  state.teamPolls = team;
  refreshPollStoreUI();
  downloadJSON("encuestas.json", team);

  alert("Listo: se descargó encuestas.json. Súbelo a GitHub en /data/encuestas.json para que el equipo lo vea.");
}

function applySimplePollFromUI(){
  const fp = parseFloat(document.getElementById("pollFP")?.value||"0");
  const prm = parseFloat(document.getElementById("pollPRM")?.value||"0");
  const pld = parseFloat(document.getElementById("pollPLD")?.value||"0");
  const otros = parseFloat(document.getElementById("pollOTROS")?.value||"0");
  const sum = fp+prm+pld+otros;
  if(!isFinite(sum) || sum<=0) return alert("Valores inválidos.");
  // Normalize to 100 if user didn't sum exactly
  const scale = 100/sum;
  const pct = {FP: fp*scale, PRM: prm*scale, PLD: pld*scale, OTROS: otros*scale};

  // Set poll inputs for party-level override
  state.pollingEnabled = true;
  state.pollParty = {
    FP: pct.FP,
    PRM: pct.PRM,
    PLD: pct.PLD,
    OTROS: pct.OTROS
  };
  // Candidate not used in math yet; stored in metadata only
  // Default weights: 100% party poll
  state.pollWeights = {cand:0, party:1};
  savePollPrefs();

  const chk = document.getElementById("pollingEnabled");
  if(chk) chk.checked = true;

  renderLevelTables();
  goView("home");
}


function applyPolling(pctBase){
  if(!state.pollingEnabled) return pctBase;
  const p = getBlendedPolls();
  if(!p) return pctBase;
  // Keep provincial "shape" but force national direction by scaling each bloc
  // Here: scale each bloc by (poll/baseAvg) then renormalize.
  const out = {...pctBase};
  const baseSum = Object.values(out).reduce((s,v)=>s+v,0) || 100;
  const baseNorm = {};
  ["FP","PRM","PLD","OTROS"].forEach(k=> baseNorm[k]=(out[k]||0) * 100 / baseSum);

  // Avoid div by zero
  const scaled = {};
  ["FP","PRM","PLD","OTROS"].forEach(k=>{
    const b = baseNorm[k] || 0.0001;
    scaled[k] = (out[k]||0) * (p[k] / b);
  });
  return normalizePct(scaled);
}


function applyAlliance(pct){
  // Aplica transferencia de aliados hacia FP (sin crear un bloque extra),
  // manteniendo total 100% y preservando el análisis del partido.
  const t = clamp(state.allianceTransfer,0,100)/100;
  const out = {...pct};

  if(state.allianceType==="none"){
    return normalizePct(out);
  }

  const fp = out.FP||0, prm = out.PRM||0, pld = out.PLD||0, otros = out.OTROS||0;

  let newFP = fp;
  let newPLD = pld;
  let newOTROS = otros;

  if(state.allianceType==="fp_pld"){
    newFP += t*pld;
    newPLD = (1-t)*pld;
  }else if(state.allianceType==="fp_otros"){
    newFP += t*otros;
    newOTROS = (1-t)*otros;
  }else if(state.allianceType==="bloque_opositor"){
    newFP += t*pld + t*otros;
    newPLD = (1-t)*pld;
    newOTROS = (1-t)*otros;
  }

  return normalizePct({
    FP: newFP,
    PRM: prm,
    PLD: newPLD,
    OTROS: newOTROS
  });
}


function labelBloc(b){ return b; }

function badgeClass(b){ return b.toLowerCase(); }

function pctFmt(x){ return (Math.round((+x||0)*10)/10).toFixed(1) + "%"; }


async function loadTeamPolls(){
  // Carga encuestas compartidas desde data/encuestas.json
  try{
    const res = await fetch("data/encuestas.json", {cache:"no-store"});
    if(!res.ok) return [];
    const items = await res.json();
    return Array.isArray(items) ? items : [];
  }catch(e){
    return [];
  }
}

async function loadBase(){
  const res = await fetch("data/base_data.json");
  BASE = await res.json();
  // Seats defaults
  state.seatsByProvCirc = {...(BASE.diputados_seats_defaults || {})};
}

function getLevelKey(){
  return state.level==="pres" ? "presidencial" :
         state.level==="sen" ? "senadores" :
         state.level==="dip" ? "diputados" : "alcaldes";
}

function getRows(){
  const key = getLevelKey();
  const yr = String(state.year);
  return BASE.results[key][yr];
}

function computeForRow(row){
  let pct = {...row.pct};
  pct = applyPolling(pct);
    // Swing: global + provincia (pp aditivo)
  const globalSwing = state.globalFpGrowth || 0;
  if(globalSwing) pct = applySwing(pct, globalSwing);
  if(row.prov_code != null){
    const swing = state.fpSwingByProv[row.prov_code] || 0;
    if(swing) pct = applySwing(pct, swing);
  }
  pct = applyAlliance(pct);
  return pct;
}

function computeNational(){
  // Weighted average using 'validos' (preferred) or 'electores' if available; fallback to 1.
  const rows = getRows();
  const sums = {FP:0, PRM:0, PLD:0, OTROS:0};
  let totalW = 0;
  rows.forEach(r=>{
    const pct = computeForRow(r);
    const w = (typeof r.validos === "number" && r.validos>0) ? r.validos
            : (typeof r.electores === "number" && r.electores>0) ? r.electores
            : 1;
    totalW += w;
    Object.keys(sums).forEach(k=> sums[k]+= (pct[k]||0) * w);
  });
  const out = {};
  Object.keys(sums).forEach(k=> out[k]=sums[k]/(totalW||1));
  return normalizePct(out);
}

function computeNationalStatic(levelKey, year){
  // levelKey: "presidencial" | "diputados" | "alcaldes" | "senadores"
  if(!BASE || !BASE.results || !BASE.results[levelKey] || !BASE.results[levelKey][String(year)]){
    return normalizePct({FP:0, PRM:0, PLD:0, OTROS:0});
  }
  const rows = BASE.results[levelKey][String(year)];
  const sums = { FP:0, PRM:0, PLD:0, OTROS:0 };
  let totalW = 0;

  rows.forEach(r => {
    const w = (typeof r.validos === "number" && r.validos > 0) ? r.validos
            : (typeof r.emitidos === "number" && r.emitidos > 0) ? r.emitidos
            : (typeof r.electores === "number" && r.electores > 0) ? r.electores
            : 1;
    totalW += w;

    Object.keys(sums).forEach(k => {
      sums[k] += ((r.pct && r.pct[k]) ? r.pct[k] : 0) * w;
    });
  });

  const out = {};
  Object.keys(sums).forEach(k => out[k] = (totalW ? sums[k]/totalW : 0));
  return normalizePct(out);
}

function computeArrastreFP(year){
  const pres = computeNationalStatic("presidencial", year);
  const dip  = computeNationalStatic("diputados", year);
  const alc  = computeNationalStatic("alcaldes", year);

  const presFP = pres.FP || 0;
  const dipFP  = dip.FP || 0;
  const alcFP  = alc.FP || 0;

  return {
    presFP,
    dipFP,
    alcFP,
    arrLeg: presFP > 0 ? (dipFP / presFP) : 0,
    arrMun: presFP > 0 ? (alcFP / presFP) : 0
  };
}

function computeNationalPresVotes(){
  // Presidential: sum votes (valid votes) so we can apply 50% + 1 vote rule.
  const rows = getRows();
  const votes = {FP:0, PRM:0, PLD:0, OTROS:0};
  let validTotal = 0;
  rows.forEach(r=>{
    const pct = computeForRow(r);
    const valid = (typeof r.validos === "number" && r.validos>0) ? r.validos : 0;
    validTotal += valid;
    Object.keys(votes).forEach(k=>{ votes[k] += (pct[k]||0) * valid / 100; });
  });
  const pctFromVotes = {};
  Object.keys(votes).forEach(k=>{ pctFromVotes[k] = validTotal>0 ? (votes[k]/validTotal)*100 : 0; });
  return { votes, validTotal, pct: normalizePct(pctFromVotes) };
}

function presidentialThreshold(validVotes){
  const v = Math.max(0, Math.floor(validVotes||0));
  return Math.floor(v/2) + 1;
}

function determinePresWinnerFromVotes(votesByBloc, validVotes){
  const entries = Object.entries(votesByBloc).sort((a,b)=>b[1]-a[1]);
  const [wKey, wVotes] = entries[0];
  const [rKey, rVotes] = entries[1] || [null, 0];
  const threshold = presidentialThreshold(validVotes);
  return {
    winner: wKey,
    runnerUp: rKey,
    winnerVotes: wVotes,
    runnerUpVotes: rVotes,
    threshold,
    segundaVuelta: wVotes < threshold,
  };
}


function presidentialRuleSummary(nat){
  // returns winner string and meta
  const entries = Object.entries(nat).filter(([k])=>["FP","PRM","PLD","OTROS"].includes(k)).sort((a,b)=>b[1]-a[1]);
  const top = entries[0];
  const second = entries[1];
  if(top[1] > 50){
    return { headline: `${labelBloc(top[0])} gana en 1ra vuelta`, meta: `${pctFmt(top[1])}` };
  }
  return { headline: `Probable 2da vuelta`, meta: `Top-2: ${labelBloc(top[0])} (${pctFmt(top[1])}) vs ${labelBloc(second[0])} (${pctFmt(second[1])})` };
}

function renderNationalTable(){
  const isPres = state.level === "pres";
  const natPack = isPres ? computeNationalPresVotes() : null;
  const nat = isPres ? natPack.pct : computeNational();
  const tbl = document.getElementById("tblNational");
  const keys = Object.entries(nat).filter(([k,v])=>v>0.001).sort((a,b)=>b[1]-a[1]);

  tbl.innerHTML = `
    <thead><tr>
      <th>Bloque</th><th class="num">%</th>
    </tr></thead>
    <tbody>
      ${keys.map(([k,v])=>`
        <tr>
          <td><span class="badge ${badgeClass(k)}">${labelBloc(k)}</span></td>
          <td class="num">${pctFmt(v)}</td>
        </tr>
      `).join("")}
    </tbody>
  `;

  // Cards
  const lvlName = state.level==="pres"?"Presidencial": state.level==="sen"?"Senadores": state.level==="dip"?"Diputados":"Alcaldes";
  document.getElementById("cardLevel").textContent = lvlName;

  const win = winnerFromPctLevel(state.level, nat);
  let headline = win.runoff ? `Segunda vuelta probable` : `${labelBloc(win.winner)} lidera`;
  let meta = `Top-2: ${labelBloc(win.top[0][0])} (${pctFmt(win.top[0][1])}) · ${labelBloc(win.top[1][0])} (${pctFmt(win.top[1][1])})` + (win.runoff ? ` · Ningún bloque supera 50%` : ``);

  if(state.level==="pres" && natPack){
    const winVotes = determinePresWinnerFromVotes(natPack.votes, natPack.validTotal);
    const wPct = nat[winVotes.winner] || 0;
    const rPct = nat[winVotes.runnerUp] || 0;
    const thr = winVotes.threshold;
    const valid = Math.round(natPack.validTotal);
    if(!winVotes.segundaVuelta){
      headline = `${labelBloc(winVotes.winner)} gana en 1ra vuelta`;
      meta = `${pctFmt(wPct)} · ${fmtInt(Math.round(winVotes.winnerVotes))} votos (umbral: ${fmtInt(thr)} de ${fmtInt(valid)} válidos)`;
    }else{
      headline = `Probable 2da vuelta`;
      meta = `Top-2: ${labelBloc(winVotes.winner)} (${pctFmt(wPct)}) vs ${labelBloc(winVotes.runnerUp)} (${pctFmt(rPct)}) · umbral: ${fmtInt(thr)}`;
    }
  } else if(state.level==="pres"){
    const r = presidentialRuleSummary(nat);
    headline = r.headline;
    meta = r.meta;
  }
  document.getElementById("cardWinner").textContent = headline;
  document.getElementById("cardWinnerMeta").textContent = meta;

  const allianceLabel =
    state.allianceType==="none" ? "Sin alianza" :
    state.allianceType==="fp_pld" ? "FP + PLD" :
    state.allianceType==="fp_otros" ? "FP + OTROS" : "Bloque opositor";

  document.getElementById("cardAlliance").textContent = allianceLabel;
  document.getElementById("cardTransfer").textContent = String(state.allianceTransfer);

  document.getElementById("cardSource").textContent = state.pollingEnabled ? "Encuestas" : `Base ${state.year}`;
  document.getElementById("cardSourceMeta").textContent = state.pollingEnabled ? "Override nacional normalizado" : "Con swings por provincia";

  // Arrastre FP (base histórica del año seleccionado)
  const elArrLeg = document.getElementById("cardArrLeg");
  const elArrMun = document.getElementById("cardArrMun");
  if(elArrLeg && elArrMun){
    const arr = computeArrastreFP(state.year);
    elArrLeg.textContent = (arr.arrLeg * 100).toFixed(1) + "%";
    elArrMun.textContent = (arr.arrMun * 100).toFixed(1) + "%";
  }

function monteCarloPres(nIter=2000){
  // Monte Carlo on national presidential shares. Uses current scenario settings (polls/alliances/swing).
  // Noise model: national sigma 2.0pp distributed across blocs + small territorial noise via province weights baked in computeNationalPresVotes.
  const isPres = state.level === "pres";
  // Ensure we compute on presidential regardless of current level
  const savedLevel = state.level;
  state.level = "pres";
  const pack = computeNationalPresVotes();
  const base = pack.pct;
  state.level = savedLevel;

  const blocs = ["FP","PRM","PLD","OTROS"].filter(b=>base[b] && base[b]>0.0001);
  const mu = blocs.map(b=>base[b]);
  const sigma = 2.0; // pp
  let p1=0, p2=0, pw=0;
  const wins = {};
  blocs.forEach(b=>wins[b]=0);

  for(let i=0;i<nIter;i++){
    // Add gaussian noise per bloc then renormalize
    const draw = {};
    blocs.forEach((b,idx)=>{
      draw[b] = Math.max(0, mu[idx] + randn_bm()*sigma);
    });
    const pct = normalizePct(draw);

    // Determine winner: 50%+1 rule approx by pct>50
    const entries = Object.entries(pct).sort((a,b)=>b[1]-a[1]);
    const top = entries[0], runner = entries[1] || ["",0];
    const segunda = (top[1] < 50);
    if(!segunda) p1 += 1;
    else p2 += 1;
    wins[top[0]] += 1;
    if(!segunda) pw += 1; // if 1st round win by top bloc
  }
  // For pw we treat it as P(ganar 1ra). For a crude P(ganar) we assume top in 1ra has 0.6 chance if runoff.
  const pTop = Object.entries(wins).sort((a,b)=>b[1]-a[1])[0][0];
  const pTopShare = wins[pTop]/nIter;
  const pWin = (p1/nIter) + (p2/nIter)*0.6*pTopShare; // heuristic
  return {
    p1: p1/nIter,
    p2: p2/nIter,
    pw: pWin,
    top: pTop
  };
}

// Gaussian helper
function randn_bm(){
  let u = 0, v = 0;
  while(u === 0) u = Math.random();
  while(v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function computeArrastreProv(year){
  // province-level arrastre: diputados/presidencial for FP
  const presRows = BASE.results.presidencial[String(year)];
  const dipRows = BASE.results.diputados[String(year)];
  const mapPres = {};
  presRows.forEach(r=>{ mapPres[r.prov_code] = r; });
  const out = [];
  dipRows.forEach(r=>{
    const p = mapPres[r.prov_code];
    if(!p) return;
    const presFP = p.pct?.FP || 0;
    const dipFP = r.pct?.FP || 0;
    if(presFP<=0) return;
    out.push({prov:r.provincia, prov_code:r.prov_code, arr: dipFP/presFP, presFP, dipFP});
  });
  return out.sort((a,b)=>a.arr-b.arr);
}


function computeArrastreMun(year, limit=10){
  // municipio-level arrastre: alcaldes/presidencial for FP
  // Prefer presidential by municipality if available; fallback to province-level proxy.
  const alcRows = BASE.results.alcaldes[String(year)];
  const out = [];

  const presMun = (BASE.results.presidencial_municipios && BASE.results.presidencial_municipios[String(year)]) 
    ? BASE.results.presidencial_municipios[String(year)] : null;

  if(presMun){
    const presMap = {};
    presMun.forEach(r=>{
      presMap[`${r.prov_code}-${r.mun_code}`] = r.pct?.FP || 0;
    });
    alcRows.forEach(r=>{
      const key = `${r.prov_code}-${r.mun_code}`;
      const presFP = presMap[key] || 0;
      const alcFP = r.pct?.FP || 0;
      if(presFP<=0) return;
      out.push({prov:r.provincia, mun:r.municipio, mun_code:r.mun_code, prov_code:r.prov_code, arr: alcFP/presFP, presFP, alcFP});
    });
  }else{
    // fallback: provincia presidential as base
    const presRows = BASE.results.presidencial[String(year)];
    const presMap = {};
    presRows.forEach(r=> presMap[r.prov_code] = r.pct?.FP || 0);
    alcRows.forEach(r=>{
      const presFP = presMap[r.prov_code] || 0;
      const alcFP = r.pct?.FP || 0;
      if(presFP<=0) return;
      out.push({prov:r.provincia, mun:r.municipio, mun_code:r.mun_code, prov_code:r.prov_code, arr: alcFP/presFP, presFP, alcFP});
    });
  }

  out.sort((a,b)=>a.arr-b.arr);
  return out;
}



function computeWinnerFromPct(pct){
  const entries = Object.entries(pct).sort((a,b)=>b[1]-a[1]);
  return {winner: entries[0][0], runner: entries[1]||["",0], diff: (entries[0][1] - (entries[1]?.[1]||0))};
}
function withLevel(tmpLevel, fn){
  const saved = state.level;
  state.level = tmpLevel;
  const out = fn();
  state.level = saved;
  return out;
}
function computeAlcStats(){
  return withLevel("alc", ()=>{
    const rows = getRows();
    const wins = {FP:0,PRM:0,PLD:0,OTROS:0};
    const diffs = [];
    rows.forEach(r=>{
      const pct = applyAlliance(applyPolling({...r.pct}));
      const w = computeWinnerFromPct(pct);
      if(wins[w.winner]!==undefined) wins[w.winner]+=1;
      diffs.push({prov:r.provincia, mun:r.municipio, winner:w.winner, diff:w.diff, pct});
    });
    return {wins, diffs};
  });
}
function computeDipSeatTotals(){
  return withLevel("dip", ()=>{
    const rows = getRows();
    const seatsMap = getSeatsByMode();
    let total = {FP:0,PRM:0,PLD:0,OTROS:0};
    rows.forEach(r=>{
      const key = `${r.prov_code}-${r.circ_code}`;
      const seats = (seatsMap && seatsMap[key]) ? seatsMap[key] : (r.seats||0);
      const pct = applyAlliance(applyPolling({...r.pct}));
      const alloc = dhondtSeatAlloc(pct, seats);
      total.FP += alloc.FP||0;
      total.PRM += alloc.PRM||0;
      total.PLD += alloc.PLD||0;
      total.OTROS += alloc.OTROS||0;
    });
    return total;
  });
}
function computeDipPivot(threshold=2.0){
  return withLevel("dip", ()=>{
    const rows = getRows();
    const seatsMap = getSeatsByMode();
    const out=[];
    rows.forEach(r=>{
      const key = `${r.prov_code}-${r.circ_code}`;
      const seats = (seatsMap && seatsMap[key]) ? seatsMap[key] : (r.seats||0);
      const pct0 = applyAlliance(applyPolling({...r.pct}));
      const a0 = dhondtSeatAlloc(pct0, seats);
      const fp0 = a0.FP||0;

      let needed = null;
      for(let step=0.1; step<=threshold+1e-9; step+=0.1){
        const pct = {...pct0};
        const take = Math.min(step, pct.OTROS||0);
        pct.FP = (pct.FP||0) + take;
        pct.OTROS = (pct.OTROS||0) - take;
        const a = dhondtSeatAlloc(normalizePct(pct), seats);
        if((a.FP||0) >= fp0+1){
          needed = step;
          break;
        }
      }
      if(needed!==null){
        out.push({circ:r.circ, prov:r.provincia, key, needed});
      }
    });
    out.sort((a,b)=>a.needed-b.needed);
    return out;
  });
}
function computeRanking(mode, threshold){
  const th = parseFloat(threshold)||2.0;

  if(mode==="opp_mun"){
    const arr = computeArrastreMun(state.year);
    const worst = arr.slice(0,20).map(o=>({label:`${o.mun} (${o.prov})`, value:`Arr ${Math.round(o.arr*100)}%`, extra:`Pres ${pctFmt(o.presFP)} · Alc ${pctFmt(o.alcFP)}`}));
    return {headers:["Territorio","Indicador","Detalle"], rows: worst};
  }

  if(mode==="pivot_mun"){
    const alc = computeAlcStats();
    const piv = alc.diffs.filter(x=>x.diff<=th).sort((a,b)=>a.diff-b.diff).slice(0,20)
      .map(o=>({label:`${o.mun} (${o.prov})`, value:`${o.winner} por ${o.diff.toFixed(1)}pp`, extra:`FP ${pctFmt(o.pct.FP||0)} · PRM ${pctFmt(o.pct.PRM||0)}`}));
    return {headers:["Territorio","Cerrada","Detalle"], rows: piv};
  }

  if(mode==="pivot_dip"){
    const piv = computeDipPivot(th).slice(0,20).map(o=>({label:`${o.circ} (${o.prov})`, value:`+1 escaño con ~${o.needed.toFixed(1)}pp`, extra:o.key}));
    return {headers:["Circ.","Oportunidad","Clave"], rows:piv};
  }

  if(mode==="alliance_flip"){
    const saved = state.allianceType;
    const savedT = state.allianceTransfer;

    state.allianceType="none";
    const base = computeAlcStats().diffs;

    state.allianceType=saved; state.allianceTransfer=savedT;
    const cur = computeAlcStats().diffs;

    const flips=[];
    const mapBase = {};
    base.forEach(b=>{ mapBase[`${b.prov}|${b.mun}`]=b.winner; });
    cur.forEach(c=>{
      const k=`${c.prov}|${c.mun}`;
      const w0=mapBase[k];
      if(w0 && w0!==c.winner){
        flips.push({label:`${c.mun} (${c.prov})`, value:`${w0} → ${c.winner}`, extra:`margen ${c.diff.toFixed(1)}pp`});
      }
    });
    flips.sort((a,b)=>a.label.localeCompare(b.label));
    return {headers:["Territorio","Cambio","Detalle"], rows: flips.slice(0,20)};
  }

  return {headers:["—","—","—"], rows:[]};
}

function renderPollHistory(){
  const tbl = document.getElementById("tblPollHistory");
  if(!tbl) return;
  const team = Array.isArray(state.teamPolls) ? state.teamPolls.slice() : [];
  // Only team polls with pollParty values
  const rows = team
    .filter(p=>p && p.pollParty)
    .sort((a,b)=>parseISODate(b.fecha)-parseISODate(a.fecha))
    .slice(0,20);

  if(!rows.length){
    tbl.innerHTML = "<tr><td style='opacity:.8'>No hay encuestas de equipo todavía (data/encuestas.json).</td></tr>";
    return;
  }

  const body = rows.map(p=>{
    const pp = p.pollParty || {};
    return `<tr>
      <td><b>${p.encuestadora||""}</b><div style="opacity:.8">${p.fecha||""} · MOE ${p.margen_error ?? "—"}</div><div style="opacity:.85">${p.candidato||""} (${p.partido||""})</div></td>
      <td class="num">${pctFmt(pp.FP||0)}</td>
      <td class="num">${pctFmt(pp.PRM||0)}</td>
      <td class="num">${pctFmt(pp.PLD||0)}</td>
      <td class="num">${pctFmt(pp.OTROS||0)}</td>
    </tr>`;
  }).join("");

  tbl.innerHTML = buildTable(["Encuesta","FP","PRM","PLD","OTROS"], body);
}

function renderRanking(){
  const tbl = document.getElementById("tblRanking");
  const sel = document.getElementById("rankMode");
  const th = document.getElementById("pivotThreshold");
  if(!tbl || !sel) return;
  const data = computeRanking(sel.value, th ? th.value : 2.0);
  tbl.innerHTML = buildTable(
    data.headers,
    data.rows.map(r=>`<tr><td>${r.label}</td><td class="num">${r.value}</td><td>${r.extra||""}</td></tr>`).join("")
  );
}


function parseISODate(s){
  // returns timestamp (ms) for sorting, 0 if invalid
  if(!s) return 0;
  const t = Date.parse(s);
  return isNaN(t) ? 0 : t;
}

function downloadJSON(filename, obj){
  const blob = new Blob([JSON.stringify(obj, null, 2)], {type:"application/json;charset=utf-8;"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function exportRankingCSV(){
  const sel = document.getElementById("rankMode");
  const th = document.getElementById("pivotThreshold");
  const data = computeRanking(sel ? sel.value : "opp_mun", th ? th.value : 2.0);
  const rows = [data.headers.join(",")].concat(
    data.rows.map(r=>[r.label,r.value,(r.extra||"")].map(x=>`"${String(x).replace(/"/g,'""')}"`).join(","))
  );
  const blob = new Blob([rows.join("\n")], {type:"text/csv;charset=utf-8;"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ranking_${(sel?sel.value:"")}_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}


function compareTwoTeamPolls(){
  const team = Array.isArray(state.teamPolls) ? state.teamPolls.filter(p=>p && p.pollParty) : [];
  if(team.length<2) return alert("Necesitas al menos 2 encuestas en data/encuestas.json");
  team.sort((a,b)=>parseISODate(b.fecha)-parseISODate(a.fecha));
  const list = team.slice(0,10).map((p,i)=>`${i+1}) ${p.encuestadora} ${p.fecha} (FP ${pctFmt(p.pollParty?.FP||0)})`).join("\n");
  const a = prompt("Elige la # de la encuesta A (1-10):\n"+list, "1");
  if(!a) return;
  const b = prompt("Elige la # de la encuesta B (1-10):\n"+list, "2");
  if(!b) return;
  const ia = parseInt(a,10)-1;
  const ib = parseInt(b,10)-1;
  const pa = team[ia]; const pb = team[ib];
  if(!pa || !pb) return alert("Selección inválida.");

  const da = (pb.pollParty?.FP||0) - (pa.pollParty?.FP||0);
  const db = (pb.pollParty?.PRM||0) - (pa.pollParty?.PRM||0);
  const dc = (pb.pollParty?.PLD||0) - (pa.pollParty?.PLD||0);
  const dd = (pb.pollParty?.OTROS||0) - (pa.pollParty?.OTROS||0);

  alert(
    `Comparación (B - A)\n\nA: ${pa.encuestadora} · ${pa.fecha}\nB: ${pb.encuestadora} · ${pb.fecha}\n\n` +
    `FP: ${da>=0?"+":""}${da.toFixed(1)}pp\n` +
    `PRM: ${db>=0?"+":""}${db.toFixed(1)}pp\n` +
    `PLD: ${dc>=0?"+":""}${dc.toFixed(1)}pp\n` +
    `OTROS: ${dd>=0?"+":""}${dd.toFixed(1)}pp`
  );
}

function applyLatestTeamPoll(){
  const team = Array.isArray(state.teamPolls) ? state.teamPolls.filter(p=>p && p.pollParty) : [];
  if(!team.length) return alert("No hay encuestas en data/encuestas.json");
  team.sort((a,b)=>parseISODate(b.fecha)-parseISODate(a.fecha));
  const it = team[0];

  state.year = it.year || state.year;
  state.pollingEnabled = true;
  state.pollParty = it.pollParty || state.pollParty;
  state.pollWeights = it.pollWeights || {cand:0, party:1};

  const chk = document.getElementById("pollingEnabled");
  if(chk) chk.checked = true;

  // sync UI fields
  const p = state.pollParty || {};
  const setVal = (id,val)=>{ const el=document.getElementById(id); if(el && val!=null) el.value = val; };
  setVal("pollFP", p.FP!=null? p.FP : "");
  setVal("pollPRM", p.PRM!=null? p.PRM : "");
  setVal("pollPLD", p.PLD!=null? p.PLD : "");
  setVal("pollOTROS", p.OTROS!=null? p.OTROS : "");
  const setTxt=(id,val)=>{ const el=document.getElementById(id); if(el && val!=null) el.value = val; };
  setTxt("pollCandidato", it.candidato || "");
  const elPart=document.getElementById("pollPartido"); if(elPart && it.partido) elPart.value = it.partido;
  const elMOE=document.getElementById("pollMOE"); if(elMOE && it.margen_error!=null) elMOE.value = it.margen_error;
  const elF=document.getElementById("pollFecha"); if(elF && it.fecha) elF.value = it.fecha;
  setTxt("pollEncuestadora", it.encuestadora || "");

  renderLevelTables();
  goView("home");
  alert(`Aplicada encuesta más reciente: ${it.encuestadora} · ${it.fecha}`);
}

function compareAlliance(){
  const cmpBox = document.getElementById("cmpBox");
  const elPres = document.getElementById("cmpPres");
  const elDip = document.getElementById("cmpDip");
  const elAlc = document.getElementById("cmpAlc");
  const elDet = document.getElementById("cmpDetails");
  if(!cmpBox) return;

  const savedType = state.allianceType;
  const savedT = state.allianceTransfer;

  state.allianceType="none";
  const pres0 = computeForLevelKeyNational("presidencial").FP || 0;
  const dip0 = computeDipSeatTotals().FP || 0;
  const alc0 = computeAlcStats().wins.FP || 0;

  state.allianceType=savedType; state.allianceTransfer=savedT;
  const pres1 = computeForLevelKeyNational("presidencial").FP || 0;
  const dip1 = computeDipSeatTotals().FP || 0;
  const alc1 = computeAlcStats().wins.FP || 0;

  const dPres = pres1 - pres0;
  const dDip = dip1 - dip0;
  const dAlc = alc1 - alc0;

  cmpBox.style.display = "block";
  elPres.textContent = `${pres0.toFixed(1)} → ${pres1.toFixed(1)} (${dPres>=0?"+":""}${dPres.toFixed(1)}pp)`;
  elDip.textContent = `${dip0} → ${dip1} (${dDip>=0?"+":""}${dDip})`;
  elAlc.textContent = `${alc0} → ${alc1} (${dAlc>=0?"+":""}${dAlc})`;

  const score = (dPres*10) + (dDip*2) + (dAlc*0.5);
  const verdict = score>=0 ? "CONVIENE (beneficio neto)" : "NO CONVIENE (costo neto)";
  if(elDet){
    elDet.textContent = `Indicador alianza: ${verdict} · Score ${score.toFixed(1)} (peso: 10×pp presid + 2×dip + 0.5×alcaldías).`; 
  }
}


function renderTopKPIs(){
  try{
    // Pull national presidential result for selected year
    const pres = computeForLevelKeyNational("presidencial") || {};
    const fp = pres.FP || 0;
    const prm = pres.PRM || 0;
    const pld = pres.PLD || 0;
    const elFP = document.getElementById("kpiFP");
    const elPRM = document.getElementById("kpiPRM");
    const elPLD = document.getElementById("kpiPLD");
    if(elFP) elFP.textContent = pctFmt(fp);
    if(elPRM) elPRM.textContent = pctFmt(prm);
    if(elPLD) elPLD.textContent = pctFmt(pld);

    const elM = document.getElementById("kpiMuns");
    if(elM){
      // base data has rows per municipality at alc level; use current year count
      const saved = state.level;
      state.level="alc";
      const rows = getRows();
      state.level=saved;
      elM.textContent = String(rows.length || 0);
    }

    const elV = document.getElementById("kpiValid");
    if(elV){
      // If base has total valid votes national in meta, use it; else hide
      const meta = (base && base.meta && base.meta[state.year]) ? base.meta[state.year] : null;
      if(meta && meta.valid_votes_national){
        const n = meta.valid_votes_national;
        elV.textContent = (n>=1e6) ? (Math.round(n/1e4)/100)+"M" : String(n);
      }else{
        elV.textContent = "—";
      }
    }

    // subtitles
    const elFPs = document.getElementById("kpiFPsub");
    const elPRMs = document.getElementById("kpiPRMsub");
    const elPLDs = document.getElementById("kpiPLDsub");
    if(elFPs) elFPs.textContent = "Nacional";
    if(elPRMs) elPRMs.textContent = "Primera vuelta";
    if(elPLDs) elPLDs.textContent = "Nacional";
  }catch(e){}
}

function renderExecutivePanel(){
  renderTopKPIs();
  // Monte Carlo
  const elP1 = document.getElementById("mcP1");
  const elP2 = document.getElementById("mcP2");
  const elPw = document.getElementById("mcPw");
  const elHint = document.getElementById("mcHint");
  if(elP1 && elP2 && elPw){
    const mc = monteCarloPres(2000);
    elP1.textContent = (mc.p1*100).toFixed(1) + "%";
    elP2.textContent = (mc.p2*100).toFixed(1) + "%";
    elPw.textContent = (mc.pw*100).toFixed(1) + "%";
    if(elHint) elHint.textContent = `Bloque más probable: ${labelBloc(mc.top)} · Ruido: ±2.0pp`;
  }

  // Alliance indicator (delta vs none) on FP perspective
  const elAliPres = document.getElementById("aliPresImpact");
  const elAliDip = document.getElementById("aliDipImpact");
  const elAliAlc = document.getElementById("aliAlcImpact");
  const elAliHint = document.getElementById("aliHint");
  if(elAliPres && elAliDip && elAliAlc){
    // save current
    const savedAlliance = state.allianceType;
    const savedTransfer = state.allianceTransfer;

    // baseline none
    state.allianceType = "none";
    const basePres = computeForLevelKeyNational("presidencial").FP;
    const baseDip = computeForLevelKeyNational("diputados").FP;
    const baseAlc = computeForLevelKeyNational("alcaldes").FP;

    // restore current
    state.allianceType = savedAlliance;
    state.allianceTransfer = savedTransfer;
    const curPres = computeForLevelKeyNational("presidencial").FP;
    const curDip = computeForLevelKeyNational("diputados").FP;
    const curAlc = computeForLevelKeyNational("alcaldes").FP;

    const dPres = curPres - basePres;
    const dDip = curDip - baseDip;
    const dAlc = curAlc - baseAlc;

    elAliPres.textContent = (dPres>=0?"+":"") + dPres.toFixed(1) + " pp";
    elAliDip.textContent = (dDip>=0?"+":"") + dDip.toFixed(1) + " pp";
    elAliAlc.textContent = (dAlc>=0?"+":"") + dAlc.toFixed(1) + " pp";
    if(elAliHint) elAliHint.textContent = "Comparado vs ‘Sin alianza’ usando la configuración actual (encuestas/swing/transfer).";
  }

  renderRanking();
  renderPollHistory();

  // Arrastre rankings

  // Exterior circ (presidencial)
  const tblExt = document.getElementById("tblExtCirc");
  if(tblExt){
    const ext = (BASE.results.presidencial_exterior_circ && BASE.results.presidencial_exterior_circ[String(state.year)]) 
      ? BASE.results.presidencial_exterior_circ[String(state.year)] : null;
    if(ext && ext.length){
      tblExt.innerHTML = buildTable(
        ["Circ.","FP","PRM","PLD","OTROS","Válidos"],
        ext.map(r=>`<tr><td>${r.circ}</td><td class="num">${pctFmt(r.pct.FP||0)}</td><td class="num">${pctFmt(r.pct.PRM||0)}</td><td class="num">${pctFmt(r.pct.PLD||0)}</td><td class="num">${pctFmt(r.pct.OTROS||0)}</td><td class="num">${(r.validos||0).toLocaleString()}</td></tr>`).join("")
      );
    }else{
      tblExt.innerHTML = "<tr><td style='opacity:.8'>No hay data exterior por circ para este año.</td></tr>";
    }
  }


  const tblProv = document.getElementById("tblArrProv");
  if(tblProv){
    const arr = computeArrastreProv(state.year);
    const worst = arr.slice(0,10);
    tblProv.innerHTML = buildTable(
      ["Provincia","Arr.","Pres FP","Dip FP"],
      worst.map(o=>`<tr><td>${formatProvLabel(o.prov, o.prov_code)}</td><td class="num">${(o.arr*100).toFixed(0)}%</td><td class="num">${pctFmt(o.presFP)}</td><td class="num">${pctFmt(o.dipFP)}</td></tr>`).join("")
    );
  }
  const tblMun = document.getElementById("tblArrMun");
  if(tblMun){
    const arrm = computeArrastreMun(state.year);
    const worst = arrm.slice(0,10);
    tblMun.innerHTML = buildTable(
      ["Municipio","Arr.","Pres FP (Prov)","Alc FP"],
      worst.map(o=>`<tr><td>${o.mun}</td><td class="num">${(o.arr*100).toFixed(0)}%</td><td class="num">${pctFmt(o.presFP)}</td><td class="num">${pctFmt(o.alcFP)}</td></tr>`).join("")
    );
  }

  // Data alerts
  const al = document.getElementById("dataAlerts");
  if(al){
    const alerts = [];
    // Exterior presence check
    const hasExterior = (BASE.dim && BASE.dim.provincias || []).some(p=>String(p.provincia||"").toUpperCase().includes("EXTERIOR"));
    if(!hasExterior) alerts.push("Exterior no está en la base: el sistema está listo para integrarlo cuando se incorpore a data (presidencial y circ. congresual exterior).");
    // Seats mode
    if(state.seatsMode==="170") alerts.push("Diputados 170 en modo PROVISIONAL (reducción proporcional desde 2024). Actualizar cuando la JCE publique la tabla oficial.");
    // Missing validos fallback quick check (dip)
    const dipRows = BASE.results.diputados[String(state.year)];
    const missingValidos = dipRows.filter(r=>!(typeof r.validos==="number" && r.validos>0)).length;
    if(missingValidos>0) alerts.push(`${missingValidos} filas de Diputados sin 'validos': se usa fallback (emitidos/electores).`);
    if(alerts.length){
      al.style.display = "block";
      al.innerHTML = "<b>Alertas:</b><br>" + alerts.map(a=>`• ${a}`).join("<br>");
    }else{
      al.style.display = "none";
      al.textContent = "";
    }
  }
}

function computeForLevelKeyNational(levelKey){
  // Compute current scenario national pct for a given levelKey (ignores current state.level temporarily)
  const saved = state.level;
  state.level = (levelKey==="presidencial") ? "pres" : (levelKey==="diputados") ? "dip" : (levelKey==="alcaldes") ? "alc" : "sen";
  const pct = (state.level==="pres") ? computeNationalPresVotes().pct : computeNational();
  state.level = saved;
  return pct;
}

}

function buildTable(headers, rowsHtml){
  return `<thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rowsHtml}</tbody>`;
}


function formatProvLabel(name, prov_code){
  if(prov_code==null) return name;
  // Exterior / recintos especiales (no salen en el mapa SVG)
  if(prov_code > 32){
    const up = String(name||"").toUpperCase();
    if(up.includes("PEN")) return "⛓ " + name;
    return "🌐 " + name;
  }
  return name;
}

function renderPresProv(){
  const rows = BASE.results.presidencial[String(state.year)];
  const tbl = document.getElementById("tblPresProv");
  const body = rows
    .map(r=>{
      const pct = computeForRow(r);
      const win = winnerFromPctLevel(state.level, pct);
      const p = Object.entries(pct).filter(([k,v])=>v>0.001).sort((a,b)=>b[1]-a[1]);
      return {prov:r.provincia, prov_code:r.prov_code, win:win.winner, pct, p};
    })
    .sort((a,b)=> b.p[0][1]-a.p[0][1])
    .map(o=>`
      <tr data-prov="${o.prov_code}">
        <td>${formatProvLabel(o.prov, o.prov_code)}</td>
        <td><span class="badge ${badgeClass(o.win)}">${labelBloc(o.win)}</span></td>
        <td class="num">${pctFmt(o.pct.FP || 0)}</td>
        <td class="num">${pctFmt(o.pct.PRM || 0)}</td>
        <td class="num">${pctFmt(o.pct.PLD || 0)}</td>
        <td class="num">${pctFmt(o.pct.OTROS || 0)}</td>
      </tr>
    `).join("");

  tbl.innerHTML = buildTable(
    ["Provincia","Ganador","FP","PRM","PLD","OTROS"],
    body
  );

  tbl.querySelectorAll("tbody tr").forEach(tr=>{
    tr.addEventListener("click", ()=>{
      const pc = +tr.getAttribute("data-prov");
      selectProvince(pc);
      goView("home");
    });
  });
}

function renderSenProv(){
  const rows = BASE.results.senadores[String(state.year)];
  const tbl = document.getElementById("tblSenProv");
  const body = rows
    .map(r=>{
      const pct = computeForRow(r);
      const win = winnerFromPctLevel(state.level, pct);
      const p = Object.entries(pct).filter(([k,v])=>v>0.001).sort((a,b)=>b[1]-a[1]);
      return {prov:r.provincia, prov_code:r.prov_code, win:win.winner, pct, top:p[0][1]};
    })
    .sort((a,b)=> b.top-a.top)
    .map(o=>`
      <tr data-prov="${o.prov_code}">
        <td>${formatProvLabel(o.prov, o.prov_code)}</td>
        <td><span class="badge ${badgeClass(o.win)}">${labelBloc(o.win)}</span></td>
        <td class="num">${pctFmt(o.pct.FP || 0)}</td>
        <td class="num">${pctFmt(o.pct.PRM || 0)}</td>
        <td class="num">${pctFmt(o.pct.PLD || 0)}</td>
        <td class="num">${pctFmt(o.pct.OTROS || 0)}</td>
      </tr>
    `).join("");

  tbl.innerHTML = buildTable(["Provincia","Ganador","FP","PRM","PLD","OTROS"], body);
}

function dhondtSeatAlloc(pct, seats){
  // pct: shares; return seats per bloc among COAL/PRM/PLD/OTROS (ignore FP)
  const parties = ["FP","PRM","PLD","OTROS"].filter(k=>(pct[k]||0)>0.0001);
  const quotients=[];
  parties.forEach(p=>{
    for(let d=1; d<=seats; d++){
      quotients.push({p, q:(pct[p]||0)/d});
    }
  });
  quotients.sort((a,b)=>b.q-a.q);
  const winners = quotients.slice(0,seats);
  const alloc = {FP:0, PRM:0, PLD:0, OTROS:0};
  winners.forEach(w=>alloc[w.p]++);
  return alloc;
}

function renderDipCirc(){
  const rows = BASE.results.diputados[String(state.year)];
  const tbl = document.getElementById("tblDipCirc");
  const body = rows
    .map(r=>{
      const pct = computeForRow(r);
      const key = `${r.prov_code}-${r.circ_code}`;
      const seatsMap = getSeatsByMode();
      const seats = (seatsMap && seatsMap[key]) ? seatsMap[key] : 0;
      const alloc = seats>0 ? dhondtSeatAlloc(pct, seats) : {FP:0,PRM:0,PLD:0,OTROS:0};
      const winSeats = Object.entries(alloc).sort((a,b)=>b[1]-a[1])[0];
      return {prov:r.provincia, prov_code:r.prov_code, circ:r.circ_code, seats, alloc, win:winSeats[0], winN:winSeats[1]};
    })
    .sort((a,b)=> (b.winN-b.seats/100) - (a.winN-a.seats/100))
    .map(o=>`
      <tr data-prov="${o.prov_code}">
        <td>${formatProvLabel(o.prov, o.prov_code)}</td>
        <td class="num">Circ ${o.circ}</td>
        <td class="num">${o.seats}</td>
        <td><span class="badge ${badgeClass(o.win)}">${labelBloc(o.win)}</span></td>
        <td class="num">${o.alloc.FP}</td>
        <td class="num">${o.alloc.PRM}</td>
        <td class="num">${o.alloc.PLD}</td>
        <td class="num">${o.alloc.OTROS}</td>
      </tr>
    `).join("");

  tbl.innerHTML = buildTable(["Provincia","Circ","Curules","Bloque líder","ALIANZA","PRM","PLD","OTROS"], body);
}

function renderAlcMun(){
  const rows = BASE.results.alcaldes[String(state.year)];
  const tbl = document.getElementById("tblAlcMun");
  const body = rows
    .map(r=>{
      const pct = computeForRow(r);
      const win = winnerFromPctLevel(state.level, pct);
      const p = Object.entries(pct).filter(([k,v])=>v>0.001).sort((a,b)=>b[1]-a[1]);
      return {prov:r.provincia, prov_code:r.prov_code, mun:r.municipio, mun_code:r.mun_code, win:win.winner, pct, top:p[0][1]};
    })
    .sort((a,b)=> b.top-a.top)
    .slice(0,400) // keep UI responsive; full data still in JSON
    .map(o=>`
      <tr data-prov="${o.prov_code}">
        <td>${formatProvLabel(o.prov, o.prov_code)}</td>
        <td>${o.mun}</td>
        <td><span class="badge ${badgeClass(o.win)}">${labelBloc(o.win)}</span></td>
        <td class="num">${pctFmt(o.pct.FP || 0)}</td>
        <td class="num">${pctFmt(o.pct.PRM || 0)}</td>
        <td class="num">${pctFmt(o.pct.PLD || 0)}</td>
        <td class="num">${pctFmt(o.pct.OTROS || 0)}</td>
      </tr>
    `).join("");

  tbl.innerHTML = buildTable(["Provincia","Municipio","Ganador","ALIANZA","PRM","PLD","OTROS"], body);
}

function renderLevelTables(){
  renderNationalTable();
  if(state.level==="pres") renderPresProv();
  if(state.level==="sen") renderSenProv();
  if(state.level==="dip") renderDipCirc();
  if(state.level==="alc") renderAlcMun();
  recolorMap();
  if(state.view==="home") renderExecutivePanel();
}


function goView(v){
  state.view=v;
  document.querySelectorAll(".view").forEach(el=>el.classList.remove("is-active"));
  document.getElementById(`view-${v}`).classList.add("is-active");

  document.querySelectorAll(".navbtn").forEach(b=>b.classList.remove("is-active"));
  document.querySelectorAll(`.navbtn[data-view="${v}"]`).forEach(b=>b.classList.add("is-active"));

  if(v==="pres") state.level="pres";
  if(v==="sen") state.level="sen";
  if(v==="dip") state.level="dip";
  if(v==="alc") state.level="alc";
  if(v==="home") { /* keep level */ }

  renderLevelTables();
  if(v==="home"){
    // executive panel uses current configuration
    renderExecutivePanel();
  }
  if(v==="dip"){
    const sel = document.getElementById("seatsMode");
    if(sel) sel.value = state.seatsMode || "190";
  }
}

function selectProvince(provCode){
  state.selectedProv = provCode;
  const prov = BASE.dim.provincias.find(p=>+p.prov_code===+provCode);
  document.getElementById("selectedProvName").textContent = prov ? prov.provincia : "—";
  document.getElementById("selectedProvCode").textContent = prov ? `Código: ${prov.prov_code}` : "—";
  const swing = state.fpSwingByProv[provCode] || 0;
  document.getElementById("fpSwing").value = swing;
  document.getElementById("fpSwingVal").textContent = String(swing);
  document.querySelectorAll("svg .prov").forEach(p=>p.classList.remove("is-selected"));
  const el = document.getElementById(`DO-${String(provCode).padStart(2,"0")}`);
  if(el) el.classList.add("is-selected");
}

function recolorMap(){
  // Color by winner for current level & current settings.
  const rows = getRows();
  const byProv = new Map();
  rows.forEach(r=>{
    if(r.prov_code==null) return;
    const pct = computeForRow(r);
    const win = winnerFromPctLevel(state.level, pct).winner;
    byProv.set(+r.prov_code, win);
  });

  byProv.forEach((win, pc)=>{
    const id = `DO-${String(pc).padStart(2,"0")}`;
    const el = document.getElementById(id);
    if(!el) return;
    let fill = "rgba(255,255,255,.08)";
        if(win==="FP") fill = "rgba(30,230,166,.55)";
    if(win==="PRM") fill = "rgba(0,163,255,.55)";
    if(win==="PLD") fill = "rgba(255,77,109,.55)";
    if(win==="OTROS") fill = "rgba(255,204,0,.55)";
    el.style.fill = fill;
    el.style.stroke = "rgba(255,255,255,.22)";
    el.style.strokeWidth = "1.2";
  });
}


function bindIETabs(){
  const tabs = Array.from(document.querySelectorAll(".ieTab"));
  if(!tabs.length) return;
  const setActive = (key)=>{
    tabs.forEach(t=>t.classList.toggle("isActive", t.dataset.ieTab===key));
  };
  tabs.forEach(t=>{
    t.addEventListener("click", ()=>{
      const key = t.dataset.ieTab;
      setActive(key);
      // Try to route to existing sections if present
      if(key==="b1"){
        const a = document.querySelector("[data-nav='map']");
        if(a) a.click();
      }else if(key==="b2"){
        const a = document.querySelector("[data-nav='municipal']");
        if(a) a.click();
      }else if(key==="b3"){
        const a = document.querySelector("[data-nav='abst']");
        if(a) a.click();
      }
    });
  });
}

function bindUI(){
  // Nav
  document.querySelectorAll(".navbtn[data-view]").forEach(btn=>{
    btn.addEventListener("click", ()=> goView(btn.getAttribute("data-view")));
  });
  document.querySelectorAll("[data-go]").forEach(btn=>{
    btn.addEventListener("click", ()=> goView(btn.getAttribute("data-go")));
  });
  document.getElementById("btnHome").addEventListener("click", ()=>goView("home"));

  // Controls
  const yearBase = document.getElementById("yearBase");
  yearBase.addEventListener("change", ()=>{
    state.year = +yearBase.value;
    renderLevelTables();
  });

  const scenario = document.getElementById("scenario");
  scenario.addEventListener("change", ()=>{
    state.scenario = scenario.value;
    // apply simple presets to swings and alliance transfer
    if(state.scenario==="optimista"){
      state.allianceTransfer = 90;
      document.getElementById("allianceTransfer").value = 90;
    }else if(state.scenario==="conservador"){
      state.allianceTransfer = 75;
      document.getElementById("allianceTransfer").value = 75;
    }else if(state.scenario==="moderado"){
      state.allianceTransfer = 85;
      document.getElementById("allianceTransfer").value = 85;
    }
    document.getElementById("allianceTransferVal").textContent = String(state.allianceTransfer);
    document.getElementById("cardTransfer").textContent = String(state.allianceTransfer);
    renderLevelTables();
  });

  const allianceType = document.getElementById("allianceType");
  allianceType.addEventListener("change", ()=>{
    state.allianceType = allianceType.value;
    renderLevelTables();
  });

  const allianceTransfer = document.getElementById("allianceTransfer");
  allianceTransfer.addEventListener("input", ()=>{
    state.allianceTransfer = +allianceTransfer.value;
    document.getElementById("allianceTransferVal").textContent = String(state.allianceTransfer);
    document.getElementById("cardTransfer").textContent = String(state.allianceTransfer);
    renderLevelTables();
  });

  const pollingEnabled = document.getElementById("pollingEnabled");
  pollingEnabled.addEventListener("change", ()=>{
    state.pollingEnabled = pollingEnabled.checked;
    renderLevelTables();
  });

  // Encuestas: candidato
  ["FP","PRM","PLD","OTROS"].forEach(k=>{
    const el = document.getElementById("pollCand"+k);
    if(!el) return;
    el.addEventListener("input", ()=>{
      state.pollsCand[k] = safeNum(el.value, 0);
      renderLevelTables();
    });
  });

  // Encuestas: partido
  ["FP","PRM","PLD","OTROS"].forEach(k=>{
    const el = document.getElementById("pollParty"+k);
    if(!el) return;
    el.addEventListener("input", ()=>{
      state.pollsParty[k] = safeNum(el.value, 0);
      renderLevelTables();
    });
  });

  // Peso candidato
  const pollWeightCand = document.getElementById('pollWeightCand');
  const lblCand = document.getElementById('pollWeightCandLabel');
  const lblParty = document.getElementById('pollWeightPartyLabel');
  if(pollWeightCand && lblCand && lblParty){
    const sync = ()=>{
      const v = safeNum(pollWeightCand.value, 80);
      state.pollWeightCand = clamp(v/100, 0.5, 0.95);
      lblCand.textContent = String(Math.round(state.pollWeightCand*100));
      lblParty.textContent = String(100 - Math.round(state.pollWeightCand*100));
    };
    pollWeightCand.addEventListener('input', ()=>{ sync(); renderLevelTables(); });
    sync();
  }

  // Escenarios (presidencial)
  initScenarioUI();

  
  const globalFpGrowth = document.getElementById("globalFpGrowth");
  if(globalFpGrowth){
    globalFpGrowth.addEventListener("input", ()=>{
      const v = +globalFpGrowth.value;
      document.getElementById("globalFpGrowthVal").textContent = String(v);
      state.globalFpGrowth = v;
      state.scenario = "custom";
      const sc = document.getElementById("scenario"); if(sc) sc.value = "custom";
      renderLevelTables();
    });
  }

const fpSwing = document.getElementById("fpSwing");
  fpSwing.addEventListener("input", ()=>{
    const v = +fpSwing.value;
    document.getElementById("fpSwingVal").textContent = String(v);
    if(state.selectedProv!=null){
      state.fpSwingByProv[state.selectedProv]=v;
      state.scenario="custom";
      document.getElementById("scenario").value="custom";
      renderLevelTables();
    }
  });

  document.getElementById("btnResetSwing").addEventListener("click", ()=>{
    state.fpSwingByProv = {};
    state.selectedProv = null;
    document.getElementById("selectedProvName").textContent = "—";
    document.getElementById("selectedProvCode").textContent = "—";
    document.getElementById("fpSwing").value = 0;
    document.getElementById("fpSwingVal").textContent = "0";
    const g=document.getElementById("globalFpGrowth"); if(g){ g.value=0; }
    const gv=document.getElementById("globalFpGrowthVal"); if(gv){ gv.textContent="0"; }
    state.globalFpGrowth = 0;
    document.querySelectorAll("svg .prov").forEach(p=>p.classList.remove("is-selected"));
    renderLevelTables();
  });

  // Export scenario
  document.getElementById("btnExport").addEventListener("click", exportScenario);


  // Seats mode (Diputados)
  const seatsModeSel = document.getElementById("seatsMode");
  const btnEditSeats = document.getElementById("btnEditSeats");
  const seatsHint = document.getElementById("seatsHint");
  if(seatsModeSel){
    seatsModeSel.value = state.seatsMode || "190";
    const refreshHint = ()=>{
      if(!seatsHint) return;
      if(state.seatsMode==="190") seatsHint.textContent = "Usa curules base (control 2024).";
      else if(state.seatsMode==="170") seatsHint.textContent = "Provisional 170: reducción proporcional desde la tabla 2024 (hasta publicación JCE).";
      else seatsHint.textContent = "Manual: tabla guardada localmente en este navegador.";
    };
    refreshHint();
    seatsModeSel.addEventListener("change", ()=>{
      state.seatsMode = seatsModeSel.value;
      saveSeatsPrefs();
      refreshHint();
      renderLevelTables();
    });
  }
  if(btnEditSeats){
    btnEditSeats.addEventListener("click", ()=>{
      // simple JSON editor prompt for manual seats map
      const current = (state.seatsMode==="manual" && state.manualSeats) ? state.manualSeats : getSeatsByMode();
      const text = JSON.stringify(current, null, 2);
      const edited = prompt("Pega aquí el mapa de escaños por circ (clave: 'prov-circ').\nEj: {"1-1": 5, "1-2": 6}\n\nAl aceptar, se guardará como MANUAL en este navegador.", text);
      if(edited===null) return;
      try{
        const obj = JSON.parse(edited);
        state.manualSeats = obj;
        state.seatsMode = "manual";
        if(seatsModeSel) seatsModeSel.value = "manual";
        saveSeatsPrefs();
        renderLevelTables();
      }catch(e){
        alert("JSON inválido. No se guardó.");
      }
    });
  }



  // Poll store (localStorage)
  refreshPollStoreUI();
  const pollSel = document.getElementById("pollStoreSelect");
  const btnLoadPoll = document.getElementById("btnLoadPoll");
  const btnSavePoll = document.getElementById("btnSavePoll");
  const btnDeletePoll = document.getElementById("btnDeletePoll");

  
  if(btnSavePoll){
    btnSavePoll.addEventListener("click", ()=>{
      const encuestadora = prompt("Encuestadora:");
      if(!encuestadora) return;
      const fecha = prompt("Fecha (YYYY-MM-DD):", (new Date()).toISOString().slice(0,10));
      if(!fecha) return;
      const candidato = prompt("Candidato:");
      if(!candidato) return;
      const partido = prompt("Partido (FP / PRM / PLD):", "FP");
      if(!partido) return;
      const margen = prompt("Margen de error (ej: 2.5):", "2.5");
      if(margen===null) return;

      const item = {
        encuestadora,
        fecha,
        candidato,
        partido,
        margen_error: parseFloat(margen)||null,
        // Config que alimenta el simulador (usa lo que tienes cargado en el panel de encuestas)
        year: state.year,
        pollingEnabled: true,
        pollCand: state.pollCand,
        pollParty: state.pollParty,
        pollWeights: state.pollWeights
      };

      const items = loadPollStore();
      items.unshift(item);
      savePollStore(items);
      refreshPollStoreUI();
      alert("Encuesta guardada (LOCAL). Para que el equipo la vea, súbela a data/encuestas.json en GitHub.");
    });
  }


  
  if(btnLoadPoll){
    btnLoadPoll.addEventListener("click", ()=>{
      if(!pollSel || !pollSel.value) return alert("Selecciona una encuesta.");
      const merged = state._pollMerged || [];
      const it = merged[parseInt(pollSel.value,10)];
      if(!it) return;

      state.year = it.year || state.year;
      state.pollingEnabled = true;
      state.pollCand = it.pollCand || state.pollCand;
      state.pollParty = it.pollParty || state.pollParty;
      // sync encuesta simple UI
      const p = state.pollParty || {};
      const setVal = (id,val)=>{ const el=document.getElementById(id); if(el && val!=null) el.value = val; };
      setVal("pollFP", p.FP!=null? p.FP : "");
      setVal("pollPRM", p.PRM!=null? p.PRM : "");
      setVal("pollPLD", p.PLD!=null? p.PLD : "");
      setVal("pollOTROS", p.OTROS!=null? p.OTROS : "");
      const setTxt=(id,val)=>{ const el=document.getElementById(id); if(el && val!=null) el.value = val; };
      setTxt("pollCandidato", it.candidato || "");
      const elPart=document.getElementById("pollPartido"); if(elPart && it.partido) elPart.value = it.partido;
      const elMOE=document.getElementById("pollMOE"); if(elMOE && it.margen_error!=null) elMOE.value = it.margen_error;
      const elF=document.getElementById("pollFecha"); if(elF && it.fecha) elF.value = it.fecha;
      setTxt("pollEncuestadora", it.encuestadora || "");

      state.pollWeights = it.pollWeights || state.pollWeights;

      const chk = document.getElementById("pollingEnabled");
      if(chk) chk.checked = true;

      renderLevelTables();
      goView("home");
      alert(`Encuesta cargada: ${it.encuestadora} · ${it.fecha}`);
    });
  }


  
  if(btnDeletePoll){
    btnDeletePoll.addEventListener("click", ()=>{
      if(!pollSel || !pollSel.value) return alert("Selecciona una encuesta.");
      const merged = state._pollMerged || [];
      const it = merged[parseInt(pollSel.value,10)];
      if(!it) return;
      if(it.__src==="TEAM") return alert("Esta encuesta viene del archivo del equipo (data/encuestas.json). Bórrala desde GitHub.");
      const items = loadPollStore();
      const idx = items.findIndex(x => (x.encuestadora===it.encuestadora && x.fecha===it.fecha && x.candidato===it.candidato));
      if(idx<0) return alert("No se encontró en el store local.");
      if(!confirm(`Borrar (LOCAL) "${it.encuestadora} · ${it.fecha}"?`)) return;
      items.splice(idx,1);
      savePollStore(items);
      refreshPollStoreUI();
    });
  }



  // Ranking + comparación
  const rankSel = document.getElementById("rankMode");
  const pivotTh = document.getElementById("pivotThreshold");
  const btnExpRank = document.getElementById("btnExportRanking");
  const btnCmp = document.getElementById("btnCompareAlliance");
  if(rankSel) rankSel.addEventListener("change", ()=>{ renderRanking(); });
  if(pivotTh) pivotTh.addEventListener("change", ()=>{ renderRanking(); });
  if(btnExpRank) btnExpRank.addEventListener("click", ()=>{ exportRankingCSV(); });
  if(btnCmp) btnCmp.addEventListener("click", ()=>{ compareAlliance(); });


  // Encuesta simple (4 números)
  const btnApplySimple = document.getElementById("btnAplicarEncuestaSimple");
  const btnSaveTeam = document.getElementById("btnGuardarEncuestaEquipo");
  if(btnApplySimple) btnApplySimple.addEventListener("click", ()=>{ applySimplePollFromUI(); });
  if(btnSaveTeam) btnSaveTeam.addEventListener("click", ()=>{ saveTeamPollFromUI(); });


  // Encuestas de equipo: aplicar más reciente / comparar
  const btnLatest = document.getElementById("btnAplicarMasReciente");
  const btnCmpPolls = document.getElementById("btnCompararEncuestas");
  if(btnLatest) btnLatest.addEventListener("click", ()=>{ applyLatestTeamPoll(); });
  if(btnCmpPolls) btnCmpPolls.addEventListener("click", ()=>{ compareTwoTeamPolls(); });

}

function exportScenario(){
  const payload = {
    meta:{
      exportedAt: new Date().toISOString(),
      level: state.level,
      year: state.year,
      scenario: state.scenario,
    },
    config:{
      allianceType: state.allianceType,
      allianceTransfer: state.allianceTransfer,
      pollingEnabled: state.pollingEnabled,
      pollsCand: state.pollsCand,
      pollsParty: state.pollsParty,
      pollWeightCand: state.pollWeightCand,

      fpSwingByProv: state.fpSwingByProv,
      seatsMode: state.seatsMode,
      manualSeats: state.manualSeats,
      effectiveSeatsByCirc: getSeatsByMode()

    },
    national: state.level==="pres" ? computeNationalPresVotes() : computeNational()
  };
  const blob = new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=`escenario_${state.level}_${state.year}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();}, 250);
}

// ----------------------
// Escenarios (presidencial) - guardado local
// ----------------------

function getStoredPresScenarios(){
  try{
    const raw = STORE ? STORE.getItem : (k=>null)(STORAGE_KEYS.presScenarios);
    if(!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  }catch(e){
    return [];
  }
}

function setStoredPresScenarios(arr){
  STORE ? STORE.setItem : ((k,v)=>{})(STORAGE_KEYS.presScenarios, JSON.stringify(arr||[]));
}

function snapshotPresConfig(){
  return {
    year: state.year,
    scenario: state.scenario,
    allianceType: state.allianceType,
    allianceTransfer: state.allianceTransfer,
    pollingEnabled: state.pollingEnabled,
    pollsCand: {...state.pollsCand},
    pollsParty: {...state.pollsParty},
    pollWeightCand: state.pollWeightCand,
    fpSwingByProv: {...state.fpSwingByProv},
  };
}

function applyPresConfig(cfg){
  if(!cfg) return;
  state.level = 'pres';
  state.year = cfg.year ?? state.year;
  state.scenario = cfg.scenario ?? state.scenario;
  state.allianceType = cfg.allianceType ?? state.allianceType;
  state.allianceTransfer = cfg.allianceTransfer ?? state.allianceTransfer;
  state.pollingEnabled = !!cfg.pollingEnabled;
  state.pollsCand = cfg.pollsCand ? {...cfg.pollsCand} : {...state.pollsCand};
  state.pollsParty = cfg.pollsParty ? {...cfg.pollsParty} : {...state.pollsParty};
  state.pollWeightCand = clamp(cfg.pollWeightCand ?? state.pollWeightCand, 0.5, 0.95);
  state.fpSwingByProv = cfg.fpSwingByProv ? {...cfg.fpSwingByProv} : {...state.fpSwingByProv};

  // Sync UI (if present)
  const setVal = (id, val)=>{ const el=document.getElementById(id); if(el) el.value=val; };
  const setChk = (id, val)=>{ const el=document.getElementById(id); if(el) el.checked=!!val; };

  setVal('yearSelect', String(state.year));
  setVal('scenarioSelect', String(state.scenario));
  setVal('allianceType', String(state.allianceType));
  setVal('allianceTransfer', String(state.allianceTransfer));
  setChk('pollingEnabled', state.pollingEnabled);
  ['FP','PRM','PLD','OTROS'].forEach(k=>{
    setVal('pollCand'+k, safeNum(state.pollsCand[k]));
    setVal('pollParty'+k, safeNum(state.pollsParty[k]));
  });
  const wEl=document.getElementById('pollWeightCand');
  if(wEl){ wEl.value = String(Math.round(state.pollWeightCand*100)); }
  const lblCand=document.getElementById('pollWeightCandLabel');
  const lblParty=document.getElementById('pollWeightPartyLabel');
  if(lblCand && lblParty){
    lblCand.textContent = String(Math.round(state.pollWeightCand*100));
    lblParty.textContent = String(100 - Math.round(state.pollWeightCand*100));
  }

  renderLevelTables();
}

function initScenarioUI(){
  const sel = document.getElementById('scenarioSelect');
  const name = document.getElementById('scenarioName');
  const btnSave = document.getElementById('btnSaveScenario');
  const btnLoad = document.getElementById('btnLoadScenario');
  const btnExp = document.getElementById('btnExportScenario');
  const btnDel = document.getElementById('btnDeleteScenario');
  if(!sel || !name || !btnSave || !btnLoad || !btnExp || !btnDel) return;

  const refresh = ()=>{
    const arr = getStoredPresScenarios();
    sel.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = '— seleccionar —';
    sel.appendChild(opt0);
    arr.forEach((s, idx)=>{
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = `${s.name} · ${new Date(s.savedAt).toLocaleString()}`;
      sel.appendChild(opt);
    });
  };
  refresh();

  btnSave.addEventListener('click', ()=>{
    const nm = (name.value||'').trim() || 'Escenario presidencial';
    const arr = getStoredPresScenarios();
    arr.unshift({
      name: nm,
      savedAt: new Date().toISOString(),
      config: snapshotPresConfig(),
    });
    setStoredPresScenarios(arr.slice(0,50));
    refresh();
    sel.value = '0';
  });

  btnLoad.addEventListener('click', ()=>{
    const idx = Number(sel.value);
    const arr = getStoredPresScenarios();
    if(!Number.isFinite(idx) || idx<0 || idx>=arr.length) return;
    applyPresConfig(arr[idx].config);
  });

  btnDel.addEventListener('click', ()=>{
    const idx = Number(sel.value);
    const arr = getStoredPresScenarios();
    if(!Number.isFinite(idx) || idx<0 || idx>=arr.length) return;
    arr.splice(idx,1);
    setStoredPresScenarios(arr);
    refresh();
  });

  btnExp.addEventListener('click', ()=>{
    const idx = Number(sel.value);
    const arr = getStoredPresScenarios();
    if(!Number.isFinite(idx) || idx<0 || idx>=arr.length) return;
    const payload = {
      meta: { exportedAt: new Date().toISOString(), type: 'presidencial_saved_scenario' },
      ...arr[idx]
    };
    const blob = new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download = `pres_escenario_${idx+1}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();}, 250);
  });
}

async function mountMap(){
  const host = document.getElementById("mapHost");
  const res = await fetch("assets/dominican-republic.svg");
  const svgText = await res.text();
  host.innerHTML = svgText;

  // Add class to provinces
  const svg = host.querySelector("svg");
  if(svg){
    // Any element with id DO-XX is a province.
    host.querySelectorAll('[id^="DO-"]').forEach(el=>{
      el.classList.add("prov");
      el.addEventListener("click", ()=>{
        const id = el.getAttribute("id");
    const isoNameMap = {"DO-01": "DISTRITO NACIONAL", "DO-02": "AZUA", "DO-03": "BAORUCO", "DO-04": "BARAHONA", "DO-05": "DAJABON", "DO-06": "DUARTE", "DO-07": "ELIAS PINA", "DO-08": "EL SEIBO", "DO-09": "ESPAILLAT", "DO-10": "INDEPENDENCIA", "DO-11": "LA ALTAGRACIA", "DO-12": "LA ROMANA", "DO-13": "LA VEGA", "DO-14": "MARIA TRINIDAD SANCHEZ", "DO-15-Monte": "MONTE CRISTI", "DO-15": "MONTE CRISTI", "DO-16": "PEDERNALES", "DO-17": "PERAVIA", "DO-18": "PUERTO PLATA", "DO-19": "HERMANAS MIRABAL", "DO-20": "SAMANA", "DO-21": "SAN CRISTOBAL", "DO-22": "SAN JUAN", "DO-23": "SAN PEDRO DE MACORIS", "DO-24": "SANCHEZ RAMIREZ", "DO-25": "SANTIAGO", "DO-26": "SANTIAGO RODRIGUEZ", "DO-27": "VALVERDE", "DO-28": "MONSENOR NOUEL", "DO-29": "MONTE PLATA", "DO-30": "HATO MAYOR", "DO-31": "SAN JOSE DE OCOA", "DO-32": "SANTO DOMINGO"};
    const provName = isoNameMap[id] || null;
    if(!provName) return;
    const norm=(s)=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().trim();
    const provObj = BASE.dim.provincias.find(p=>norm(p.provincia)===norm(provName));
    if(!provObj) return;
    selectProvince(provObj.prov_code);
      });
    });
  }
}

(async function init(){
  await loadBase();
  loadSeatsPrefs();
  state.teamPolls = await loadTeamPolls();
  await mountMap();
  bindUI();
  bindIETabs();
  // default view
  goView("home");
})();