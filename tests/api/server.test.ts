import { describe, it, expect, beforeAll } from "@jest/globals";
import request from "supertest";
import express, { Request, Response } from "express";

// Create a minimal test app that mocks the main server endpoints
const createTestApp = () => {
  const app = express();
  app.use(express.json());

  // Health check endpoint
  app.get("/api/health", (req: Request, res: Response) => {
    res.json({ status: "OK", timestamp: new Date().toISOString() });
  });

  // Version endpoint
  app.get("/api/version", (req: Request, res: Response) => {
    res.json({
      version: "1.1.0",
      name: "discord_bot",
      description: "BotTrapper Discord Bot",
      startTime: new Date().toISOString(),
      uptime: "1h 30m 0s",
    });
  });

  // API v1 version endpoint
  app.get("/api/v1/version", (req: Request, res: Response) => {
    res.json({
      version: "1.1.0",
      name: "discord_bot",
      description: "BotTrapper Discord Bot",
      startTime: new Date().toISOString(),
      uptime: "1h 30m 0s",
    });
  });

  // Changelog endpoint
  app.get("/api/changelog", (req: Request, res: Response) => {
    const changelog = [
      {
        version: "1.1.0",
        date: "2025-09-16",
        type: "minor",
        changes: {
          added: ["Feature 1"],
          changed: ["Change 1"],
          fixed: ["Fix 1"],
          removed: [],
        },
      },
    ];

    const version = req.query.version as string;
    if (version) {
      const entry = changelog.find((e) => e.version === version);
      if (!entry) {
        return res.status(404).json({ error: `Version ${version} not found` });
      }
      return res.json(entry);
    }

    res.json(changelog);
  });

  // Mock auth endpoint
  app.get("/auth/me", (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authentication required" });
    }
    res.json({
      id: "test-user-id",
      username: "testuser",
      discriminator: "1234",
      avatar: null,
      guilds: [],
    });
  });

  // Error handling middleware
  app.use(
    (
      err: Error,
      req: Request,
      res: Response,
      next: express.NextFunction
    ) => {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  );

  return app;
};

describe("API Server", () => {
  let app: express.Express;

  beforeAll(() => {
    app = createTestApp();
  });

  describe("GET /api/health", () => {
    it("should return health status", async () => {
      const response = await request(app).get("/api/health");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status", "OK");
      expect(response.body).toHaveProperty("timestamp");
    });
  });

  describe("GET /api/version", () => {
    it("should return version info", async () => {
      const response = await request(app).get("/api/version");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("version");
      expect(response.body).toHaveProperty("name");
      expect(response.body).toHaveProperty("startTime");
      expect(response.body).toHaveProperty("uptime");
    });
  });

  describe("GET /api/v1/version", () => {
    it("should return version info from v1 endpoint", async () => {
      const response = await request(app).get("/api/v1/version");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("version");
      expect(response.body).toHaveProperty("name");
    });
  });

  describe("GET /api/changelog", () => {
    it("should return full changelog", async () => {
      const response = await request(app).get("/api/changelog");

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0]).toHaveProperty("version");
      expect(response.body[0]).toHaveProperty("date");
      expect(response.body[0]).toHaveProperty("changes");
    });

    it("should return specific version changelog", async () => {
      const response = await request(app).get("/api/changelog?version=1.1.0");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("version", "1.1.0");
    });

    it("should return 404 for non-existent version", async () => {
      const response = await request(app).get("/api/changelog?version=99.99.99");

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty("error");
    });
  });

  describe("GET /auth/me", () => {
    it("should return 401 without authentication", async () => {
      const response = await request(app).get("/auth/me");

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty("error");
    });

    it("should return user info with valid token", async () => {
      const response = await request(app)
        .get("/auth/me")
        .set("Authorization", "Bearer test-token");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("id");
      expect(response.body).toHaveProperty("username");
    });
  });
});
