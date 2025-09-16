import { EmbedBuilder } from "discord.js";
import { dbManager } from "../database/database.js";

interface AutoResponse {
  trigger: string;
  response: string;
  embedResponse?: {
    title?: string;
    description?: string;
    color?: number;
  };
  isEmbed: boolean;
}

export class AutoResponseFeature {
  // Default responses that will be added to database if they don't exist
  private static defaultResponses: AutoResponse[] = [
    {
      trigger: "hallo",
      response: "Hallo! Wie kann ich dir helfen?",
      isEmbed: false,
    },
    {
      trigger: "help",
      response: "",
      embedResponse: {
        title: "🤖 Bot Hilfe",
        description:
          "Verfügbare Befehle:\n\n`/ticket create` - Erstelle ein Ticket\n`/embed` - Erstelle ein Embed\n`/autoresponse` - Verwalte automatische Antworten",
        color: 0x00ae86,
      },
      isEmbed: true,
    },
    {
      trigger: "danke",
      response: "Gerne! 😊",
      isEmbed: false,
    },
  ];

  // Initialize default responses in database for a guild
  static async initializeDefaultResponses(guildId: string) {
    try {
      const existingResponses = (await dbManager.getAutoResponses(
        guildId,
      )) as any[];

      // Add default responses if none exist
      if (existingResponses.length === 0) {
        for (const response of this.defaultResponses) {
          const addData: any = {
            trigger: response.trigger,
            response: response.response,
            isEmbed: response.isEmbed,
            guildId,
          };

          if (response.embedResponse) {
            addData.embedTitle = response.embedResponse.title;
            addData.embedDescription = response.embedResponse.description;
            addData.embedColor = response.embedResponse.color;
          }

          await dbManager.addAutoResponse(addData);
        }
        console.log(
          `✅ Default auto responses initialized for guild ${guildId}`,
        );
      }
    } catch (error) {
      console.error("Error initializing default responses:", error);
    }
  }

  static async addResponse(
    guildId: string,
    trigger: string,
    response: string,
    isEmbed: boolean = false,
    embedOptions?: any,
  ) {
    try {
      await dbManager.addAutoResponse({
        trigger: trigger.toLowerCase(),
        response,
        isEmbed,
        embedTitle: embedOptions?.title,
        embedDescription: embedOptions?.description,
        embedColor: embedOptions?.color,
        guildId,
      });
      return true;
    } catch (error) {
      console.error("Error adding auto response:", error);
      return false;
    }
  }

  static async removeResponse(trigger: string, guildId: string) {
    try {
      await dbManager.removeAutoResponse(trigger, guildId);
      return true;
    } catch (error) {
      console.error("Error removing auto response:", error);
      return false;
    }
  }

  static async getResponse(message: string, guildId: string) {
    try {
      const responses = (await dbManager.getAutoResponses(guildId)) as any[];
      const lowerMessage = message.toLowerCase();
      return responses.find((r) =>
        lowerMessage.includes(r.trigger_word.toLowerCase()),
      );
    } catch (error) {
      console.error("Error getting auto response:", error);
      return null;
    }
  }

  static async getAllResponses(guildId: string) {
    try {
      return await dbManager.getAutoResponses(guildId);
    } catch (error) {
      console.error("Error getting all responses:", error);
      return [];
    }
  }

  static createResponseEmbed(response: AutoResponse) {
    if (!response.isEmbed || !response.embedResponse) return null;

    return new EmbedBuilder()
      .setTitle(response.embedResponse.title || "Automatische Antwort")
      .setDescription(response.embedResponse.description || response.response)
      .setColor(response.embedResponse.color || 0x00ae86)
      .setTimestamp();
  }
}
