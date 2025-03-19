"use strict";

// Load environment variables from .env immediately.
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Ensure the uploads folder exists.
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Serve static files from 'public' folder.
app.use(express.static('public'));

// Serve files from the uploads folder.
app.use('/uploads', express.static(uploadDir));

// Configure Multer for file uploads, keeping the original filename.
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});
const upload = multer({ storage: storage });

// Global state for host management and pending requests.
let hostSocketId = null;
let pendingRequests = {}; // { requestId: { timeout: TimeoutObject, requester: socketId } }

// Buffer for host uploads keyed by their socket ID.
let hostUploadBuffers = {};

// File Upload Endpoint.
app.post('/upload', upload.single('model'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // Construct the base URL from the environment variable or fallback to request host.
  const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  console.log("Using baseUrl:", baseUrl);

  const fileUrl = `${baseUrl}/uploads/${req.file.filename}`;

  // Extract uploader's socket id and role from custom headers.
  const uploaderId = req.headers['x-socket-id'];
  const uploaderRole = req.headers['x-uploader-role'] || 'viewer';

  // Buffer the file if the uploader is a host.
  if (uploaderRole === 'host' && uploaderId) {
    if (!hostUploadBuffers[uploaderId]) {
      hostUploadBuffers[uploaderId] = [];
    }
    hostUploadBuffers[uploaderId].push({
      url: fileUrl,
      name: req.file.originalname,
      id: uuidv4(),
      sender: uploaderId
    });
    console.log(`Buffered upload for host ${uploaderId}: ${req.file.originalname}`);
  } else {
    console.log("Viewer upload detected; not broadcasting upload to other clients.");
  }

  res.json({ url: fileUrl, name: req.file.originalname });
});

// Socket communication.
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('register-host', () => {
    console.log(`register-host from ${socket.id}`);
    hostSocketId = socket.id;
    io.emit('host-changed', { hostSocketId });
  });

  socket.on('request-host', () => {
    console.log(`request-host from ${socket.id}`);
    if (!hostSocketId) {
      hostSocketId = socket.id;
      io.emit('host-changed', { hostSocketId });
    } else if (hostSocketId === socket.id) {
      console.log(`Socket ${socket.id} is already the host.`);
    } else {
      const requestId = uuidv4();
      const timeout = setTimeout(() => {
        console.log(`Auto transferring host role to ${socket.id} for request ${requestId}`);
        hostSocketId = socket.id;
        io.emit('host-changed', { hostSocketId });
        delete pendingRequests[requestId];
      }, 30000);
      pendingRequests[requestId] = { timeout, requester: socket.id };
      io.to(hostSocketId).emit('host-transfer-request', { requestId, requester: socket.id });
    }
  });

  socket.on('release-host', (data) => {
    const { requestId } = data;
    if (pendingRequests[requestId]) {
      const { timeout, requester } = pendingRequests[requestId];
      clearTimeout(timeout);
      hostSocketId = requester;
      io.emit('host-changed', { hostSocketId });
      delete pendingRequests[requestId];
    }
  });

  socket.on('deny-host', (data) => {
    const { requestId } = data;
    if (pendingRequests[requestId]) {
      const { timeout, requester } = pendingRequests[requestId];
      clearTimeout(timeout);
      io.to(requester).emit('transfer-denied', { requestId });
      delete pendingRequests[requestId];
    }
  });

  socket.on('cancel-host-request', () => {
    console.log(`Received cancel-host-request from ${socket.id}`);
    let found = false;
    for (const reqId in pendingRequests) {
      if (pendingRequests[reqId].requester === socket.id) {
        console.log(`Found pending request ${reqId} for ${socket.id}`);
        clearTimeout(pendingRequests[reqId].timeout);
        delete pendingRequests[reqId];
        found = true;
        // Emit the cancellation event to the current host.
        if (hostSocketId) {
          io.to(hostSocketId).emit('host-request-cancelled', { requestId: reqId });
        }
      }
    }
    if (!found) {
      console.log(`No pending host request found for ${socket.id}`);
    }
  });

  socket.on('give-up-host', () => {
    if (socket.id === hostSocketId) {
      hostSocketId = null;
      io.emit('host-changed', { hostSocketId: null });
    }
  });

  socket.on('model-transform', (modelState) => {
    if (socket.id === hostSocketId) {
      socket.broadcast.emit('model-transform', modelState);
    }
  });
  
  socket.on('camera-update', (cameraState) => {
    if (socket.id === hostSocketId) {
      socket.broadcast.emit('camera-update', cameraState);
    }
  });
  
  socket.on('reset-all', (resetAll) => {
    if (socket.id === hostSocketId) {
      socket.broadcast.emit('reset-all', resetAll);
    }
  });

  // When the host signals the upload is complete,
  // broadcast the aggregated product information.
  socket.on('product-upload-complete', () => {
    const uploaderId = socket.id;
    const partsBuffer = hostUploadBuffers[uploaderId] || [];
    if (partsBuffer.length > 0) {
      console.log(`Broadcasting complete product for host ${uploaderId}`);
      io.emit('product-upload-complete', {
        parts: partsBuffer,
        sender: uploaderId
      });
      // Clear the buffer once broadcast is complete.
      hostUploadBuffers[uploaderId] = [];
    } else {
      console.log(`No buffered parts found for host ${uploaderId}`);
    }
  });

  //
  // --- Pointer Broadcasting Logic ---
  //
  // Relay the pointer toggle event.
  socket.on('host-pointer-toggle', (data) => {
    socket.broadcast.emit('host-pointer-toggle', data);
  });
  // Relay the pointer position update.
  socket.on('host-pointer-update', (data) => {
    socket.broadcast.emit('host-pointer-update', data);
  });

  socket.on('disconnect', () => {
    if (socket.id === hostSocketId) {
      hostSocketId = null;
      io.emit('host-changed', { hostSocketId: null });
    }
    for (const reqId in pendingRequests) {
      if (pendingRequests[reqId].requester === socket.id) {
        clearTimeout(pendingRequests[reqId].timeout);
        delete pendingRequests[reqId];
      }
    }
  });
});

// Start the server.
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});