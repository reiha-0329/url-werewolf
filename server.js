const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

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
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, alive: p.alive, ready: p.ready
    }))
  };
}

io.on("connection", socket => {
  socket.on("createRoom", ({ name }) => {
    const id = makeRoomId();
    const room = {
      id, hostId: socket.id, phase: "waiting",
      players: new Map()
    };
    room.players.set(socket.id, {
      id: socket.id, name: String(name || "GM").slice(0, 20),
      alive: true, ready: false
    });
    rooms.set(id, room);
    socket.join(id);
    socket.roomId = id;
    socket.emit("roomCreated", { roomId: id });
    io.to(id).emit("roomState", publicRoom(room));
  });

  socket.on("joinRoom", ({ roomId, name }) => {
    const id = String(roomId || "").toUpperCase();
    const room = rooms.get(id);
    if (!room) return socket.emit("errorMessage", "そのルームは存在しません。");
    if (room.phase !== "waiting") return socket.emit("errorMessage", "このゲームはすでに開始されています。");
    if (room.players.size >= 20) return socket.emit("errorMessage", "このルームは満員です。");

    room.players.set(socket.id, {
      id: socket.id, name: String(name || "プレイヤー").slice(0, 20),
      alive: true, ready: false
    });
    socket.join(id);
    socket.roomId = id;
    socket.emit("joinedRoom", { roomId: id });
    io.to(id).emit("roomState", publicRoom(room));
  });

  socket.on("toggleReady", () => {
    const room = rooms.get(socket.roomId);
    if (!room || !room.players.has(socket.id)) return;
    room.players.get(socket.id).ready = !room.players.get(socket.id).ready;
    io.to(room.id).emit("roomState", publicRoom(room));
  });

  socket.on("startGame", () => {
    const room = rooms.get(socket.roomId);
    if (!room || room.hostId !== socket.id) return;
    if (room.players.size < 4) return socket.emit("errorMessage", "ゲーム開始には4人以上必要です。");
    room.phase = "night";
    io.to(room.id).emit("gameStarted");
    io.to(room.id).emit("roomState", publicRoom(room));
  });

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
    else io.to(id).emit("roomState", publicRoom(room));
  });
});

server.listen(PORT, () => {
  console.log(`Werewolf game running on http://localhost:${PORT}`);
});