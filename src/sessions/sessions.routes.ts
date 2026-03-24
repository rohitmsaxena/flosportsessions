import { FastifyPluginAsync } from "fastify";
import { getSession } from "./sessions.store";

/** Fastify plugin that registers session query routes. */
const sessionsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId",
    async (request, reply) => {
      const { sessionId } = request.params;
      const session = getSession(sessionId);

      if (!session) {
        return reply.status(404).send({ error: "Session not found", sessionId });
      }

      return reply.send(session);
    }
  );
};

export default sessionsRoutes;