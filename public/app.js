const socket = io();
const $ = s => document.querySelector(s);

const roles = {
  "市民陣営":[
    ["市民","特別な能力を持たない。"],["占い師","夜に1人を占い、人狼かどうかを知る。妖狐を占うと妖狐は死亡。"],
    ["狩人","夜に1人を護衛。同じ人を連続では護衛できない。"],["骑士団","夜に1人を護衛。連続して同じ人も護衛できる。"],
    ["霊媒師","処刑されたプレイヤーの陣営を知る。"],["罠師","夜に1人へ罠を仕掛け、襲撃した人狼を倒す。"],
    ["双子","双子同士がお互いを知る。片方が死亡するともう片方も死亡。"],["独裁者","特殊な投票権を持つ役職。"],
    ["カウンセラー","夜に裏切者を選ぶと市民へ戻す。"],["タフガイ","人狼の襲撃を1回だけ耐える。"]
  ],
  "人狼陣営":[["人狼","夜に人狼同士で相談して1人を襲撃。"],["狂人","人狼を支援するが、自分自身は人狼ではない。"],["裏切者","人狼陣営。カウンセラーに選ばれると市民になる。"],["内通者","人狼を支援し、人狼と情報を共有する。"]],
  "第三陣営":[["アンドロイド","指定したプレイヤーの役職を受け継ぐ特殊役職。"],["妖狐","人狼の襲撃では死亡せず、占われると死亡。"],["恋人","片方が死亡するともう片方も死亡。"],["神様","全員の役職を見ることができる。"]
  ]
};

const descriptions = Object.fromEntries(Object.values(roles).flat());
const teams = {
  市民:"市民陣営",占い師:"市民陣営",狩人:"市民陣営",騎士団:"市民陣営",霊媒師:"市民陣営",罠師:"市民陣営",双子:"市民陣営",独裁者:"市民陣営",カウンセラー:"市民陣営",タフガイ:"市民陣営",
  人狼:"人狼陣営",狂人:"人狼陣営",裏切者:"人狼陣営",内通者:"人狼陣営",
  アンドロイド:"第三陣営",妖狐:"第三陣営",恋人:"第三陣営",神様:"第三陣営"
};

let currentRoom = null, amHost = false, latestGame = null;

function showMessage(t){ $("#message").textContent=t; }
function roomMessage(t){ $("#roomMessage").textContent=t; }

for(const [group,list] of Object.entries(roles)){
  const sec=document.createElement("div"); sec.className="roleGroup"; sec.innerHTML=`<h3>${group}</h3>`;
  list.forEach(([name,desc])=>{const el=document.createElement("div");el.className="role";el.innerHTML=`<strong>${name}</strong><p>${desc}</p>`;sec.appendChild(el);});
  $("#roleList").appendChild(sec);
}
$("#rolesBtn").onclick=()=>$("#roleModal").classList.remove("hidden");
$("#closeRoles").onclick=()=>$("#roleModal").classList.add("hidden");
$("#roleModal").onclick=e=>{if(e.target.id==="roleModal")$("#roleModal").classList.add("hidden")};

$("#createBtn").onclick=()=>{const name=$("#name").value.trim();if(!name)return showMessage("名前を入力してください。");socket.emit("createRoom",{name});};
$("#joinBtn").onclick=()=>{const name=$("#name").value.trim(),roomId=$("#roomId").value.trim();if(!name||!roomId)return showMessage("名前とルームIDを入力してください。");socket.emit("joinRoom",{name,roomId});};
$("#readyBtn").onclick=()=>socket.emit("toggleReady");
$("#startBtn").onclick=()=>socket.emit("startGame");
$("#copyBtn").onclick=async()=>{try{await navigator.clipboard.writeText(`${location.origin}/?room=${currentRoom}`);roomMessage("参加URLをコピーしました！")}catch{roomMessage("URLをコピーできませんでした。")}};
function enterRoom(id){currentRoom=id;$("#home").classList.add("hidden");$("#room").classList.remove("hidden");$("#roomCode").textContent=id;$("#shareUrl").textContent=`${location.origin}/?room=${id}`;}

socket.on("roomCreated",({roomId})=>enterRoom(roomId));
socket.on("joinedRoom",({roomId})=>enterRoom(roomId));
socket.on("errorMessage",showMessage);
socket.on("roomState",room=>{
  currentRoom=room.id;amHost=room.hostId===socket.id;
  $("#count").textContent=room.players.length;
  $("#playerList").innerHTML=room.players.map(p=>`<li><span>${esc(p.name)} ${p.id===room.hostId?"👑":""}</span><span>${p.ready?"準備OK":"待機中"}${p.alive===false?"（死亡）":""}</span></li>`).join("");
  $("#startBtn").classList.toggle("hidden",!amHost||room.phase!=="waiting");
});
socket.on("gameStarted",()=>{$("#room").classList.add("hidden");$("#game").classList.remove("hidden")});
socket.on("gameState",renderGame);
socket.on("privateNotice",t=>{const n=$("#privateNotice");n.textContent=t;n.classList.remove("hidden")});

function renderGame(g){
  latestGame=g;
  $("#phaseTitle").textContent=g.phase==="night"?"夜":g.phase==="day"?"昼":g.phase==="ended"?"ゲーム終了":"待機";
  $("#dayNo").textContent=`${g.day||1}日目`;
  $("#myRole").textContent=g.me.role||"---"; $("#myTeam").textContent=g.me.team||teams[g.me.role]||"";
  $("#roleDesc").textContent=descriptions[g.me.role]||"";
  $("#gameMessage").textContent=g.message||"";
  const targets=$("#targets");targets.innerHTML="";
  if(g.phase==="ended")return;
  if(!g.me.alive){targets.innerHTML="<p>あなたは死亡しています。ほかのプレイヤーの進行を見守ってください。</p>";return;}
  if(g.phase==="day"){
    g.players.filter(p=>p.alive&&p.id!==g.me.id).forEach(p=>addTarget(targets,p,"投票する",()=>socket.emit("vote",{targetId:p.id})));
  }else if(g.phase==="night"){
    const active=["占い師","狩人","騎士団","罠師","カウンセラー","人狼","内通者"];
    if(active.includes(g.me.role)){
      g.players.filter(p=>p.alive&&p.id!==g.me.id).forEach(p=>addTarget(targets,p,"選択",()=>socket.emit("nightAction",{targetId:p.id})));
    }else targets.innerHTML="<p>この役職は夜の選択行動がありません。</p>";
  }
  if(g.roles){$("#godRoles").classList.remove("hidden");$("#godRoleList").innerHTML=g.roles.map(p=>`<li><span>${esc(p.name)}</span><span>${esc(p.role)}</span></li>`).join("")}
}
function addTarget(parent,p,label,fn){const b=document.createElement("button");b.className="target";b.innerHTML=`<strong>${esc(p.name)}</strong><span>${label}</span>`;b.onclick=fn;parent.appendChild(b)}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

const params=new URLSearchParams(location.search);
if(params.get("room"))$("#roomId").value=params.get("room").toUpperCase();
