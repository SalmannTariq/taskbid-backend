import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";

let io: Server | null = null;

function allowedOrigins() {
  return (process.env.CORS_WHITELIST ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export const initSocket = (server: HttpServer) => {
  io = new Server(server, {
    cors: {
      origin: allowedOrigins(),
      credentials: true,
    },
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
