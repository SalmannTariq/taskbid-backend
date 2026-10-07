import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { Auth_Cookie, verifyAuthToken } from "./lib/auth";

let io: Server | null = null;

function allowedOrigins() {
  return (process.env.CORS_WHITELIST ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function cookieValue(header: string | undefined, name: string) {
  if (!header) return null;
  for (const piece of header.split(";")) {
    const trimmed = piece.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return null;
}

export const initSocket = (server: HttpServer) => {
  io = new Server(server, {
    cors: {
      origin: allowedOrigins(),
      credentials: true,
    },
  });

  io.use((socket, next) => {
    const token = cookieValue(socket.handshake.headers.cookie, Auth_Cookie);
    if (!token) {
      next(new Error("unauthorized"));
      return;
    }
    try {
      verifyAuthToken(token);
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    console.log("User connected", socket.id);
    socket.on("disconnect", () => {
      console.log("User disconnected", socket.id);
    });
  });

  return io;
};

export function publishChange(taskId: number) {
  io?.emit("changed", { taskId });
}
