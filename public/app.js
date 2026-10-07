
const socket=io(),$=s=>document.querySelector(s);
const roles={
"市民陣営":[["市民","特別な能力なし。"],["占い師","夜に1人を占い、人狼かどうか確認。妖狐を占うと死亡。"],["狩人","夜に1人を護衛。同じ人を連続護衛できない。"],["騎士団","騎士団全体で1人を護衛。連続護衛可能。"],["霊媒師","処刑されたプレイヤーと、夜の行動で死亡したプレイヤーの陣営を知る。"],["罠師","夜に1人へ罠。襲撃されると人狼を倒す。"],["双子","2人がお互いを知る。片方が死亡するともう片方も死亡。"],["独裁者","特殊な投票権を持つ役職。"],["カウンセラー","夜に裏切者を選ぶと市民に戻す。"],["タフガイ","人狼の襲撃を1回耐える。"]],
"人狼陣営":[["人狼","夜に仲間と協力して1人を襲撃。"],["狂人","人狼陣営だが人狼ではない。"],["裏切者","人狼陣営。カウンセラーに選ばれると市民になる。"],["内通者","人狼を支援し情報を共有する。"]],
"第三陣営":[["アンドロイド","指定されたプレイヤーに連動する特殊役職。"],["妖狐","人狼の襲撃では死亡せず、占われると死亡。"],["恋人","2人がお互いを知る。片方が死亡するともう片方も死亡。"],["神様","全員の役職を見ることができる。"]]
};
const roleNames=Object.values(roles).flat().map(x=>x[0]);
const roleDesc=Object.fromEntries(Object.values(roles).flat());
const roleTeam={};for(const [g,list] of Object.entries(roles))for(const [r] of list)roleTeam[r]=g;
let currentRoom=null,amHost=false;

function showMessage(t){$("#message").textContent=t}
function roomMessage(t){$("#roomMessage").textContent=t}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

for(const [group,list] of Object.entries(roles)){
 const sec=document.createElement("div");sec.className="roleGroup";sec.innerHTML=`<h3>${group}</h3>`;
 list.forEach(([name,desc])=>{const e=document.createElement("div");e.className="role";e.innerHTML=`<strong>${name}</strong><p>${desc}</p>`;sec.appendChild(e)});
 $("#roleList").appendChild(sec);
}
$("#rolesBtn").onclick=()=>$("#roleModal").classList.remove("hidden");
$("#closeRoles").onclick=()=>$("#roleModal").classList.add("hidden");
$("#roleModal").onclick=e=>{if(e.target.id==="roleModal")$("#roleModal").classList.add("hidden")};

$("#createBtn").onclick=()=>{const name=$("#name").value.trim();if(!name)return showMessage("名前を入力してください。");socket.emit("createRoom",{name})};
$("#joinBtn").onclick=()=>{const name=$("#name").value.trim(),roomId=$("#roomId").value.trim();if(!name||!roomId)return showMessage("名前とルームIDを入力してください。");socket.emit("joinRoom",{name,roomId})};
$("#readyBtn").onclick=()=>socket.emit("toggleReady");
$("#copyBtn").onclick=async()=>{try{await navigator.clipboard.writeText(`${location.origin}/?room=${currentRoom}`);roomMessage("参加URLをコピーしました！")}catch{roomMessage("URLをコピーできませんでした。")}};

function enterRoom(id){currentRoom=id;$("#home").classList.add("hidden");$("#room").classList.remove("hidden");$("#roomCode").textContent=id;$("#shareUrl").textContent=`${location.origin}/?room=${id}`}

socket.on("roomCreated",({roomId})=>enterRoom(roomId));
socket.on("joinedRoom",({roomId})=>enterRoom(roomId));
socket.on("errorMessage",t=>{showMessage(t);roomMessage(t)});

function buildRoleConfig(room){
 const box=$("#roleConfig");box.innerHTML="";
 for(const [group,list] of Object.entries(roles)){
  const g=document.createElement("div");g.className="configGroup";g.innerHTML=`<h3>${group}</h3>`;
  for(const [name,desc] of list){
   const row=document.createElement("label");row.className="roleConfigRow";
   const old=room.roleConfig?.[name]??0;
   row.innerHTML=`<span><strong>${name}</strong><small>${desc}</small></span><input class="roleCount" data-role="${esc(name)}" type="number" min="0" max="20" value="${old}">`;
   g.appendChild(row);
  }
  box.appendChild(g);
 }
}
function totalConfig(){return [...document.querySelectorAll(".roleCount")].reduce((n,e)=>n+Number(e.value||0),0)}
function saveConfig(){
 const cfg={};document.querySelectorAll(".roleCount").forEach(e=>cfg[e.dataset.role]=Number(e.value||0));
 socket.emit("setRoleConfig",cfg);
 roomMessage(`役職設定を保存しました。合計 ${totalConfig()}人`);
}
$("#saveRoles").onclick=saveConfig;
document.addEventListener("input",e=>{
 if(e.target.classList.contains("roleCount")) $("#roleTotal").textContent=`合計 ${totalConfig()}人`;
});

