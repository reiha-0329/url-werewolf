
const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public"), { extensions:["html"], index:"index.html" }));
app.get("/style.css",(req,res)=>res.type("text/css").sendFile(path.join(__dirname,"public","style.css")));
app.get("/app.js",(req,res)=>res.type("application/javascript").sendFile(path.join(__dirname,"public","app.js")));

const rooms = new Map();

const ROLE_INFO = {
  "市民": { team:"市民陣営", desc:"特別な能力を持たない。" },
  "占い師": { team:"市民陣営", desc:"夜に1人を占い、人狼かどうかを知る。妖狐を占うと妖狐は死亡する。" },
  "狩人": { team:"市民陣営", desc:"夜に1人を護衛する。同じ人を連続では護衛できない。" },
  "騎士団": { team:"市民陣営", desc:"夜に1人を護衛する。連続して同じ人も護衛できる。" },
  "霊媒師": { team:"市民陣営", desc:"処刑されたプレイヤーの陣営を知る。" },
  "罠師": { team:"市民陣営", desc:"夜に罠を仕掛け、襲撃された場合に人狼を倒す。" },
  "双子": { team:"市民陣営", desc:"双子同士がお互いを知る。片方が死亡するともう片方も死亡する。" },
  "独裁者": { team:"市民陣営", desc:"特殊な投票権を持つ役職。" },
  "カウンセラー": { team:"市民陣営", desc:"夜に裏切者を選ぶと市民へ戻す。" },
  "タフガイ": { team:"市民陣営", desc:"人狼の襲撃を1回だけ耐える。" },
  "人狼": { team:"人狼陣営", desc:"夜に仲間と相談して1人を襲撃する。" },
  "狂人": { team:"人狼陣営", desc:"人狼陣営だが、人狼ではない。" },
  "裏切者": { team:"人狼陣営", desc:"人狼陣営。カウンセラーに選ばれると市民になる。" },
  "内通者": { team:"人狼陣営", desc:"人狼を支援し、人狼と情報を共有する。" },
  "アンドロイド": { team:"第三陣営", desc:"ゲーム開始時に指定したプレイヤーの役職を受け継ぐ。指定対象が死亡すると死亡する。" },
  "妖狐": { team:"第三陣営", desc:"人狼の襲撃では死亡せず、占われると死亡する。" },
  "恋人": { team:"第三陣営", desc:"恋人同士を知る。片方が死亡するともう片方も死亡する。" },
  "神様": { team:"第三陣営", desc:"全員の役職を見ることができる。ゲーム終了時に生存していれば勝利。" }
};
const ROLE_NAMES = Object.keys(ROLE_INFO);

function makeRoomId(){
  let id; do{id=crypto.randomBytes(3).toString("hex").toUpperCase()}while(rooms.has(id)); return id;
}
function shuffle(a){return [...a].sort(()=>Math.random()-0.5)}
function publicRoom(room){
  return {id:room.id,phase:room.phase,hostId:room.hostId,day:room.day,roleConfig:room.roleConfig,
    players:[...room.players.values()].map(p=>({id:p.id,name:p.name,alive:p.alive,ready:p.ready}))};
}
function sendRoom(room){io.to(room.id).emit("roomState",publicRoom(room))}
function alive(room){return [...room.players.values()].filter(p=>p.alive)}
function eliminate(room,id){
  const p=room.players.get(id); if(!p||!p.alive)return;
  p.alive=false;
  if(p.role==="恋人"||p.role==="双子"){
    for(const q of room.players.values()) if(q.id!==p.id&&q.alive&&q.role===p.role) q.alive=false;
  }
  if(room.androidTargets.includes(id)){
    for(const a of room.players.values()) if(a.alive&&a.role==="アンドロイド"&&a.androidTarget===id) a.alive=false;
  }
}
function winner(room){
  const a=alive(room), wolves=a.filter(p=>p.role==="人狼").length;
  if(room.phase==="ended" && a.some(p=>p.role==="神様")) return "神様";
  if(a.some(p=>p.role==="妖狐") && wolves===0) return "妖狐";
  if(wolves===0) return "市民陣営";
  if(wolves>=a.length-wolves) return "人狼陣営";
  return null;
}
function privateState(room,p){
  const me=room.players.get(p.id);
  const out={phase:room.phase,day:room.day,message:room.message||"",
    me:{id:me.id,name:me.name,alive:me.alive,role:me.role,team:ROLE_INFO[me.role]?.team||""},
    players:[...room.players.values()].map(x=>({id:x.id,name:x.name,alive:x.alive}))};
  if(me.role==="神様") out.roles=[...room.players.values()].map(x=>({id:x.id,name:x.name,role:x.role}));
  if(["人狼","内通者"].includes(me.role)) out.wolves=[...room.players.values()].filter(x=>["人狼","内通者"].includes(x.role)).map(x=>({id:x.id,name:x.name,role:x.role}));
  if(me.role==="双子"||me.role==="恋人") out.partners=[...room.players.values()].filter(x=>x.role===me.role).map(x=>({id:x.id,name:x.name}));
  return out;
}
function sendGame(room){for(const p of room.players.values())io.to(p.id).emit("gameState",privateState(room,p))}

