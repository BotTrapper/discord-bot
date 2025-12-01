import { jest, describe, it, expect, beforeEach, beforeAll } from "@jest/globals";

// Simple tests for NotificationManager that test the basic API
describe("NotificationManager", () => {
  let notificationManager: any;
  let mockDiscordClient: any;
  let mockChannel: any;

  beforeAll(async () => {
    // Import NotificationManager dynamically
    const { NotificationManager } = await import("../../src/features/notificationManager");
    notificationManager = NotificationManager.getInstance();
  });

  beforeEach(() => {
    // Reset any modifications between tests
    jest.clearAllMocks();

    // Create mock Discord objects
    mockChannel = {
      id: "test-channel-id",
      name: "test-channel",
      send: jest.fn().mockResolvedValue({}),
      permissionOverwrites: {
        cache: new Map(),
        delete: jest.fn(),
        create: jest.fn(),
      },
      permissionsFor: jest.fn().mockReturnValue({
        has: jest.fn().mockReturnValue(true),
      }),
    };

    mockDiscordClient = {
      user: {
        id: "bot-user-id",
        displayAvatarURL: jest.fn().mockReturnValue("https://example.com/avatar.png"),
      },
      guilds: {
        cache: new Map([
          ["test-guild-id", {
            id: "test-guild-id",
            name: "Test Guild",
            ownerId: "owner-id",
            channels: {
              cache: new Map([["test-channel-id", mockChannel]]),
            },
            members: {
              cache: new Map([
                ["bot-user-id", {
                  id: "bot-user-id",
                  permissions: { has: jest.fn().mockReturnValue(true) },
                }],
              ]),
            },
            roles: {
              cache: new Map([
                ["test-role-id", { id: "test-role-id", name: "Test Role" }],
              ]),
              everyone: { id: "everyone-role-id" },
            },
          }],
        ]),
      },
      channels: {
        fetch: jest.fn().mockResolvedValue(mockChannel),
      },
    };
  });

  describe("getInstance", () => {
    it("should return a singleton instance", async () => {
      const { NotificationManager } = await import("../../src/features/notificationManager");
      const instance1 = NotificationManager.getInstance();
      const instance2 = NotificationManager.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe("setDiscordClient", () => {
    it("should accept a Discord client without throwing", () => {
      expect(() => {
        notificationManager.setDiscordClient(mockDiscordClient);
      }).not.toThrow();
    });

    it("should accept null without throwing", () => {
      expect(() => {
        notificationManager.setDiscordClient(null);
      }).not.toThrow();
    });
  });

  describe("sendTestNotification", () => {
    it("should return false when Discord client is not set", async () => {
      // Clear the client
      notificationManager.setDiscordClient(null);
      
      const result = await notificationManager.sendTestNotification("test-guild-id");
      expect(result).toBe(false);
    });
  });

  describe("updateChannelPermissions", () => {
    it("should return false when Discord client is not set", async () => {
      // Clear the client
      notificationManager.setDiscordClient(null);
      
      const result = await notificationManager.updateChannelPermissions("test-guild-id", ["role-id"]);
      expect(result).toBe(false);
    });
  });

  describe("sendVersionNotification", () => {
    it("should not throw when Discord client is not set", async () => {
      // Clear the client
      notificationManager.setDiscordClient(null);
      
      const notification = {
        version: "1.2.0",
        title: "Test Update",
        description: "A test version update",
      };

      await expect(
        notificationManager.sendVersionNotification(notification)
      ).resolves.not.toThrow();
    });

    it("should accept version notification with optional fields", async () => {
      notificationManager.setDiscordClient(null);
      
      const notification = {
        version: "1.2.0",
        title: "Test Update",
        description: "A test version update",
        features: ["Feature 1", "Feature 2"],
        fixes: ["Bug fix 1"],
        color: 0x00ff00,
        link: "https://example.com",
      };

      await expect(
        notificationManager.sendVersionNotification(notification)
      ).resolves.not.toThrow();
    });
  });
});