socket.on("roomState",room=>{
 currentRoom=room.id;amHost=room.hostId===socket.id;
 if(room.phase==="waiting"){
   $("#game").classList.add("hidden");
   $("#home").classList.add("hidden");
   $("#room").classList.remove("hidden");
   $("#roomCode").textContent=room.id;
   $("#shareUrl").textContent=`${location.origin}/?room=${room.id}`;
 }
 $("#count").textContent=room.players.length;
 $("#playerList").innerHTML=room.players.map(p=>`<li><span>${esc(p.name)} ${p.id===room.hostId?"👑":""}</span><span>${p.ready?"準備OK":"待機中"}</span></li>`).join("");
 $("#startBtn").classList.toggle("hidden",!amHost||room.phase!=="waiting");
 $("#roleSetup").classList.toggle("hidden",!amHost||room.phase!=="waiting");
 if(amHost&&room.phase==="waiting")buildRoleConfig(room);
});

$("#startBtn").onclick=()=>socket.emit("startGame");
socket.on("gameStarted",()=>{$("#room").classList.add("hidden");$("#game").classList.remove("hidden")});

socket.on("gameState",g=>{
 const title={androidChoice:"役職選択",night:"夜",morning:"朝",meeting:"会議",voting:"投票",ended:"ゲーム終了"}[g.phase]||"待機";
 $("#phaseTitle").textContent=title;$("#dayNo").textContent=`${g.day||1}日目`;
 $("#myRole").textContent=g.me.role||"---";$("#myTeam").textContent=g.me.team||"";
 $("#roleDesc").textContent=roleDesc[g.me.role]||"";$("#gameMessage").textContent=g.message||"";

 $("#morningResult").classList.toggle("hidden",g.phase!=="morning");
 if(g.phase==="morning"){
   $("#deathLog").innerHTML=(g.morningLog||[]).length
     ?g.morningLog.map(x=>`<li>${esc(x)}</li>`).join("")
     :"<li>今朝、死亡したプレイヤーはいません。</li>";
   $("#defenseLog").textContent=g.defenseLog||"今夜の襲撃結果はありません。";
 }
 $("#meetingPanel").classList.toggle("hidden",g.phase!=="meeting");
 $("#votingPanel").classList.toggle("hidden",g.phase!=="voting");
 $("#meetingStartBtn").classList.toggle("hidden",!(g.phase==="morning"&&amHost));
 $("#voteStartBtn").classList.toggle("hidden",!(g.phase==="meeting"&&amHost));

 const targets=$("#targets");targets.innerHTML="";
 renderGMStatus(g);
 if(g.wolves){$("#privateNotice").textContent="人狼仲間："+g.wolves.map(x=>x.name).join("、");$("#privateNotice").classList.remove("hidden");}
 if(g.phase==="androidChoice" && g.me.isAndroidChoice){
   targets.innerHTML='<div class="waitingBox"><strong>コピーするプレイヤーを選択</strong><p>選んだ相手の役職になります。相手との情報共有はありません。</p></div>';
   g.players.filter(p=>p.alive&&p.id!==g.me.id).forEach(p=>targetButton(targets,p,"この人をコピー",()=>socket.emit("chooseAndroidTarget",{targetId:p.id})));
   return;
 }
 if(g.phase==="androidChoice") {targets.innerHTML='<div class="waitingBox"><strong>アンドロイドの選択待ち</strong><p>アンドロイドがコピー先を選んでいます。</p></div>';return;}
 if(!g.me.alive){targets.innerHTML="<p>あなたは死亡しています。ゲームの進行を見守ってください。</p>";return;}

 if(g.phase==="night"){
   const active=["占い師","狩人","騎士団","罠師","カウンセラー","人狼","内通者"];
   if(active.includes(g.me.role)){
     if(g.submitted)targets.innerHTML='<div class="waitingBox"><strong>行動を受け付けました</strong><p>ほかのプレイヤーの夜の行動を待っています……</p></div>';
     else {
       let list=g.players.filter(p=>p.alive&&p.id!==g.me.id);
       if(g.me.role==="人狼"){
         const allyIds=new Set((g.wolves||[]).map(x=>x.id));
         list=list.filter(p=>!allyIds.has(p.id));
       }
       list.forEach(p=>targetButton(targets,p,"選択",()=>socket.emit("nightAction",{targetId:p.id})));
     }
   }else targets.innerHTML='<div class="waitingBox"><strong>夜の待機時間</strong><p>あなたの役職には夜の選択行動がありません。全員の行動を待っています……</p></div>';
 }else if(g.phase==="meeting"){
   targets.innerHTML='<div class="meetingTalk"><strong>会議中</strong><p>生存者で話し合い、怪しい人を決めてください。</p></div>'
   if(g.me.role==="独裁者"&&!g.me.dictatorUsed&&!g.me.isAndroid){
     const box=document.createElement("div");box.className="dictatorBox";box.innerHTML='<strong>独裁者</strong><p>会議中に1度だけ、選んだプレイヤーを強制的に追放できます。</p>';
     g.players.filter(p=>p.alive&&p.id!==g.me.id).forEach(p=>targetButton(box,p,"強制追放",()=>{if(confirm(`${p.name}さんを強制追放しますか？`))socket.emit("dictatorExecute",{targetId:p.id})}));
     targets.appendChild(box);
   }
 }else if(g.phase==="voting"){
   if(g.voted)targets.innerHTML='<div class="waitingBox"><strong>投票しました</strong><p>ほかのプレイヤーの投票を待っています……</p></div>';
   else g.players.filter(p=>p.alive&&p.id!==g.me.id).forEach(p=>targetButton(targets,p,"投票",()=>socket.emit("vote",{targetId:p.id})));
 }else if(g.phase==="ended"){
   targets.innerHTML='<div class="meetingTalk"><strong>ゲーム終了</strong><p>勝利陣営の結果を確認してください。</p></div>';
   if(amHost){
     const b=document.createElement("button");
     b.className="primary";
     b.textContent="同じメンバーで再戦";
     b.onclick=()=>socket.emit("returnToRoom");
     targets.appendChild(b);
   }
 }
 if(g.roles){$("#godRoles").classList.remove("hidden");$("#godRoleList").innerHTML=g.roles.map(p=>`<li><span>${esc(p.name)}</span><span>${esc(p.role)}</span></li>`).join("")}
});
$("#meetingStartBtn").onclick=()=>socket.emit("startMeeting");
$("#voteStartBtn").onclick=()=>socket.emit("startVoting");
function renderGMStatus(g){
 const id="gmStatusPanel";
 let panel=document.getElementById(id);
 if(!amHost||!g.gmStatus||(g.phase!=="night"&&g.phase!=="voting")){if(panel)panel.remove();return;}
 if(!panel){panel=document.createElement("div");panel.id=id;panel.className="resultPanel";$("#targets").before(panel);}
 if(g.phase==="night"){
   const waiting=g.gmStatus.nightActors.filter(x=>x.acted==="×");
   panel.innerHTML=`<div class="resultTitle">GM用・夜の行動状況</div><div>${waiting.length?`未行動：${waiting.map(x=>esc(x.name)).join("、")}`:"全員の必要な行動が完了しました"}</div><ul class="logList">${g.gmStatus.nightActors.map(x=>`<li><span>${esc(x.name)}</span>：${x.acted}</li>`).join("")}</ul>`;
 }else{
   const waiting=g.gmStatus.voting.filter(x=>x.acted==="×");
   panel.innerHTML=`<div class="resultTitle">GM用・投票状況</div><div>${waiting.length?`未投票：${waiting.map(x=>esc(x.name)).join("、")}`:"全員投票済み"}</div><ul class="logList">${g.gmStatus.voting.map(x=>`<li><span>${esc(x.name)}</span>：${x.acted}</li>`).join("")}</ul>`;
 }
}

function targetButton(parent,p,label,fn){const b=document.createElement("button");b.className="target";b.innerHTML=`<strong>${esc(p.name)}</strong><span>${label}</span>`;b.onclick=fn;parent.appendChild(b)}
socket.on("privateNotice",t=>{$("#privateNotice").textContent=t;$("#privateNotice").classList.remove("hidden")});

const params=new URLSearchParams(location.search);if(params.get("room"))$("#roomId").value=params.get("room").toUpperCase();
