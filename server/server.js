var WebSocketServer = require("ws").WebSocketServer;
var http = require("http");
var fs = require("fs");
var path = require("path");

var PORT = process.env.PORT || 3000;
var rooms = new Map();

var server = http.createServer(function (req, res) {
  var url = req.url === "/" ? "/index.html" : req.url;
  var filePath = path.join(__dirname, "..", "public", url);
  var ext = path.extname(filePath);
  var mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8"
  };
  fs.readFile(filePath, function (err, data) {
    if (err) { res.writeHead(404); res.end("Not Found"); return; }
    res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
    res.end(data);
  });
});

var wss = new WebSocketServer({ server: server });

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

function broadcastToRoom(roomId, message, except) {
  var room = rooms.get(roomId);
  if (!room) return;
  room.forEach(function (client) {
    if (client !== except) client.send(JSON.stringify(message));
  });
}

function leaveRoom(ws) {
  rooms.forEach(function (room, roomId) {
    if (room.has(ws)) {
      room.delete(ws);
      broadcastToRoom(roomId, { type: "peer-left", roomId: roomId }, ws);
      if (room.size === 0) rooms.delete(roomId);
    }
  });
}

wss.on("connection", function (ws) {
  ws.on("message", function (raw) {
    var msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }

    switch (msg.type) {
      case "join": {
        var roomId = msg.roomId;
        if (!rooms.has(roomId)) rooms.set(roomId, new Set());
        var room = rooms.get(roomId);
        room.add(ws);

        var peers = []; room.forEach(function (c) { if (c !== ws) peers.push(c); });
        send(ws, { type: "joined", roomId: roomId, peerCount: room.size });
        peers.forEach(function (peer) {
          send(peer, { type: "peer-joined", roomId: roomId });
          send(ws, { type: "ready", roomId: roomId });
        });
        break;
      }
      case "offer":
      case "answer":
      case "ice":
        // 转发即丢，不存储
        broadcastToRoom(msg.roomId, msg, ws);
        break;
    }
  });

  ws.on("close", function () { leaveRoom(ws); });
  ws.on("error", function () { leaveRoom(ws); });
});

server.listen(PORT, function () {
  console.log("signal server running: http://localhost:" + PORT);
  console.log("open in two tabs/devices, use same room id.");
});