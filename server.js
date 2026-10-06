
const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public"), {
  extensions: ["html"],
  index: "index.html",
  etag: true
}));
app.get("/style.css", (req,res)=>res.type("text/css").sendFile(path.join(__dirname,"public","style.css")));
app.get("/app.js", (req,res)=>res.type("application/javascript").sendFile(path.join(__dirname,"public","app.js")));

const rooms = new Map();

const ROLE_INFO = {
  "市民": { team: "市民陣営", desc: "特別な能力を持たない。" },
  "占い師": { team: "市民陣営", desc: "夜に1人を占い、人狼かどうかを知る。妖狐を占うと妖狐は死亡する。" },
  "狩人": { team: "市民陣営", desc: "夜に1人を護衛する。同じ人を連続では護衛できない。" },
  "騎士団": { team: "市民陣営", desc: "夜に1人を護衛する。連続して同じ人も護衛できる。" },
  "霊媒師": { team: "市民陣営", desc: "処刑されたプレイヤーの陣営を知る。" },
  "罠師": { team: "市民陣営", desc: "夜に1人へ罠を仕掛け、襲撃された場合に人狼を返り討ちにする。" },
  "双子": { team: "市民陣営", desc: "双子同士がお互いを知る。片方が死亡するともう片方も死亡する。" },
  "独裁者": { team: "市民陣営", desc: "特殊な投票権を持つ役職。詳細なルールは今後設定可能。" },
  "カウンセラー": { team: "市民陣営", desc: "夜に裏切者を選ぶと市民へ変える。" },
  "タフガイ": { team: "市民陣営", desc: "人狼の襲撃を1回だけ耐える。" },
  "人狼": { team: "人狼陣営", desc: "夜に人狼同士で相談して1人を襲撃する。" },
  "狂人": { team: "人狼陣営", desc: "人狼陣営だが人狼ではない。" },
  "裏切者": { team: "人狼陣営", desc: "人狼陣営。カウンセラーに選ばれると市民になる。" },
  "内通者": { team: "人狼陣営", desc: "人狼を支援し、人狼と情報を共有する。" },
  "アンドロイド": { team: "第三陣営", desc: "開始時に指定したプレイヤーの役職を受け継ぐ。指定対象が死亡すると死亡する。" },
  "妖狐": { team: "第三陣営", desc: "人狼の襲撃では死亡しない。占われると死亡する。" },
  "恋人": { team: "第三陣営", desc: "恋人同士を知る。片方が死亡するともう片方も死亡する。" },
  "神様": { team: "第三陣営", desc: "全員の役職を見ることができる。ゲーム終了時に生存していれば勝利。" }
};

function makeRoomId() {
  let id;
  do { id = crypto.randomBytes(3).toString("hex").toUpperCase(); }
  while (rooms.has(id));
  return id;
}

function publicRoom(room) {
  return {
    id: room.id,
    phase: room.phase,
    hostId: room.hostId,
    day: room.day,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, alive: p.alive, ready: p.ready
    }))
  };
}

function sendRoom(room) {
  io.to(room.id).emit("roomState", publicRoom(room));
}

function shuffle(a) {
  return [...a].sort(() => Math.random() - 0.5);
}

function roleSetup(count) {
  // Default setup. GM can later be given a role-count editor without changing the room system.
  const list = [];
  const wolves = Math.max(1, Math.floor(count / 4));
  for (let i = 0; i < wolves; i++) list.push("人狼");
  if (count >= 7) list.push("占い師");
  if (count >= 6) list.push("狩人");
  if (count >= 8) list.push("霊媒師");
  while (list.length < count) list.push("市民");
  return shuffle(list).slice(0, count);
}

function privateGameState(room, player) {
  const me = room.players.get(player.id);
  if (!me) return null;
  const result = {
    phase: room.phase,
    day: room.day,
    me: { id: me.id, name: me.name, alive: me.alive, role: me.role, team: ROLE_INFO[me.role]?.team || "" },
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, alive: p.alive
    })),
    message: room.message || ""
  };
  if (me.role === "神様") {
    result.roles = [...room.players.values()].map(p => ({id:p.id, name:p.name, role:p.role}));
  }
  if (me.role === "人狼" || me.role === "内通者") {
    result.wolves = [...room.players.values()].filter(p => ["人狼","内通者"].includes(p.role)).map(p => ({id:p.id,name:p.name,role:p.role}));
  }
  return result;
}

