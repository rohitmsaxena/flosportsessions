import Fastify from "fastify";

const server = Fastify({ logger: true });

server.get("/health", async () => {
  return { status: "ok" };
});

const start = async () => {
  await server.listen({ port: 3000, host: "0.0.0.0" });
};

start();