io.on("connection",socket=>{
  socket.on("createRoom",({name})=>{
    const id=makeRoomId(), room={id,hostId:socket.id,phase:"waiting",day:0,players:new Map(),
      roleConfig:{},votes:new Map(),nightActions:new Map(),lastGuard:null,androidTargets:[],message:"参加者が集まるのを待っています。"};
    room.players.set(socket.id,{id:socket.id,name:String(name||"GM").slice(0,20),alive:true,ready:false,role:null});
    rooms.set(id,room);socket.join(id);socket.roomId=id;socket.emit("roomCreated",{roomId:id});sendRoom(room);
  });

  socket.on("joinRoom",({roomId,name})=>{
    const id=String(roomId||"").toUpperCase(),room=rooms.get(id);
    if(!room)return socket.emit("errorMessage","そのルームは存在しません。");
    if(room.phase!=="waiting")return socket.emit("errorMessage","このゲームはすでに開始されています。");
    if(room.players.size>=20)return socket.emit("errorMessage","このルームは満員です。");
    room.players.set(socket.id,{id:socket.id,name:String(name||"プレイヤー").slice(0,20),alive:true,ready:false,role:null});
    socket.join(id);socket.roomId=id;socket.emit("joinedRoom",{roomId:id});sendRoom(room);
  });

  socket.on("toggleReady",()=>{
    const room=rooms.get(socket.roomId),p=room?.players.get(socket.id);
    if(!p||room.phase!=="waiting")return;p.ready=!p.ready;sendRoom(room);
  });

  socket.on("setRoleConfig",config=>{
    const room=rooms.get(socket.roomId);
    if(!room||room.hostId!==socket.id||room.phase!=="waiting")return;
    const clean={}; for(const r of ROLE_NAMES){const n=Number(config?.[r]||0);clean[r]=Number.isInteger(n)&&n>=0?Math.min(n,20):0;}
    room.roleConfig=clean;sendRoom(room);
  });

  socket.on("startGame",()=>{
    const room=rooms.get(socket.roomId);
    if(!room||room.hostId!==socket.id||room.phase!=="waiting")return;
    const count=room.players.size;
    if(count<4)return socket.emit("errorMessage","ゲーム開始には4人以上必要です。");
    const cfg={...room.roleConfig};
    for(const r of ROLE_NAMES) cfg[r]=Number(cfg[r]||0);
    const total=ROLE_NAMES.reduce((s,r)=>s+cfg[r],0);
    if(total!==count)return socket.emit("errorMessage",`役職の合計人数を${count}人にしてください。（現在${total}人）`);
    if(cfg["人狼"]<1)return socket.emit("errorMessage","人狼を1人以上設定してください。");
    if(cfg["双子"]===1||cfg["恋人"]===1)return socket.emit("errorMessage","双子と恋人は2人セットで設定してください。");
    if(cfg["アンドロイド"]>0 && count<2)return socket.emit("errorMessage","アンドロイドには指定対象が必要です。");

    const deck=[]; for(const r of ROLE_NAMES) for(let i=0;i<cfg[r];i++)deck.push(r);
    const ids=shuffle([...room.players.keys()]);
    ids.forEach((id,i)=>{const p=room.players.get(id);p.role=deck[i];p.alive=true;p.toughUsed=false;p.androidTarget=null});
    // Android targets a random other player. The role itself is retained, but its win/linked-death target is recorded.
    room.androidTargets=[];
    for(const a of room.players.values()) if(a.role==="アンドロイド"){
      const candidates=[...room.players.values()].filter(x=>x.id!==a.id);
      if(candidates.length){const t=shuffle(candidates)[0];a.androidTarget=t.id;a.androidTargetsName=t.name;room.androidTargets.push(t.id);}
    }
    room.day=1;room.phase="night";room.message="夜になりました。役職を確認して能力を使ってください。";
    sendRoom(room);sendGame(room);io.to(room.id).emit("gameStarted");
  });

  socket.on("nightAction",({targetId})=>{
    const room=rooms.get(socket.roomId),p=room?.players.get(socket.id),t=room?.players.get(targetId);
    if(!room||!p||!t||room.phase!=="night"||!p.alive)return;
    const active=["占い師","狩人","騎士団","罠師","カウンセラー","人狼","内通者"];
    if(!active.includes(p.role))return;
    if(p.role==="狩人"&&room.lastGuard===targetId)return socket.emit("errorMessage","狩人は前の夜と同じ人を連続で護衛できません。");
    room.nightActions.set(socket.id,targetId);
    const actors=alive(room).filter(x=>active.includes(x.role));
    if(room.nightActions.size>=actors.length)resolveNight(room); else sendGame(room);
  });

  socket.on("vote",({targetId})=>{
    const room=rooms.get(socket.roomId),p=room?.players.get(socket.id),t=room?.players.get(targetId);
    if(!room||!p||!t||room.phase!=="day"||!p.alive)return;
    room.votes.set(socket.id,targetId);
    if(room.votes.size>=alive(room).length)resolveVote(room);else sendGame(room);
  });

  function resolveNight(room){
    const a=alive(room),wolf=a.find(p=>p.role==="人狼"),attack=wolf?room.nightActions.get(wolf.id):null;
    const guards=new Set(a.filter(p=>["狩人","騎士団"].includes(p.role)).map(p=>room.nightActions.get(p.id)).filter(Boolean));
    const traps=new Set(a.filter(p=>p.role==="罠師").map(p=>room.nightActions.get(p.id)).filter(Boolean));
    if(attack){
      const t=room.players.get(attack);
      if(t&&!guards.has(attack)&&t.role!=="妖狐"){
        if(t.role==="タフガイ"&&!t.toughUsed)t.toughUsed=true;
        else if(traps.has(attack)&&wolf)eliminate(room,wolf.id);
        else eliminate(room,attack);
      }
    }
    for(const p of a.filter(x=>x.role==="占い師")){
      const t=room.players.get(room.nightActions.get(p.id)); if(!t)continue;
      const result=t.role==="人狼"?"人狼":"人狼ではない";
      if(t.role==="妖狐")eliminate(room,t.id);
      io.to(p.id).emit("privateNotice",`${t.name}さんは「${result}」です。`);
    }
    for(const p of a.filter(x=>x.role==="カウンセラー")){
      const t=room.players.get(room.nightActions.get(p.id));
      if(t&&t.role==="裏切者"){t.role="市民";io.to(p.id).emit("privateNotice",`${t.name}さんを市民に戻しました。`);}
    }
    room.lastGuard=a.find(x=>x.role==="狩人")?room.nightActions.get(a.find(x=>x.role==="狩人").id):room.lastGuard;
    room.nightActions.clear();room.votes.clear();
    const w=winner(room);
    if(w){room.phase="ended";room.message=`ゲーム終了。勝利陣営：${w}`;}
    else{room.phase="day";room.message="昼になりました。話し合って、処刑するプレイヤーに投票してください。";}
    sendRoom(room);sendGame(room);
  }

  function resolveVote(room){
    const counts=new Map();for(const id of room.votes.values())counts.set(id,(counts.get(id)||0)+1);
    let max=0,selected=null,tie=false;for(const [id,n] of counts){if(n>max){max=n;selected=id;tie=false}else if(n===max)tie=true}
    if(!tie&&selected){const dead=room.players.get(selected);eliminate(room,selected);room.message=`${dead.name}さんが処刑されました。`;}
    else room.message="同数票のため、今回は処刑されませんでした。";
    room.votes.clear();const w=winner(room);
    if(w){room.phase="ended";room.message+=` 勝利陣営：${w}`;}
    else{room.day++;room.phase="night";room.message+=" 夜になりました。";}
    sendRoom(room);sendGame(room);
  }

  socket.on("disconnect",()=>{
    const id=socket.roomId;if(!id||!rooms.has(id))return;const room=rooms.get(id);
    room.players.delete(socket.id);
    if(room.hostId===socket.id){const n=room.players.values().next().value;room.hostId=n?n.id:null}
    if(room.players.size===0)rooms.delete(id);else{sendRoom(room);if(room.phase!=="waiting")sendGame(room)}
  });
});

server.listen(PORT,()=>console.log(`Werewolf game running on port ${PORT}`));
