import { EmbedBuilder } from 'discord.js';

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
  private static responses: AutoResponse[] = [
    {
      trigger: 'hallo',
      response: 'Hallo! Wie kann ich dir helfen?',
      isEmbed: false
    },
    {
      trigger: 'help',
      response: '',
      embedResponse: {
        title: '🤖 Bot Hilfe',
        description: 'Verfügbare Befehle:\n\n`/ticket create` - Erstelle ein Ticket\n`/embed` - Erstelle ein Embed\n`/autoresponse` - Verwalte automatische Antworten',
        color: 0x00AE86
      },
      isEmbed: true
    },
    {
      trigger: 'danke',
      response: 'Gerne! 😊',
      isEmbed: false
    }
  ];

  static addResponse(trigger: string, response: string, isEmbed: boolean = false, embedOptions?: any) {
    const newResponse: AutoResponse = {
      trigger: trigger.toLowerCase(),
      response,
      isEmbed,
      embedResponse: embedOptions
    };
    
    this.responses.push(newResponse);
  }

  static removeResponse(trigger: string) {
    this.responses = this.responses.filter(r => r.trigger !== trigger.toLowerCase());
  }

  static getResponse(message: string) {
    const lowerMessage = message.toLowerCase();
    return this.responses.find(r => lowerMessage.includes(r.trigger));
  }

  static getAllResponses() {
    return this.responses;
  }

  static createResponseEmbed(response: AutoResponse) {
    if (!response.isEmbed || !response.embedResponse) return null;
    
    return new EmbedBuilder()
      .setTitle(response.embedResponse.title || 'Automatische Antwort')
      .setDescription(response.embedResponse.description || response.response)
      .setColor(response.embedResponse.color || 0x00AE86)
      .setTimestamp();
  }
}
