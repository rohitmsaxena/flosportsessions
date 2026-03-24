import Fastify, { FastifyInstance } from "fastify";
import eventsRoutes from "./events/events.routes";
import sessionsRoutes from "./sessions/sessions.routes";
import { eventQueue } from "./events/events.queue";

/** Creates and configures a Fastify instance with all routes and lifecycle hooks. Does not call listen(). */
export function buildApp(opts = {}): FastifyInstance {
  const app = Fastify(opts);

  app.get("/health", async () => {
    return { status: "ok" };
  });

  app.register(eventsRoutes);
  app.register(sessionsRoutes);

  app.addHook("onReady", async () => {
    eventQueue.startDraining();
  });

  app.addHook("onClose", async () => {
    eventQueue.stopDraining();
  });

  return app;
}