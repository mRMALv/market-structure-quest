(function(){
"use strict";
const $=id=>document.getElementById(id);
let auth=null,dashboard=null;
function showError(message){$("loginError").textContent=message;}
function call(name,payload){return window.MSQ.call(name,payload||{});}
function duration(ms){const s=Math.max(0,Math.floor((ms||0)/1000));return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");}
function date(ms){if(!ms)return "—";return new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(ms));}
function escapeHtml(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function parseCsv(text){
  const rows=[];let row=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(ch===","&&!quoted){row.push(cell.trim());cell="";}else if((ch==="\n"||ch==="\r")&&!quoted){if(ch==="\r"&&text[i+1]==="\n")i++;row.push(cell.trim());if(row.some(v=>v))rows.push(row);row=[];cell="";}else cell+=ch;}
  row.push(cell.trim());if(row.some(v=>v))rows.push(row);if(rows.length<2)throw new Error("CSV 至少需要標題列及一位學生。");
  const headers=rows.shift().map(h=>h.replace(/^\uFEFF/,"").trim().toLowerCase());
  const ix={group:headers.indexOf("group"),className:headers.indexOf("classname"),realName:headers.indexOf("realname")};
  if(ix.group<0||ix.className<0||ix.realName<0)throw new Error("CSV 標題必須是 group,className,realName。");
  return rows.map(r=>({group:normaliseGroup(r[ix.group]),className:(r[ix.className]||"").trim().toUpperCase(),realName:(r[ix.realName]||"").trim()})).filter(r=>r.realName);
}
function normaliseGroup(value){const v=String(value||"").trim().toLowerCase();if(["zh","chinese","中文","中文班經濟","中文班"].includes(v))return "zh";if(["en","english","英文","英文班經濟","英文班"].includes(v))return "en";return v;}
async function login(){try{showError("");await auth.signInWithEmailAndPassword($("email").value.trim(),$("password").value);await refresh();}catch(e){showError(e.message);}}
async function refresh(){
  try{dashboard=await call("adminGetDashboard",{});$("loginPanel").hidden=true;$("dashboardPanel").hidden=false;render();}
  catch(e){$("dashboardPanel").hidden=true;$("loginPanel").hidden=false;showError("沒有教師管理權限或讀取失敗："+e.message);}
}
function render(){
  const students=dashboard.students||[],attempts=dashboard.attempts||[];
  $("studentCount").textContent=students.length;$("attemptCount").textContent=attempts.length;
  const active=(dashboard.sessions||[]).find(s=>s.id===dashboard.activeSessionId);
  $("activeSessionText").textContent="目前場次："+(active?active.title:"尚未建立");
  $("studentsBody").innerHTML=students.sort((a,b)=>a.className.localeCompare(b.className)||a.realName.localeCompare(b.realName,"zh-Hant")).map(s=>"<tr><td>"+escapeHtml(s.className)+"</td><td>"+escapeHtml(s.realName)+"</td><td>"+escapeHtml(s.nickname||"學生尚未選擇")+"</td></tr>").join("")||'<tr><td colspan="3">尚未新增學生名單</td></tr>';
  $("attemptsBody").innerHTML=attempts.map(a=>{const r=a.stageResults||{};const total=a.status==="completed"?(a.totalScore||0):"—";return "<tr><td>"+escapeHtml(a.realName)+"</td><td>"+escapeHtml(a.className)+"</td><td>"+escapeHtml(a.nickname)+"</td><td>"+(a.status==="completed"?"完成":"進行中")+"</td><td>"+total+"</td><td>"+(r.stage1?r.stage1.score+"/30":"—")+"</td><td>"+duration(r.stage1&&r.stage1.durationMs)+"</td><td>"+(r.stage2A?r.stage2A.score+"/16":"—")+"</td><td>"+duration(r.stage2A&&r.stage2A.durationMs)+"</td><td>"+(r.stage2B?r.stage2B.score+"/30":"—")+"</td><td>"+duration(r.stage2B&&r.stage2B.durationMs)+"</td><td>"+(r.stage3?r.stage3.score+"/24":"—")+"</td><td>"+duration(r.stage3&&r.stage3.durationMs)+"</td><td>"+duration(a.totalDurationMs||0)+"</td><td>"+duration(a.overtimeMs||0)+"</td><td>"+date(a.completedAtMs)+"</td></tr>";}).join("")||'<tr><td colspan="16">尚未有挑戰紀錄</td></tr>';
}
async function addStudent(){
  const className=$("studentClassInput").value.trim().toUpperCase();
  const realName=$("studentRealNameInput").value.trim();
  if(!className||!realName){$("importStatus").textContent="請輸入學生班級及真實姓名。";return;}
  try{
    const result=await call("adminAddStudent",{className:className,realName:realName});
    $("importStatus").textContent="已新增："+result.className+" · "+result.realName+"。學生花名由學生自行設定。";
    $("studentClassInput").value="";
    $("studentRealNameInput").value="";
    await refresh();
  }catch(e){$("importStatus").textContent="新增失敗："+e.message;}
}

async function importRoster(){
  const file=$("rosterFile").files[0];if(!file){$("importStatus").textContent="請先選擇 CSV 檔案。";return;}
  try{const rows=parseCsv(await file.text());if(rows.length>100)throw new Error("一次最多匯入 100 位學生。");const result=await call("adminImportRoster",{students:rows});$("importStatus").textContent="成功匯入 "+result.imported+" 位學生。";await refresh();}
  catch(e){$("importStatus").textContent="匯入失敗："+e.message;}
}
async function createSession(){
  const title=$("sessionTitle").value.trim();if(!title){$("sessionStatus").textContent="請輸入場次名稱。";return;}
  if(!confirm("建立新場次後，學生的排行榜將從空白開始。舊場次成績會保留。確定繼續？"))return;
  try{const r=await call("adminCreateSession",{title});$("sessionStatus").textContent="已建立新場次："+r.title;await refresh();}
  catch(e){$("sessionStatus").textContent="建立失敗："+e.message;}
}
function exportCsv(){
  const rows=dashboard&&dashboard.attempts||[];
  const header=["realName","group","className","nickname","status","totalScore","stage1","stage1DurationMs","stage2A","stage2ADurationMs","stage2B","stage2BDurationMs","stage3","stage3DurationMs","maxCombo","totalDurationMs","overtimeMs","startedAtMs","completedAtMs"];
  const lines=[header.join(",")].concat(rows.map(a=>{const r=a.stageResults||{};const vals=[a.realName,a.group,a.className,a.nickname,a.status,a.totalScore||"",r.stage1&&r.stage1.score||"",r.stage1&&r.stage1.durationMs||"",r.stage2A&&r.stage2A.score||"",r.stage2A&&r.stage2A.durationMs||"",r.stage2B&&r.stage2B.score||"",r.stage2B&&r.stage2B.durationMs||"",r.stage3&&r.stage3.score||"",r.stage3&&r.stage3.durationMs||"",a.maxCombo||0,a.totalDurationMs||"",a.overtimeMs||0,a.startedAtMs||"",a.completedAtMs||""];return vals.map(v=>'"'+String(v==null?"":v).replace(/"/g,'""')+'"').join(",");}));
  const blob=new Blob(["\uFEFF"+lines.join("\r\n")],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="market-structure-attempts.csv";a.click();URL.revokeObjectURL(url);
}
document.addEventListener("DOMContentLoaded",function(){
  if(!window.FIREBASE_CONFIG){showError("尚未設定 Firebase。請先建立 public/firebase-config.js。");$("loginButton").disabled=true;return;}
  window.MSQ.init(window.FIREBASE_CONFIG).then(()=>{
    auth=window.MSQ.auth();
    $("loginButton").onclick=login;$("logoutButton").onclick=()=>auth.signOut().then(()=>{$("dashboardPanel").hidden=true;$("loginPanel").hidden=false;});
    $("addStudentButton").onclick=addStudent;$("newSessionButton").onclick=createSession;$("refreshButton").onclick=refresh;$("exportButton").onclick=exportCsv;
    auth.onAuthStateChanged(user=>{if(user&&!user.isAnonymous)refresh();else{$("dashboardPanel").hidden=true;$("loginPanel").hidden=false;}});
  }).catch(e=>{showError("Firebase 初始化失敗："+e.message);$("loginButton").disabled=true;});
});
})();