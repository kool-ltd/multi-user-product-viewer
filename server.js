"use strict";

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Global variables to track the current host and pending transfer requests.
let hostSocketId = null;
let pendingRequests = {}; // Structure: { requestId: { timeout: TimeoutObject, requester: socketId } }

// Serve static files (for your client code, assets, etc.)
app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Register a client as host.
  socket.on('register-host', () => {
    console.log(`register-host from ${socket.id}`);
    hostSocketId = socket.id;
    io.emit('host-changed', { hostSocketId });
  });

  // When a viewer requests to become host.
  socket.on('request-host', () => {
    console.log(`request-host from ${socket.id}`);
    if (!hostSocketId) {
      // No current host; assign the requester as host.
      hostSocketId = socket.id;
      io.emit('host-changed', { hostSocketId });
    } else if (hostSocketId === socket.id) {
      // The requester is already the host.
      console.log(`Socket ${socket.id} is already the host.`);
    } else {
      // There is an existing host. Create a unique request ID.
      const requestId = uuidv4();
      // Start a timeout: if the current host doesn’t respond in 10 seconds, auto transfer.
      const timeout = setTimeout(() => {
        console.log(`Auto transferring host role to ${socket.id} for request ${requestId}`);
        hostSocketId = socket.id;
        io.emit('host-changed', { hostSocketId });
        delete pendingRequests[requestId];
      }, 30000);

      pendingRequests[requestId] = { timeout, requester: socket.id };
      console.log(`Emitting host-transfer-request with requestId ${requestId} from ${socket.id} to host ${hostSocketId}`);
      io.to(hostSocketId).emit('host-transfer-request', { requestId, requester: socket.id });
    }
  });

  // The current host agrees to relinquish their role.
  socket.on('release-host', (data) => {
    const { requestId } = data;
    if (pendingRequests[requestId]) {
      const { timeout, requester } = pendingRequests[requestId];
      clearTimeout(timeout);
      hostSocketId = requester;
      io.emit('host-changed', { hostSocketId });
      console.log(`Host ${socket.id} released host role. New host: ${requester}`);
      delete pendingRequests[requestId];
    }
  });

  // The current host denies the host transfer request.
  socket.on('deny-host', (data) => {
    const { requestId } = data;
    if (pendingRequests[requestId]) {
      const { timeout, requester } = pendingRequests[requestId];
      clearTimeout(timeout);
      console.log(`Host ${socket.id} denied host transfer request ${requestId} from ${requester}`);
      io.to(requester).emit('transfer-denied', { requestId });
      delete pendingRequests[requestId];
    }
  });

  // Allow the host to voluntarily relinquish the host role.
  socket.on('give-up-host', () => {
    if (socket.id === hostSocketId) {
      console.log(`Host ${socket.id} has given up the host role.`);
      hostSocketId = null;
      io.emit('host-changed', { hostSocketId: null });
    }
  });

  // Model transform updates from the host.
  socket.on('model-transform', (modelState) => {
    console.log("Received model-transform from socket:", socket.id, modelState);
    if (socket.id === hostSocketId) {
      console.log("Broadcasting model-transform update for", modelState.customId);
      // Broadcast the model transform update to all clients except the host.
      socket.broadcast.emit('model-transform', modelState);
    } else {
      console.log(`Ignoring model-transform event from non-host: ${socket.id}`);
    }
  });

  // NEW: Camera update events from the host.
  socket.on('camera-update', (cameraState) => {
    console.log("Received camera-update from socket:", socket.id, cameraState);
    if (socket.id === hostSocketId) {
      console.log("Broadcasting camera-update event from host");
      socket.broadcast.emit('camera-update', cameraState);
    } else {
      console.log("Ignoring camera-update event from non-host:", socket.id);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    if (socket.id === hostSocketId) {
      console.log(`Host ${socket.id} disconnected.`);
      hostSocketId = null;
      io.emit('host-changed', { hostSocketId: null });
    }
    // Clean up any pending requests related to the disconnected socket.
    for (const reqId in pendingRequests) {
      if (pendingRequests[reqId].requester === socket.id) {
        clearTimeout(pendingRequests[reqId].timeout);
        delete pendingRequests[reqId];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
