import { PermissionFlagsBits } from "discord.js";
import { dbManager } from "../database/database.js";

export interface UserPermissions {
  canManageTickets: boolean;
  canManageAutoResponses: boolean;
  canManageWebhooks: boolean;
  canViewStats: boolean;
  canUseEmbedBuilder: boolean;
}

export class PermissionManager {
  static getDefaultPermissions(): UserPermissions {
    return {
      canManageTickets: false,
      canManageAutoResponses: false,
      canManageWebhooks: false,
      canViewStats: false,
      canUseEmbedBuilder: true,
    };
  }

  static getModeratorPermissions(): UserPermissions {
    return {
      canManageTickets: true,
      canManageAutoResponses: false,
      canManageWebhooks: false,
      canViewStats: true,
      canUseEmbedBuilder: true,
    };
  }

  static getAdminPermissions(): UserPermissions {
    return {
      canManageTickets: true,
      canManageAutoResponses: true,
      canManageWebhooks: true,
      canViewStats: true,
      canUseEmbedBuilder: true,
    };
  }

  // Save user permissions to database
  static async setUserPermissions(
    userId: string,
    guildId: string,
    role: string,
    permissions: UserPermissions,
  ) {
    try {
      // Convert UserPermissions object to string array
      const permissionArray = Object.keys(permissions).filter(
        (key) => permissions[key as keyof UserPermissions],
      );
      await dbManager.setUserPermissions(
        userId,
        guildId,
        role,
        permissionArray,
      );
      return true;
    } catch (error) {
      console.error("Error setting user permissions:", error);
      return false;
    }
  }

  // Get user permissions from database
  static async getUserPermissionsFromDB(
    userId: string,
    guildId: string,
  ): Promise<UserPermissions | null> {
    try {
      const userPerm = (await dbManager.getUserPermissions(
        userId,
        guildId,
      )) as any;
      if (userPerm && userPerm.permissions) {
        return JSON.parse(userPerm.permissions);
      }
      return null;
    } catch (error) {
      console.error("Error getting user permissions:", error);
      return null;
    }
  }

  static async hasPermission(
    interaction: any,
    requiredPermission: keyof UserPermissions,
  ): Promise<boolean> {
    const member = interaction.member;
    const userId = member.id || member.user?.id;

    // Check if user is a global admin first
    if (userId) {
      const globalAdminCheck = await dbManager.isGlobalAdmin(userId);
      if (globalAdminCheck.isAdmin) {
        return true; // Global admins have all permissions
      }
    }

    // Bot owner always has all permissions
    if (userId === interaction.client.application.owner?.id) {
      return true;
    }

    // Administrator always has all permissions
    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
      return true;
    }

    // Check database permissions first
    const dbPermissions = await this.getUserPermissionsFromDB(
      userId,
      interaction.guild.id,
    );
    if (dbPermissions) {
      return dbPermissions[requiredPermission];
    }

    // Fall back to role-based permissions
    const permissions = await this.getUserPermissions(member);
    return permissions[requiredPermission];
  }

  static async getUserPermissions(member: any): Promise<UserPermissions> {
    const userId = member.id || member.user?.id;

    // Check if user is a global admin first
    if (userId) {
      const globalAdminCheck = await dbManager.isGlobalAdmin(userId);
      if (globalAdminCheck.isAdmin) {
        return this.getAdminPermissions(); // Global admins get admin permissions
      }
    }

    // Administrator
    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
      return this.getAdminPermissions();
    }

    // Moderator (has ManageMessages or ManageChannels)
    if (
      member.permissions.has(PermissionFlagsBits.ManageMessages) ||
      member.permissions.has(PermissionFlagsBits.ManageChannels)
    ) {
      return this.getModeratorPermissions();
    }

    // Default user
    return this.getDefaultPermissions();
  }

  // Synchronous version for backward compatibility
  static getUserPermissionsSync(member: any): UserPermissions {
    // Administrator
    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
      return this.getAdminPermissions();
    }

    // Moderator (has ManageMessages or ManageChannels)
    if (
      member.permissions.has(PermissionFlagsBits.ManageMessages) ||
      member.permissions.has(PermissionFlagsBits.ManageChannels)
    ) {
      return this.getModeratorPermissions();
    }

    // Default user
    return this.getDefaultPermissions();
  }

  // Check if a user is a global admin
  static async isGlobalAdmin(
    userId: string,
  ): Promise<{ isAdmin: boolean; level: number }> {
    try {
      return await dbManager.isGlobalAdmin(userId);
    } catch (error) {
      console.error("Error checking global admin status:", error);
      return { isAdmin: false, level: 0 };
    }
  }

  static async checkCommandPermission(
    interaction: any,
    commandName: string,
  ): Promise<boolean> {
    switch (commandName) {
      case "ticket":
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === "create") {
          return true; // Everyone can create tickets
        }
        return await this.hasPermission(interaction, "canManageTickets");

      case "autoresponse":
        return await this.hasPermission(interaction, "canManageAutoResponses");

      case "webhook":
        return await this.hasPermission(interaction, "canManageWebhooks");

      case "stats":
        return await this.hasPermission(interaction, "canViewStats");

      case "embed":
        return await this.hasPermission(interaction, "canUseEmbedBuilder");

      default:
        return true;
    }
  }
}
