import { PermissionFlagsBits } from "discord.js";
import { dbManager } from "../database/database.js";

export interface UserPermissions {
  canManageTickets: boolean;
  canManageAutoResponses: boolean;
  canViewStats: boolean;
  canUseEmbedBuilder: boolean;
  canManagePermissions: boolean;
  canManageAutoRoles: boolean;
}

export class PermissionManager {
  static getDefaultPermissions(): UserPermissions {
    return {
      canManageTickets: false,
      canManageAutoResponses: false,
      canViewStats: false,
      canUseEmbedBuilder: true,
      canManagePermissions: false,
      canManageAutoRoles: false,
    };
  }

  static getModeratorPermissions(): UserPermissions {
    return {
      canManageTickets: true,
      canManageAutoResponses: false,
      canViewStats: true,
      canUseEmbedBuilder: true,
      canManagePermissions: false,
      canManageAutoRoles: false,
    };
  }

  static getAdminPermissions(): UserPermissions {
    return {
      canManageTickets: true,
      canManageAutoResponses: true,
      canViewStats: true,
      canUseEmbedBuilder: true,
      canManagePermissions: true,
      canManageAutoRoles: true,
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

    // Server owner always has all permissions
    if (interaction.guild?.ownerId === userId) {
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
    const guildId = interaction.guild?.id;
    const userId = interaction.user.id;
    const member = interaction.member;

    if (!guildId || !member) {
      return false;
    }

    // Server owners always have access
    if (interaction.guild.ownerId === userId) {
      return true;
    }

    // Global admins always have access
    const { isAdmin } = await this.isGlobalAdmin(userId);
    if (isAdmin) {
      return true;
    }

    // Check role-based command permissions first
    const userRoles = member.roles.cache
      ? Array.from(member.roles.cache.keys())
      : [];

    try {
      const { allowed, denied } = await dbManager.getUserAllowedCommands(
        guildId,
        userId,
        userRoles as string[],
      );

      // If command is explicitly denied, block access
      if (denied.includes(commandName)) {
        return false;
      }

      // If command is explicitly allowed, grant access
      if (allowed.includes(commandName)) {
        return true;
      }
    } catch (error) {
      console.error("Error checking command permissions:", error);
      // Fall back to legacy permission system if command permissions fail
    }

    // Fall back to legacy permission-based system
    switch (commandName) {
      case "ticket":
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === "create") {
          return true; // Everyone can create tickets
        }
        return await this.hasPermission(interaction, "canManageTickets");

      case "autoresponse":
        return await this.hasPermission(interaction, "canManageAutoResponses");

      case "stats":
        return await this.hasPermission(interaction, "canViewStats");

      case "embed":
        return await this.hasPermission(interaction, "canUseEmbedBuilder");

      default:
        return true;
    }
  }
}