function sendGame(room) {
  for (const p of room.players.values()) {
    io.to(p.id).emit("gameState", privateGameState(room, p));
  }
}

function eliminate(room, id) {
  const p = room.players.get(id);
  if (!p || !p.alive) return;
  p.alive = false;
  // Lovers and twins are linked.
  if (p.role === "恋人" || p.role === "双子") {
    for (const q of room.players.values()) {
      if (q.id !== p.id && q.alive && q.role === p.role) q.alive = false;
    }
  }
  // Android dies when its designated target dies.
  if (room.androidTarget === id && room.androidId) {
    const a = room.players.get(room.androidId);
    if (a) a.alive = false;
  }
}

function checkWinner(room) {
  const alive = [...room.players.values()].filter(p => p.alive);
  const wolves = alive.filter(p => p.role === "人狼").length;
  const nonWolves = alive.length - wolves;
  if (alive.some(p => p.role === "神様") && room.phase === "ended") return "神様";
  if (alive.some(p => p.role === "妖狐") && wolves === 0) return "妖狐";
  if (wolves === 0) return "市民陣営";
  if (wolves >= nonWolves) return "人狼陣営";
  return null;
}

io.on("connection", socket => {
  socket.on("createRoom", ({ name }) => {
    const id = makeRoomId();
    const room = {
      id, hostId: socket.id, phase: "waiting", day: 0,
      players: new Map(), votes: new Map(), nightActions: new Map(),
      message: "参加者が集まるのを待っています。"
    };
    room.players.set(socket.id, {
      id: socket.id, name: String(name || "GM").slice(0,20),
      alive: true, ready: false, role: null
    });
    rooms.set(id, room);
    socket.join(id); socket.roomId = id;
    socket.emit("roomCreated", { roomId:id });
    sendRoom(room);
  });

  socket.on("joinRoom", ({ roomId, name }) => {
    const id = String(roomId || "").toUpperCase();
    const room = rooms.get(id);
    if (!room) return socket.emit("errorMessage", "そのルームは存在しません。");
    if (room.phase !== "waiting") return socket.emit("errorMessage", "このゲームはすでに開始されています。");
    if (room.players.size >= 20) return socket.emit("errorMessage", "このルームは満員です。");
    room.players.set(socket.id, {
      id: socket.id, name: String(name || "プレイヤー").slice(0,20),
      alive: true, ready: false, role: null
    });
    socket.join(id); socket.roomId = id;
    socket.emit("joinedRoom", { roomId:id });
    sendRoom(room);
  });

  socket.on("toggleReady", () => {
    const room = rooms.get(socket.roomId);
    const p = room?.players.get(socket.id);
    if (!p || room.phase !== "waiting") return;
    p.ready = !p.ready;
    sendRoom(room);
  });

  socket.on("startGame", () => {
    const room = rooms.get(socket.roomId);
    if (!room || room.hostId !== socket.id || room.phase !== "waiting") return;
    if (room.players.size < 4) return socket.emit("errorMessage", "ゲーム開始には4人以上必要です。");

    const ids = [...room.players.keys()];
    const roles = roleSetup(ids.length);
    ids.forEach((id, i) => room.players.get(id).role = roles[i]);
    room.day = 1;
    room.phase = "night";
    room.message = "夜になりました。役職を確認して能力を使ってください。";
    sendRoom(room); sendGame(room);
    io.to(room.id).emit("gameStarted");
  });

  socket.on("nightAction", ({ targetId }) => {
    const room = rooms.get(socket.roomId);
    const p = room?.players.get(socket.id);
    const target = room?.players.get(targetId);
    if (!room || !p || !target || room.phase !== "night" || !p.alive) return;
    const active = ["占い師","狩人","騎士団","罠師","カウンセラー","人狼","内通者"];
    if (!active.includes(p.role)) return;
    room.nightActions.set(socket.id, targetId);

    const actors = [...room.players.values()].filter(x => x.alive && active.includes(x.role));
    if (room.nightActions.size >= actors.length) resolveNight(room);
    else sendGame(room);
  });

  socket.on("vote", ({ targetId }) => {
    const room = rooms.get(socket.roomId);
    const p = room?.players.get(socket.id);
    const target = room?.players.get(targetId);
    if (!room || !p || !target || room.phase !== "day" || !p.alive) return;
    room.votes.set(socket.id, targetId);
    const voters = [...room.players.values()].filter(x => x.alive);
    if (room.votes.size >= voters.length) resolveVote(room);
    else sendGame(room);
  });

  function resolveNight(room) {
    const alive = [...room.players.values()].filter(p => p.alive);
    const wolf = alive.find(p => p.role === "人狼");
    const attackTargetId = wolf ? room.nightActions.get(wolf.id) : null;
    const guarded = new Set(
      alive.filter(p => ["狩人","騎士団"].includes(p.role))
        .map(p => room.nightActions.get(p.id)).filter(Boolean)
    );
    const trapped = new Set(
      alive.filter(p => p.role === "罠師").map(p => room.nightActions.get(p.id)).filter(Boolean)
    );

    if (attackTargetId) {
      const target = room.players.get(attackTargetId);
      if (target && !guarded.has(attackTargetId) && target.role !== "妖狐") {
        if (target.role === "タフガイ" && !target.toughUsed) target.toughUsed = true;
        else if (trapped.has(attackTargetId) && wolf) eliminate(room, wolf.id);
        else eliminate(room, attackTargetId);
      }
    }

    // Fortune telling.
    for (const p of alive.filter(x => x.role === "占い師")) {
      const tid = room.nightActions.get(p.id), t = room.players.get(tid);
      if (!t) continue;
      const result = t.role === "人狼" ? "人狼" : "人狼ではない";
      if (t.role === "妖狐") eliminate(room, t.id);
      io.to(p.id).emit("privateNotice", `${t.name}さんは「${result}」です。`);
    }

    // Counselor converts betrayer.
    for (const p of alive.filter(x => x.role === "カウンセラー")) {
      const t = room.players.get(room.nightActions.get(p.id));
      if (t && t.role === "裏切者") {
        t.role = "市民";
        io.to(p.id).emit("privateNotice", `${t.name}さんを市民に戻しました。`);
      }
    }

    room.nightActions.clear();
    room.votes.clear();
    room.phase = "day";
    room.message = "昼になりました。話し合って、処刑するプレイヤーに投票してください。";
    sendRoom(room); sendGame(room);
  }

  function resolveVote(room) {
    const counts = new Map();
    for (const id of room.votes.values()) counts.set(id, (counts.get(id)||0)+1);
    let max = 0, selected = null, tie = false;
    for (const [id,n] of counts) {
      if (n > max) { max=n; selected=id; tie=false; }
      else if (n === max) tie=true;
    }
    if (!tie && selected) {
      eliminate(room, selected);
      const dead = room.players.get(selected);
      room.message = `${dead.name}さんが処刑されました。`;
    } else room.message = "同数票のため、今回は処刑されませんでした。";

    const winner = checkWinner(room);
    room.votes.clear();
    if (winner) {
      room.phase = "ended";
      room.message += ` 勝利陣営：${winner}`;
    } else {
      room.day++;
      room.phase = "night";
      room.message += " 夜になりました。";
    }
    sendRoom(room); sendGame(room);
  }

  socket.on("disconnect", () => {
    const id = socket.roomId;
    if (!id || !rooms.has(id)) return;
    const room = rooms.get(id);
    room.players.delete(socket.id);
    if (room.hostId === socket.id) {
      const next = room.players.values().next().value;
      room.hostId = next ? next.id : null;
    }
    if (room.players.size === 0) rooms.delete(id);
    else { sendRoom(room); if (room.phase !== "waiting") sendGame(room); }
  });
});

server.listen(PORT, () => console.log(`Werewolf game running on port ${PORT}`));
