const socket = io();
const $ = s => document.querySelector(s);

const roles = {
  "市民陣営": [
    ["市民","特別な能力を持たない。推理と議論で人狼を探す。"],
    ["占い師","夜に1人を占い、人狼かどうかを知る。"],
    ["狩人","夜に1人を護衛し、その人を人狼の襲撃から守る。"],
    ["騎士団","仲間と協力する特殊な護衛役。ゲーム設定に応じて護衛能力を持つ。"],
    ["霊媒師","昼の投票で処刑されたプレイヤーの陣営を知る。"],
    ["罠師","夜に罠を仕掛け、襲撃などの行動に対して特殊な効果を発生させる。"],
    ["双子","2人で構成される役職。互いが双子だと分かる。"],
    ["独裁者","強い投票権を持つ特殊役職。具体的な権限はルール設定で変更可能。"],
    ["カウンセラー","夜に1人を選び、特殊な状態や陣営を確認・変化させる支援役。"],
    ["タフガイ","一度だけ人狼の襲撃を耐えられる。"],
  ],
  "人狼陣営": [
    ["人狼","夜に仲間と相談して市民を襲撃する。人狼が市民より優勢になることを目指す。"],
    ["狂人","人狼を支援するが、自分自身は人狼ではない。人狼陣営の勝利を目指す。"],
    ["裏切者","人狼陣営だが、通常の人狼とは異なる条件や能力を持つ。"],
    ["内通者","人狼と情報を共有し、議論や夜の行動を通して人狼を支援する。"],
  ],
  "第三陣営": [
    ["アンドロイド","独自の勝利条件を持つ特殊役職。ゲーム設定に応じて能力を決められる。"],
    ["妖狐","人狼に襲撃されても生き残る。通常は最後まで生存することを目指す。"],
    ["恋人","恋人同士で特別な勝利条件を持つ。片方が倒れるともう片方にも影響するルールにできる。"],
    ["神様","強力な特殊能力を持つ第三陣営。ゲームバランスに合わせて能力・勝利条件を設定する。"],
  ]
};

const roleList = $("#roleList");
for (const [group, list] of Object.entries(roles)) {
  const section = document.createElement("div");
  section.className = "roleGroup";
  section.innerHTML = `<h3>${group}</h3>`;
  list.forEach(([name, desc]) => {
    const el = document.createElement("div");
    el.className = "role";
    el.innerHTML = `<strong>${name}</strong><p>${desc}</p>`;
    section.appendChild(el);
  });
  roleList.appendChild(section);
}

let currentRoom = null;
let amHost = false;

function showMessage(text) { $("#message").textContent = text; }
function roomMessage(text) { $("#roomMessage").textContent = text; }

$("#rolesBtn").onclick = () => $("#roleModal").classList.remove("hidden");
$("#closeRoles").onclick = () => $("#roleModal").classList.add("hidden");
$("#roleModal").onclick = e => { if(e.target.id==="roleModal") $("#roleModal").classList.add("hidden"); };

$("#createBtn").onclick = () => {
  const name = $("#name").value.trim();
  if (!name) return showMessage("名前を入力してください。");
  socket.emit("createRoom", { name });
};

$("#joinBtn").onclick = () => {
  const name = $("#name").value.trim();
  const roomId = $("#roomId").value.trim();
  if (!name || !roomId) return showMessage("名前とルームIDを入力してください。");
  socket.emit("joinRoom", { name, roomId });
};

$("#readyBtn").onclick = () => socket.emit("toggleReady");
$("#startBtn").onclick = () => socket.emit("startGame");

$("#copyBtn").onclick = async () => {
  const url = `${location.origin}/?room=${currentRoom}`;
  await navigator.clipboard.writeText(url);
  roomMessage("参加URLをコピーしました！");
};

function enterRoom(id) {
  currentRoom = id;
  $("#home").classList.add("hidden");
  $("#room").classList.remove("hidden");
  $("#roomCode").textContent = id;
  $("#shareUrl").textContent = `${location.origin}/?room=${id}`;
}

socket.on("roomCreated", ({roomId}) => enterRoom(roomId));
socket.on("joinedRoom", ({roomId}) => enterRoom(roomId));
socket.on("errorMessage", showMessage);

socket.on("roomState", room => {
  currentRoom = room.id;
  amHost = room.hostId === socket.id;
  $("#count").textContent = room.players.length;
  $("#playerList").innerHTML = room.players.map(p =>
    `<li><span>${escapeHtml(p.name)} ${p.id===room.hostId ? "👑" : ""}</span><span>${p.ready ? "準備OK" : "待機中"}</span></li>`
  ).join("");
  $("#startBtn").classList.toggle("hidden", !amHost);
});

socket.on("gameStarted", () => {
  $("#room").classList.add("hidden");
  $("#game").classList.remove("hidden");
});

const params = new URLSearchParams(location.search);
if (params.get("room")) $("#roomId").value = params.get("room").toUpperCase();

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}