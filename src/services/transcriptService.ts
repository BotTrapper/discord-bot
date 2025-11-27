import type { TextChannel } from "discord.js";
import { TRANSCRIPT_MESSAGE_LIMIT } from "../config/constants.js";

/**
 * Generate a channel transcript as JSON
 * @param channel - The Discord channel to generate transcript for
 * @returns JSON string with transcript data
 */
export async function generateChannelTranscript(channel: TextChannel): Promise<string> {
  try {
    console.log(`🔄 Generating transcript for channel ${channel.name}...`);

    // Fetch all messages from the channel
    const messages: any[] = [];
    let lastMessageId: string | undefined;

    // Discord API allows fetching max 100 messages per request
    while (true) {
      const options: { limit: number; before?: string } = { limit: 100 };
      if (lastMessageId) {
        options.before = lastMessageId;
      }

      const fetchedMessages = await channel.messages.fetch(options);

      if (fetchedMessages.size === 0) {
        break;
      }

      messages.push(...Array.from(fetchedMessages.values()));
      lastMessageId = fetchedMessages.last()?.id;

      // Safety limit to prevent infinite loops or extremely large transcripts
      if (messages.length > TRANSCRIPT_MESSAGE_LIMIT) {
        console.log(
          `⚠️ Transcript limited to ${TRANSCRIPT_MESSAGE_LIMIT} messages for channel ${channel.name}`,
        );
        break;
      }
    }

    // Sort messages by creation time (oldest first)
    messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    // Create a member cache for ID resolution
    const memberCache = new Map();
    try {
      // Fetch guild members for ID resolution
      if (channel.guild) {
        const members = await channel.guild.members.fetch();
        members.forEach((member: any) => {
          memberCache.set(member.id, {
            username: member.user.username,
            displayName: member.displayName,
            nickname: member.nickname,
          });
        });
        console.log(`✅ Cached ${memberCache.size} members for ID resolution`);
      }
    } catch (memberError) {
      console.warn(
        "⚠️ Could not fetch guild members for ID resolution:",
        memberError,
      );
    }

    // Function to resolve mentions in text
    const resolveMentions = (text: string): string => {
      if (!text) return text;

      // Resolve user mentions <@123123> and <@!123123>
      text = text.replace(/<@!?(\d+)>/g, (match, userId) => {
        const member = memberCache.get(userId);
        if (member) {
          return `@${member.displayName || member.username}`;
        }
        return match; // Keep original if not found
      });

      // Resolve channel mentions <#123123>
      text = text.replace(/<#(\d+)>/g, (match, channelId) => {
        if (channel.guild) {
          const mentionedChannel = channel.guild.channels.cache.get(channelId);
          if (mentionedChannel) {
            return `#${mentionedChannel.name}`;
          }
        }
        return match; // Keep original if not found
      });

      // Resolve role mentions <@&123123>
      text = text.replace(/<@&(\d+)>/g, (match, roleId) => {
        if (channel.guild) {
          const role = channel.guild.roles.cache.get(roleId);
          if (role) {
            return `@${role.name}`;
          }
        }
        return match; // Keep original if not found
      });

      return text;
    };

    // Generate structured transcript data as JSON
    const transcriptData = {
      header: {
        channelName: channel.name,
        channelId: channel.id,
        guildName: channel.guild?.name,
        generated: new Date().toISOString(),
        totalMessages: messages.length,
        memberCount: memberCache.size,
      },
      messages: messages.map((message) => ({
        id: message.id,
        timestamp: message.createdAt.toISOString(),
        author: {
          id: message.author.id,
          username: message.author.username,
          discriminator: message.author.discriminator,
          avatar: message.author.avatar,
          bot: message.author.bot,
          displayName: message.member?.displayName || message.author.username,
        },
        content: resolveMentions(message.content), // Resolve mentions in content
        attachments: message.attachments.map((attachment: any) => ({
          id: attachment.id,
          name: attachment.name,
          url: attachment.url,
          proxyUrl: attachment.proxyUrl,
          size: attachment.size,
          contentType: attachment.contentType,
          width: attachment.width,
          height: attachment.height,
        })),
        embeds: message.embeds.map((embed: any) => ({
          title: embed.title ? resolveMentions(embed.title) : undefined,
          description: embed.description
            ? resolveMentions(embed.description)
            : undefined,
          url: embed.url,
          color: embed.color,
          timestamp: embed.timestamp,
          footer: embed.footer
            ? {
                text: resolveMentions(embed.footer.text),
                iconURL: embed.footer.iconURL,
              }
            : undefined,
          image: embed.image,
          thumbnail: embed.thumbnail,
          author: embed.author
            ? {
                name: resolveMentions(embed.author.name),
                url: embed.author.url,
                iconURL: embed.author.iconURL,
              }
            : undefined,
          fields: embed.fields?.map((field: any) => ({
            name: resolveMentions(field.name),
            value: resolveMentions(field.value),
            inline: field.inline,
          })),
        })),
        reactions: message.reactions.cache.map((reaction: any) => ({
          emoji: {
            name: reaction.emoji.name,
            id: reaction.emoji.id,
            animated: reaction.emoji.animated,
          },
          count: reaction.count,
        })),
        edited: message.editedTimestamp ? message.editedAt.toISOString() : null,
        pinned: message.pinned,
        type: message.type,
      })),
    };

    console.log(
      `✅ Generated structured transcript with ${messages.length} messages for channel ${channel.name}`,
    );
    console.log(
      `✅ Resolved mentions using ${memberCache.size} cached members`,
    );
    return JSON.stringify(transcriptData, null, 2);
  } catch (error) {
    console.error("Error generating transcript:", error);

    // Return a basic error transcript rather than failing completely
    const errorData = {
      header: {
        channelName: channel?.name || "Unknown",
        error: error instanceof Error ? error.message : "Unknown error",
        generated: new Date().toISOString(),
      },
      messages: [],
    };

    return JSON.stringify(errorData, null, 2);
  }
}
