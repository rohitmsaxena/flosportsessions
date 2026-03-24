/** Fastify JSON Schema for validating POST /events request body. receivedAt is optional (server stamps it). */
export const postEventSchema = {
  body: {
    type: "object" as const,
    required: [
      "sessionId",
      "userId",
      "eventType",
      "eventId",
      "eventTimestamp",
      "payload",
    ],
    properties: {
      sessionId: { type: "string" },
      userId: { type: "string" },
      eventType: {
        type: "string",
        enum: [
          "start",
          "heartbeat",
          "pause",
          "resume",
          "seek",
          "quality_change",
          "buffer_start",
          "buffer_end",
          "end",
        ],
      },
      eventId: { type: "string" },
      eventTimestamp: { type: "string" },
      receivedAt: { type: "string" },
      payload: {
        type: "object",
        required: ["eventId", "position", "quality"],
        properties: {
          eventId: { type: "string" },
          position: { type: "number" },
          quality: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
};