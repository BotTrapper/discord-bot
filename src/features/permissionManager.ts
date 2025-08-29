import { PermissionFlagsBits } from 'discord.js';

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
      canUseEmbedBuilder: true
    };
  }

  static getModeratorPermissions(): UserPermissions {
    return {
      canManageTickets: true,
      canManageAutoResponses: false,
      canManageWebhooks: false,
      canViewStats: true,
      canUseEmbedBuilder: true
    };
  }

  static getAdminPermissions(): UserPermissions {
    return {
      canManageTickets: true,
      canManageAutoResponses: true,
      canManageWebhooks: true,
      canViewStats: true,
      canUseEmbedBuilder: true
    };
  }

  static hasPermission(interaction: any, requiredPermission: keyof UserPermissions): boolean {
    const member = interaction.member;
    
    // Bot owner always has all permissions
    if (member.id === interaction.client.application.owner?.id) {
      return true;
    }

    // Administrator always has all permissions
    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
      return true;
    }

    // Check specific permissions based on roles
    const permissions = this.getUserPermissions(member);
    return permissions[requiredPermission];
  }

  static getUserPermissions(member: any): UserPermissions {
    // Administrator
    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
      return this.getAdminPermissions();
    }

    // Moderator (has ManageMessages or ManageChannels)
    if (member.permissions.has(PermissionFlagsBits.ManageMessages) || 
        member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return this.getModeratorPermissions();
    }

    // Default user
    return this.getDefaultPermissions();
  }

  static checkCommandPermission(interaction: any, commandName: string): boolean {
    switch (commandName) {
      case 'ticket':
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'create') {
          return true; // Everyone can create tickets
        }
        return this.hasPermission(interaction, 'canManageTickets');

      case 'autoresponse':
        return this.hasPermission(interaction, 'canManageAutoResponses');

      case 'webhook':
        return this.hasPermission(interaction, 'canManageWebhooks');

      case 'stats':
        return this.hasPermission(interaction, 'canViewStats');

      case 'embed':
        return this.hasPermission(interaction, 'canUseEmbedBuilder');

      default:
        return true;
    }
  }
}
