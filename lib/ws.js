// Минимальный WebSocket-сервер (только отправка текстовых сообщений клиентам).
// Используется вместо SSE: SSE занимает одно из 6 HTTP-соединений браузера на хост,
// и несколько открытых вкладок панели блокировали загрузку страницы.
const crypto = require('crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function frame(opcode, payload = Buffer.alloc(0)) {
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, payload]);
}

// Возвращает объект клиента { send(text), onClose(fn) } или null, если запрос не WebSocket
function accept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || req.headers.upgrade?.toLowerCase() !== 'websocket') { socket.destroy(); return null; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 30000);

  const closeHandlers = [];
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    closeHandlers.forEach(fn => fn());
    socket.destroy();
  };
  socket.on('close', close);
  socket.on('error', close);

  // Входящие кадры: интересуют только close (0x8) и ping (0x9)
  let buf = Buffer.alloc(0);
  socket.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const opcode = buf[0] & 0x0f;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const masked = buf[1] & 0x80;
      const total = off + (masked ? 4 : 0) + len;
      if (buf.length < total) return;
      const mask = masked ? buf.subarray(off, off + 4) : null;
      const data = Buffer.from(buf.subarray(total - len, total));
      if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
      buf = buf.subarray(total);
      if (opcode === 0x8) { socket.end(frame(0x8)); return close(); }
      if (opcode === 0x9) socket.write(frame(0xA, data));
    }
  });

  return {
    send(text) { if (!closed) socket.write(frame(0x1, Buffer.from(text))); },
    ping() { if (!closed) socket.write(frame(0x9)); },
    onClose(fn) { closeHandlers.push(fn); },
  };
}

module.exports = { accept };
