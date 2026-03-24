import { buildApp } from "./app";

const server = buildApp({ logger: true });

const start = async () => {
  await server.listen({ port: 3000, host: "127.0.0.1" });
};

start();
