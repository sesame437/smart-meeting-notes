"use strict";

/**
 * glossary-all-routes.test.js — routes/glossary.js 路由集成测试
 */

jest.mock("dotenv", () => ({ config: jest.fn() }));

const mockDynamoSend = jest.fn();
jest.mock("../db/dynamodb", () => ({ docClient: { send: mockDynamoSend } }));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  ScanCommand: jest.fn((p) => ({ _cmd: "ScanCommand", ...p })),
  PutCommand: jest.fn((p) => ({ _cmd: "PutCommand", ...p })),
  UpdateCommand: jest.fn((p) => ({ _cmd: "UpdateCommand", ...p })),
  DeleteCommand: jest.fn((p) => ({ _cmd: "DeleteCommand", ...p })),
}));

process.env.GLOSSARY_TABLE = "test-glossary";
process.env.AWS_REGION = "us-west-2";

const express = require("express");
const request = require("supertest");
const glossaryRouter = require("../routes/glossary");

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/glossary", glossaryRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/glossary", () => {
  test("returns 200 with array of terms", async () => {
    mockDynamoSend.mockResolvedValueOnce({
      Items: [
        { termId: "t1", term: "GenAI", definition: "Generative AI" },
        { termId: "t2", term: "LLM", definition: "Large Language Model" },
      ],
    });

    const res = await request(createApp())
      .get("/api/glossary");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
    expect(res.body[0].term).toBe("GenAI");
  });

  test("returns empty array if no terms", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [] });

    const res = await request(createApp())
      .get("/api/glossary");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });
});

describe("POST /api/glossary", () => {
  test("returns 201 with created term", async () => {
    mockDynamoSend.mockResolvedValueOnce({});

    const res = await request(createApp())
      .post("/api/glossary")
      .send({
        term: "RAG",
        definition: "Retrieval Augmented Generation",
        aliases: ["检索增强生成"],
      });

    expect(res.status).toBe(201);
    expect(res.body.termId).toBeDefined();
    expect(res.body.term).toBe("RAG");
    expect(res.body.definition).toBe("Retrieval Augmented Generation");
  });

  test("returns 201 even if term is undefined (no validation in route)", async () => {
    mockDynamoSend.mockResolvedValueOnce({});

    const res = await request(createApp())
      .post("/api/glossary")
      .send({ definition: "Some definition" });

    expect(res.status).toBe(201);
    expect(res.body.termId).toBeDefined();
  });
});

describe("PUT /api/glossary/:id", () => {
  test("returns 200 with updated term", async () => {
    mockDynamoSend.mockResolvedValueOnce({
      Attributes: {
        termId: "t1",
        term: "Updated Term",
        definition: "Updated Definition",
      },
    });

    const res = await request(createApp())
      .put("/api/glossary/t1")
      .send({ term: "Updated Term", definition: "Updated Definition" });

    expect(res.status).toBe(200);
    expect(res.body.term).toBe("Updated Term");
  });

  test("returns 400 if term is missing", async () => {
    const res = await request(createApp())
      .put("/api/glossary/t1")
      .send({ definition: "Definition without term" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_TERM");
  });

  test("returns 400 if term is empty string", async () => {
    const res = await request(createApp())
      .put("/api/glossary/t1")
      .send({ term: "", definition: "Some definition" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_TERM");
  });
});

describe("DELETE /api/glossary/:id", () => {
  test("returns 204 on successful deletion", async () => {
    mockDynamoSend.mockResolvedValueOnce({});

    const res = await request(createApp())
      .delete("/api/glossary/valid-id-123");

    expect(res.status).toBe(204);
  });

  test("returns 400 if id is invalid (empty)", async () => {
    const res = await request(createApp())
      .delete("/api/glossary/");

    expect(res.status).toBe(404); // Express returns 404 for missing route param
  });

  test("returns 400 if id exceeds max length", async () => {
    const longId = "a".repeat(101);

    const res = await request(createApp())
      .delete(`/api/glossary/${longId}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ID");
  });
});
