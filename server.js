const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const path = require('path');

// Serve static files
app.use(express.static('public'));

// Store host information
let hostSocketId = null;

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Handle host registration
  socket.on('register-host', () => {
    hostSocketId = socket.id;
    socket.broadcast.emit('host-connected');
    console.log('Host registered:', socket.id);
  });

  // Handle camera updates from host
  socket.on('camera-update', (cameraData) => {
    if (socket.id === hostSocketId) {
      socket.broadcast.emit('camera-update', cameraData);
    }
  });

  // Handle model transforms from host
  socket.on('model-transform', (transformData) => {
    if (socket.id === hostSocketId) {
      socket.broadcast.emit('model-transform', transformData);
    }
  });

  // Handle AR pose from host
  socket.on('ar-pose', (poseData) => {
    if (socket.id === hostSocketId) {
      socket.broadcast.emit('ar-pose', poseData);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    if (socket.id === hostSocketId) {
      hostSocketId = null;
      io.emit('host-disconnected');
    }
    console.log('User disconnected:', socket.id);
  });

  socket.on('viewer-upload', (modelData) => {
      // Broadcast the uploaded model to all clients including sender
      io.emit('viewer-upload', modelData);
  });
});

const port = process.env.PORT || 3000;

http.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Trying another port...`);
  }
});

http.listen(port, () => {
  console.log(`Server running on port ${port}`);
});