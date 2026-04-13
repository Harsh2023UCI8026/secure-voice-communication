const socket = io();

let roomId = "";
let mediaRecorder;
let audioChunks = [];

let publicKey, privateKey;
let receiverPublicKey = null;
let receivedAudio = null;

// ------------------ SAFE BASE64 ------------------

function bufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;

    for (let i = 0; i < bytes.length; i += chunkSize) {
        const subarray = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, subarray);
    }

    return window.btoa(binary);
}

function base64ToBuffer(base64) {
    const binary = window.atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);

    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes.buffer;
}

// ------------------ JOIN ROOM ------------------

function joinRoom() {
    roomId = document.getElementById("roomInput").value;

    if (!roomId) {
        alert("Enter room ID!");
        return;
    }

    socket.emit("joinRoom", roomId);
    document.getElementById("status").innerText = "Joined: " + roomId;

    console.log(" Joining:", roomId);

    generateKeys();
}

// ------------------ RSA ------------------

async function generateKeys() {
    const keys = await crypto.subtle.generateKey(
        {
            name: "RSA-OAEP",
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-256",
        },
        true,
        ["encrypt", "decrypt"]
    );

    publicKey = keys.publicKey;
    privateKey = keys.privateKey;

    const exported = await crypto.subtle.exportKey("spki", publicKey);

    socket.emit("sendPublicKey", {
        roomId,
        publicKey: bufferToBase64(exported)
    });

    console.log("🔑 RSA ready");
}

socket.on("receivePublicKey", async ({ publicKey }) => {
    const keyBuffer = base64ToBuffer(publicKey);

    receiverPublicKey = await crypto.subtle.importKey(
        "spki",
        keyBuffer,
        { name: "RSA-OAEP", hash: "SHA-256" },
        true,
        ["encrypt"]
    );

    console.log(" Receiver ready");
});

// ------------------ RECORD ------------------

async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus"
    });

    audioChunks = [];

    mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) {
            audioChunks.push(e.data);
        }
    };

    mediaRecorder.start();
    console.log("🎙 Recording...");
}

function stopRecording() {
    if (!mediaRecorder) return;

    mediaRecorder.stop();

    mediaRecorder.onstop = async () => {
        console.log(" Recording stopped");

        const blob = new Blob(audioChunks, {
            type: "audio/webm;codecs=opus"
        });

        const buffer = await blob.arrayBuffer();

        console.log(" Audio size:", buffer.byteLength);

        await encryptAudio(buffer);
    };
}

// ------------------ ENCRYPT ------------------

async function encryptAudio(buffer) {

    if (!receiverPublicKey) {
        alert(" Receiver not ready!");
        return;
    }

    const aesKey = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt"]
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encryptedAudioBuffer = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        aesKey,
        buffer
    );

    const exportedAES = await crypto.subtle.exportKey("raw", aesKey);

    const encryptedAESKeyBuffer = await crypto.subtle.encrypt(
        { name: "RSA-OAEP" },
        receiverPublicKey,
        exportedAES
    );

    const payload = {
        encryptedAudio: bufferToBase64(encryptedAudioBuffer),
        encryptedAESKey: bufferToBase64(encryptedAESKeyBuffer),
        iv: bufferToBase64(iv)
    };

    window.payload = payload;

    //  FULL ENCRYPTED DATA SHOW
    document.getElementById("output").value =
        JSON.stringify(payload, null, 2);

    console.log(" Payload ready");
}

// ------------------ SEND ------------------

function sendAudio() {
    if (!window.payload) {
        alert(" Record first!");
        return;
    }

    console.log(" Sending to room:", roomId);

    socket.emit("sendEncryptedAudio", {
        roomId,
        ...window.payload
    });

    console.log(" Sent");
}

// ------------------ RECEIVE ------------------

socket.on("receiveEncryptedAudio", async (data) => {
    console.log(" RECEIVED", data);

    const { encryptedAudio, encryptedAESKey, iv } = data;

    try {
        const decryptedKey = await crypto.subtle.decrypt(
            { name: "RSA-OAEP" },
            privateKey,
            base64ToBuffer(encryptedAESKey)
        );

        const aesKey = await crypto.subtle.importKey(
            "raw",
            decryptedKey,
            { name: "AES-GCM" },
            false,
            ["decrypt"]
        );

        const decryptedAudioBuffer = await crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: new Uint8Array(base64ToBuffer(iv))
            },
            aesKey,
            base64ToBuffer(encryptedAudio)
        );

        console.log(" Decryption success");
        console.log("Decrypted size:", decryptedAudioBuffer.byteLength);

        const blob = new Blob([decryptedAudioBuffer], {
            type: "audio/webm"
        });

        const url = URL.createObjectURL(blob);

        console.log(" Audio URL:", url);

        const audio = document.createElement("audio");
        audio.src = url;
        audio.controls = true;

        audio.onloadedmetadata = () => {
            console.log(" Duration:", audio.duration);
        };

        const container = document.getElementById("audioContainer");

        if (container) {
            container.innerHTML = "";
            container.appendChild(audio);
        } else {
            console.error(" audioContainer not found");
        }

        receivedAudio = audio;

        console.log(" Audio ready");

    } catch (err) {
        console.error(" Decryption error:", err);
    }
});

// ------------------ PLAY ------------------

document.getElementById("playBtn").onclick = async () => {
    if (!receivedAudio) {
        alert(" No audio received!");
        return;
    }

    try {
        receivedAudio.currentTime = 0;
        await receivedAudio.play();
        console.log("🔊 Playing...");
    } catch (err) {
        console.error("❌ Play failed:", err);
    }
};
