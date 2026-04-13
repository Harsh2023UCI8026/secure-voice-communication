const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

//  Socket.io with CORS (important for deployment)
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static("public"));

let users = {};

io.on("connection", (socket) => {
    const userId = socket.id;
    console.log(` User connected: ${userId}`);

    users[userId] = { room: null };

    //  Join Room
    socket.on("joinRoom", (roomId) => {
        socket.join(roomId);
        users[userId].room = roomId;

        console.log(` ${userId} joined ${roomId}`);

        socket.to(roomId).emit("userJoined");
    });

    //  Public Key Exchange
    socket.on("sendPublicKey", ({ roomId, publicKey }) => {
        socket.to(roomId).emit("receivePublicKey", {
            sender: userId,
            publicKey
        });
    });

    //  Send Encrypted Audio
    socket.on("sendEncryptedAudio", (data) => {
        const { roomId } = data;

        console.log(" Sending to room:", roomId);

        socket.to(roomId).emit("receiveEncryptedAudio", data);
    });

    //  Disconnect
    socket.on("disconnect", () => {
        console.log(` User disconnected: ${userId}`);
        delete users[userId];
    });
});


//  IMPORTANT: Dynamic PORT (for Render / deployment)
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(` Server running on port ${PORT}`);
});
