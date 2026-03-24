import { FastifyPluginAsync } from "fastify";
import { PlayerEvent } from "../sessions/sessions.types";
import { eventQueue } from "./events.queue";
import { postEventSchema } from "./events.schema";
import { getActiveViewerCount } from "../sessions/sessions.store";

/** Fastify plugin that registers event ingestion and viewer count routes. */
const eventsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: PlayerEvent }>(
    "/events",
    { schema: postEventSchema },
    async (request, reply) => {
      const event: PlayerEvent = {
        ...request.body,
        receivedAt: new Date().toISOString(),
      };
      eventQueue.enqueue(event);
      return reply.status(202).send({ accepted: true });
    }
  );

  fastify.get<{ Params: { sportingEventId: string } }>(
    "/events/:sportingEventId/viewers",
    async (request) => {
      const { sportingEventId } = request.params;
      return {
        eventId: sportingEventId,
        activeViewers: getActiveViewerCount(sportingEventId),
      };
    }
  );
};

export default eventsRoutes;