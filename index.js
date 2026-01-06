/* eslint-disable no-undef */
// Rando Chat Server
const PORT = process.env.PORT || 3001;

const waitingQueue = [];
const users = new Map();

function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

function findMatch(userId) {
  const matchIndex = waitingQueue.findIndex((id) => id !== userId);
  if (matchIndex !== -1) {
    return waitingQueue.splice(matchIndex, 1)[0];
  }
  return null;
}

function sendTo(userId, message) {
  const user = users.get(userId);
  if (user && user.socket.readyState === 1) {
    user.socket.send(JSON.stringify(message));
  }
}

function handleDisconnect(userId) {
  const user = users.get(userId);
  if (!user) return;
  const queueIndex = waitingQueue.indexOf(userId);
  if (queueIndex !== -1) waitingQueue.splice(queueIndex, 1);
  if (user.partnerId) {
    const partner = users.get(user.partnerId);
    if (partner) {
      partner.inChat = false;
      partner.partnerId = null;
      sendTo(user.partnerId, { type: 'partner-disconnected' });
    }
  }
  users.delete(userId);
}

function handleMessage(userId, data) {
  let message;
  try { message = JSON.parse(data); } catch { return; }
  const user = users.get(userId);
  if (!user) return;

  switch (message.type) {
    case 'find-match': {
      if (waitingQueue.includes(userId)) return;
      const matchId = findMatch(userId);
      if (matchId) {
        const matchUser = users.get(matchId);
        if (matchUser) {
          user.inChat = true;
          user.partnerId = matchId;
          matchUser.inChat = true;
          matchUser.partnerId = userId;
          sendTo(matchId, { type: 'matched', partnerId: userId });
          sendTo(userId, { type: 'matched', partnerId: matchId });
        }
      } else {
        waitingQueue.push(userId);
        sendTo(userId, { type: 'waiting', position: waitingQueue.length });
      }
      break;
    }
    case 'cancel-search': {
      const idx = waitingQueue.indexOf(userId);
      if (idx !== -1) waitingQueue.splice(idx, 1);
      break;
    }
    case 'chat-message': {
      if (user.partnerId && message.text) {
        sendTo(user.partnerId, { type: 'chat-message', text: message.text });
      }
      break;
    }
    case 'skip':
    case 'end-chat': {
      if (user.partnerId) {
        const partner = users.get(user.partnerId);
        if (partner) {
          partner.inChat = false;
          partner.partnerId = null;
          sendTo(user.partnerId, { type: message.type === 'skip' ? 'partner-skipped' : 'chat-ended' });
        }
      }
      user.inChat = false;
      user.partnerId = null;
      break;
    }
  }
}

Bun.serve({
  port: PORT,
  fetch(req, server) {
    if (server.upgrade(req)) return;
    return new Response(JSON.stringify({ status: 'ok', users: users.size }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  },
  websocket: {
    open(ws) {
      const userId = generateId();
      ws.userId = userId;
      users.set(userId, { id: viserId, socket: ws, inChat: false, partnerId: null });
      ws.send(JSON.stringify({ type: 'connected', userId, onlineCount: users.size }));
    },
    message(ws, message) { handleMessage(ws.userId, message.toString()); },
    close(ws) { handleDisconnect(ws.userId); },
  },
});

console.log(`Server running on port ${PORT}`);
