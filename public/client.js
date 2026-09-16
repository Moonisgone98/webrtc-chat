// 客户端 WebRTC 逻辑（无构建，浏览器直接加载）
(function () {
  var signalHost = location.host; // 信令服务器与网页同源
  var roomId;
  var ws;
  var pc;
  var dc;
  var isInitiator = false;
  var pendingCandidates = []; // 等待 peer 连接期间的本地 ICE 候选

  var logEl, chatEl, msgInput, sendBtn, statusEl;

  function $(id) { return document.getElementById(id); }

  function status(text) { if (statusEl) statusEl.textContent = text; }
  function appendChat(text, me) {
    if (!chatEl) return;
    var div = document.createElement("div");
    div.className = me ? "msg me" : "msg peer";
    div.textContent = text;
    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function connect(room) {
    roomId = room;
    logEl.innerHTML = "room: " + roomId;
    ws = new WebSocket("ws://" + signalHost);

    ws.onopen = function () {
      status("connecting to room...");
      ws.send(JSON.stringify({ type: "join", roomId: roomId }));
    };

    ws.onmessage = function (ev) {
      var msg = JSON.parse(ev.data);
      handleSignal(msg);
    };

    ws.onclose = function () { status("signal connection closed"); };
  }

  function handleSignal(msg) {
    switch (msg.type) {
      case "joined":
        if (msg.peerCount === 1) status("waiting for peer...");
        break;
      case "ready":
        // 已有同伴，本端发起 offer
        isInitiator = true;
        createPeer();
        status("peer ready, negotiating...");
        break;
      case "peer-joined":
        // 后端已给本端发 ready（当发起方）；若还有其它情况在此由对端补充
        if (!isInitiator && !pc) {
          createPeer();
          status("a peer joined, negotiating...");
        }
        break;
      case "offer":
        if (!pc) createPeer();
        pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: msg.sdp }))
          .then(function () {
            return pc.createAnswer();
          })
          .then(function (answer) {
            return pc.setLocalDescription(answer);
          })
          .then(function () {
            ws.send(JSON.stringify({ type: "answer", roomId: roomId, sdp: pc.localDescription.sdp }));
            flushCandidates();
          })
          .catch(function (e) { console.error(e); });
        break;
      case "answer":
        pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: msg.sdp }))
          .then(function () { flushCandidates(); })
          .catch(function (e) { console.error(e); });
        break;
      case "ice":
        if (!pc) return;
        pc.addIceCandidate(new RTCIceCandidate(msg.candidate))
          .catch(function (e) { console.error(e); });
        break;
      case "peer-left":
        status("peer left the room");
        if (pc) { pc.close(); pc = null; dc = null; }
        break;
    }
  }

  function createPeer() {
    pc = new RTCPeerConnection();
    dc = pc.createDataChannel("chat", { ordered: true });

    dc.onopen = function () { status("connected!"); };
    dc.onmessage = function (ev) { appendChat(ev.data, false); };
    dc.onclose = function () { status("data channel closed"); };

    pc.onicecandidate = function (ev) {
      if (ev.candidate) {
        var m = { type: "ice", roomId: roomId, candidate: ev.candidate.toJSON() };
        if (pc.remoteDescription) {
          ws.send(JSON.stringify(m));
        } else {
          pendingCandidates.push(m);
        }
      }
    };

    pc.onconnectionstatechange = function () {
      if (pc.connectionState === "connected") status("connected!");
    };
  }

  function flushCandidates() {
    pendingCandidates.forEach(function (m) { ws.send(JSON.stringify(m)); });
    pendingCandidates = [];
  }

  function sendMessage() {
    var text = msgInput.value.trim();
    if (!text) return;
    if (dc && dc.readyState === "open") {
      dc.send(text);
      appendChat(text, true);
      msgInput.value = "";
    } else {
      status("not connected yet");
    }
  }

  // ---- 注入页面逻辑 ----
  function init() {
    if (!$("connectBtn")) return; // 非典型页面直接跳过
    logEl = $("log");
    chatEl = $("chat");
    msgInput = $("msgInput");
    sendBtn = $("sendBtn");
    statusEl = $("status");

    $("connectBtn").addEventListener("click", function () {
      var room = $("roomInput").value.trim();
      if (!room) return alert("enter a room id");
      $("connectBox").style.display = "none";
      $("chatBox").style.display = "block";
      connect(room);
    });

    sendBtn.addEventListener("click", sendMessage);
    msgInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") sendMessage();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();