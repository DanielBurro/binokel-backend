import http from 'node:http';
import express from 'express';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

io.on('connection', (socket) => {
  console.log(`[Socket] Client verbunden: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`[Socket] Client getrennt: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Binokel-Server] Laeuft auf Port ${PORT}`);
});