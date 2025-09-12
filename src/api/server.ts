import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
// @ts-ignore - No type definitions available
import session from 'express-session';
// @ts-ignore - No type definitions available
import passport from 'passport';
// @ts-ignore - No type definitions available
import { Strategy as DiscordStrategy } from 'passport-discord';
import jwt from 'jsonwebtoken';
import { dbManager } from '../database/database.js';
import { featureManager, type FeatureName } from '../features/featureManager.js';
import type {Client, Snowflake} from 'discord.js';

// Type definitions for untyped modules
interface DiscordProfile {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  guilds?: any[];
}

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username?: string;
        discriminator?: string;
        avatar?: string | null;
        guilds?: any[];
        accessToken?: string;
        refreshToken?: string;
      };
      logout?: (callback: (err?: any) => void) => void;
    }
  }
}

// Request logging middleware
const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  // Log request start
  console.log(`[${timestamp}] ${req.method} ${req.url} - Request started`);

  // Override res.json and res.send to log response
  const originalJson = res.json;
  const originalSend = res.send;

  res.json = function(body: any) {
    const duration = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${res.statusCode} - ${duration}ms`);
    return originalJson.call(this, body);
  };

  res.send = function(body: any) {
    const duration = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${res.statusCode} - ${duration}ms`);
    return originalSend.call(this, body);
  };

  // Log if request takes too long
  const timeoutWarning = setTimeout(() => {
    console.warn(`[WARNING] ${req.method} ${req.url} - Request taking longer than 5 seconds`);
  }, 5000);

  res.on('finish', () => {
    clearTimeout(timeoutWarning);
  });

  next();
};

const app = express();
const PORT = process.env.API_PORT || 3001;

// Environment variables
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Middleware
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true
}));
app.use(express.json());
app.use(session({
  secret: JWT_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(requestLogger);

// Discord OAuth Strategy
passport.use(new DiscordStrategy({
  clientID: process.env.CLIENT_ID || '',
  clientSecret: CLIENT_SECRET,
  callbackURL: `${process.env.API_BASE_URL || 'http://localhost:3001'}/auth/discord/callback`,
  scope: ['identify', 'guilds']
}, async (accessToken: string, refreshToken: string, profile: DiscordProfile, done: (error: any, user?: Express.User | false) => void) => {
  try {
    const user = {
      id: profile.id,
      username: profile.username,
      discriminator: profile.discriminator,
      avatar: profile.avatar,
      guilds: profile.guilds || [],
      accessToken,
      refreshToken
    };
    return done(null, user);
  } catch (error) {
    return done(error, false);
  }
}));

passport.serializeUser((user: Express.User, done: (err: any, id?: any) => void) => {
  done(null, user);
});

passport.deserializeUser((user: Express.User, done: (err: any, user?: Express.User | false | null) => void) => {
  done(null, user);
});

// Store Discord client reference
let discordClient: Client;

export function setDiscordClient(client: Client) {
  discordClient = client;
}

// Store command registration function reference
let registerGuildCommandsFunction: ((guildId: string) => Promise<void>) | null = null;

export function setRegisterGuildCommandsFunction(fn: (guildId: string) => Promise<void>) {
  registerGuildCommandsFunction = fn;
}

// Middleware to check authentication (Session OR JWT)
const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (req.user) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, JWT_SECRET) as any;

      req.user = {
        id: decoded.userId
      } as Express.User;

      return next();
    } catch (error) {
      console.error('JWT verification failed:', error);
    }
  }

  res.status(401).json({ error: 'Authentication required' });
};

// Middleware to check guild access
const requireGuildAccess = async (req: Request, res: Response, next: NextFunction) => {
  const { guildId } = req.params;
  const user = req.user;
  
  if (!user) {
    return res.status(403).json({ error: 'No user found' });
  }

  if (!user.guilds) {
    console.log('JWT user without guilds data - allowing access');
    return next();
  }

  const hasAccess = user.guilds.some((guild: any) =>
    guild.id === guildId && (guild.permissions & 0x20) === 0x20
  );
  
  if (!hasAccess) {
    return res.status(403).json({ error: 'No access to this guild' });
  }

  next();
};

// Auth routes
app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: `${FRONTEND_URL}/login?error=failed` }),
  (req: Request, res: Response) => {
    const token = jwt.sign(
      { userId: (req.user as any).id },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.redirect(`${FRONTEND_URL}/dashboard?token=${token}`);
  }
);

app.get('/auth/logout', (req: Request, res: Response) => {
  req.logout((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.redirect(FRONTEND_URL);
  });
});

app.get('/auth/me', requireAuth, (req: Request, res: Response) => {
  const user = req.user as any;
  const availableGuilds = user.guilds?.filter((guild: any) => {
    const discordGuild = discordClient?.guilds.cache.get(guild.id);
    return discordGuild && (guild.permissions & 0x20) === 0x20;
  }) || [];

  res.json({
    id: user.id,
    username: user.username,
    discriminator: user.discriminator,
    avatar: user.avatar,
    guilds: availableGuilds
  });
});

// Dashboard API routes
app.get('/api/dashboard/:guildId/stats', requireAuth, requireGuildAccess, async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;
    
    if (!guildId) {
      return res.status(400).json({ error: 'Guild ID is required' });
    }

    const guild = discordClient?.guilds.cache.get(guildId);
    
    if (!guild) {
      return res.status(404).json({ error: 'Guild not found or bot not in guild' });
    }

    const stats = {
      guildName: guild.name,
      guildIcon: guild.iconURL({ size: 256 }),
      guildId: guild.id,
      ownerId: guild.ownerId,
      totalMembers: guild.memberCount,
      onlineMembers: guild.members.cache.filter(member => member.presence?.status !== 'offline').size,
      botMembers: guild.members.cache.filter(member => member.user.bot).size,
      humanMembers: guild.members.cache.filter(member => !member.user.bot).size,
      totalChannels: guild.channels.cache.size,
      textChannels: guild.channels.cache.filter(channel => channel.type === 0).size,
      voiceChannels: guild.channels.cache.filter(channel => channel.type === 2).size,
      categories: guild.channels.cache.filter(channel => channel.type === 4).size,
      totalRoles: guild.roles.cache.size,
      verificationLevel: guild.verificationLevel,
      premiumTier: guild.premiumTier,
      premiumSubscriptionCount: guild.premiumSubscriptionCount || 0,
      createdAt: guild.createdAt.toISOString(),
      botJoinedAt: guild.members.cache.get(discordClient.user?.id || '')?.joinedAt?.toISOString(),
      ticketCount: await dbManager.getTicketCount(guildId),
      autoResponseCount: await dbManager.getAutoResponseCount(guildId),
      openTickets: await dbManager.getTicketCount(guildId, 'open')
    };

    res.json(stats);
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

// DSCP Permissions API routes
app.get('/api/permissions/:guildId', requireAuth, requireGuildAccess, async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;
    const userId = req.user?.id;

    if (!guildId) {
      return res.status(400).json({ error: 'Guild ID is required' });
    }

    // Get guild info to check owner
    const guild = discordClient?.guilds.cache.get(guildId);
    const isOwner = guild?.ownerId === userId;

    const permissions = await dbManager.getDSCPPermissions(guildId);

    // Add implicit owner permission if user is the server owner
    if (isOwner && guild) {
      const ownerUser = guild.members.cache.get(<Snowflake>userId);
      const ownerPermission = {
        id: -1, // Special ID for owner
        type: 'user' as const,
        targetId: userId,
        targetName: ownerUser?.displayName || ownerUser?.user.username || 'Serverbesitzer',
        permissions: ['dashboard.admin', 'dashboard.view', 'tickets.manage', 'tickets.view', 'autoresponse.manage', 'autoresponse.view'],
        createdAt: guild.createdAt.toISOString(),
        isOwner: true // Special flag to identify owner permissions
      };

      // Add owner permission at the beginning of the list
      // @ts-ignore
        permissions.unshift(ownerPermission);
    }

    res.json(permissions);
  } catch (error) {
    console.error('Get permissions error:', error);
    res.status(500).json({ error: 'Failed to fetch permissions' });
  }
});

app.post('/api/permissions/:guildId', requireAuth, requireGuildAccess, async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;
    const { type, targetId, targetName, permissions } = req.body;

    if (!guildId || !type || !targetId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const permissionId = await dbManager.addDSCPPermission({
      guildId,
      type,
      targetId,
      targetName,
      permissions: permissions || ['dashboard.view']
    });

    res.json({ id: permissionId, success: true });
  } catch (error) {
    console.error('Add permission error:', error);
    res.status(500).json({ error: 'Failed to add permission' });
  }
});

app.delete('/api/permissions/:guildId/:id', requireAuth, requireGuildAccess, async (req: Request, res: Response) => {
  try {
    const { guildId, id } = req.params;

    if (!guildId || !id) {
      return res.status(400).json({ error: 'Guild ID and Permission ID are required' });
    }

    // Prevent deletion of server owner permissions (ID -1)
    if (parseInt(id) === -1) {
      return res.status(403).json({ error: 'Cannot remove server owner permissions' });
    }

    await dbManager.removeDSCPPermission(parseInt(id), guildId);
    res.json({ success: true });
  } catch (error) {
    console.error('Remove permission error:', error);
    res.status(500).json({ error: 'Failed to remove permission' });
  }
});

// Discord data API routes for autocomplete
app.get('/api/discord/:guildId/roles', requireAuth, requireGuildAccess, async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;

    console.log(`[DEBUG] Fetching roles for guild ${guildId}`);

    if (!discordClient || !discordClient.isReady()) {
      console.log('[DEBUG] Discord client not ready');
      return res.status(503).json({ error: 'Discord bot not ready' });
    }

    // @ts-ignore
      const guild = discordClient.guilds.cache.get(guildId);
    if (!guild) {
      console.log(`[DEBUG] Guild ${guildId} not found in cache`);
      return res.status(404).json({ error: 'Guild not found or bot not in guild' });
    }

    console.log(`[DEBUG] Guild found: ${guild.name}, total roles: ${guild.roles.cache.size}`);

    const roles = guild.roles.cache
      .filter(role => role.name !== '@everyone' && !role.managed)
      .map(role => ({
        id: role.id,
        name: role.name,
        color: role.color,
        position: role.position,
        managed: role.managed
      }))
      .sort((a, b) => b.position - a.position);

    console.log(`[DEBUG] Filtered roles count: ${roles.length}`);

    res.json(roles);
  } catch (error) {
    console.error('Get guild roles error:', error);
    res.status(500).json({ error: 'Failed to fetch guild roles' });
  }
});

// Guild Settings/Features API routes
app.get('/api/settings/:guildId', requireAuth, requireGuildAccess, async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;

    if (!guildId) {
      return res.status(400).json({ error: 'Guild ID is required' });
    }

    const settings = await dbManager.getGuildSettings(guildId);
    const enabledFeatures = await featureManager.getEnabledFeatures(guildId);

    res.json({
      guildId,
      enabledFeatures,
      settings: settings.settings || {},
      updatedAt: settings.updatedAt
    });
  } catch (error) {
    console.error('Get guild settings error:', error);
    res.status(500).json({ error: 'Failed to fetch guild settings' });
  }
});

app.put('/api/settings/:guildId/features', requireAuth, requireGuildAccess, async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;
    const { features } = req.body;

    if (!guildId) {
      return res.status(400).json({ error: 'Guild ID is required' });
    }

    if (!features || typeof features !== 'object') {
      return res.status(400).json({ error: 'Features object is required' });
    }

    // Validate feature names
    const validFeatures: FeatureName[] = ['tickets', 'autoresponses', 'statistics', 'webhooks'];
    for (const feature in features) {
      if (!validFeatures.includes(feature as FeatureName)) {
        return res.status(400).json({ error: `Invalid feature: ${feature}` });
      }
    }

    await featureManager.updateFeatures(guildId, features);

    // **IMPORTANT: Update Discord slash commands for this guild**
    if (registerGuildCommandsFunction) {
      console.log(`🔄 Updating slash commands for guild ${guildId} due to feature changes...`);
      try {
        await registerGuildCommandsFunction(guildId);
        console.log(`✅ Slash commands updated successfully for guild ${guildId}`);
      } catch (commandError) {
        console.error(`❌ Failed to update commands for guild ${guildId}:`, commandError);
        // Don't fail the whole request if command update fails
      }
    } else {
      console.warn('⚠️ registerGuildCommandsFunction not available - commands not updated');
    }

    console.log(`Features updated for guild ${guildId}:`, features);

    res.json({
      success: true,
      enabledFeatures: await featureManager.getEnabledFeatures(guildId),
      commandsUpdated: !!registerGuildCommandsFunction
    });
  } catch (error) {
    console.error('Update guild features error:', error);
    res.status(500).json({ error: 'Failed to update guild features' });
  }
});

app.get('/api/settings/:guildId/features/:feature/status', requireAuth, requireGuildAccess, async (req: Request, res: Response) => {
  try {
    const { guildId, feature } = req.params;

    if (!guildId || !feature) {
      return res.status(400).json({ error: 'Guild ID and feature are required' });
    }

    const isEnabled = await featureManager.isFeatureEnabled(guildId, feature as FeatureName);

    res.json({
      guildId,
      feature,
      enabled: isEnabled
    });
  } catch (error) {
    console.error('Check feature status error:', error);
    res.status(500).json({ error: 'Failed to check feature status' });
  }
});

// @ts-ignore
app.get('/api/discord/:guildId/members', requireAuth, requireGuildAccess, async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;
    const { search } = req.query;

    console.log(`[DEBUG] Fetching members for guild ${guildId}, search: "${search}"`);

    if (!discordClient || !discordClient.isReady()) {
      console.log('[DEBUG] Discord client not ready');
      return res.status(503).json({ error: 'Discord bot not ready' });
    }

    // @ts-ignore
      const guild = discordClient.guilds.cache.get(guildId);
    if (!guild) {
      console.log(`[DEBUG] Guild ${guildId} not found in cache`);
      return res.status(404).json({ error: 'Guild not found or bot not in guild' });
    }

    console.log(`[DEBUG] Guild found: ${guild.name}, cached members: ${guild.members.cache.size}/${guild.memberCount}`);

    // For small servers, try to fetch members even if we have few cached
    // For larger servers, only try if we have very few cached
    const shouldFetchMembers = guild.memberCount <= 10 ?
      guild.members.cache.size < guild.memberCount :
      (guild.memberCount > 10 && guild.members.cache.size < 5);

    if (shouldFetchMembers) {
      console.log(`[DEBUG] Attempting to fetch members (server size: ${guild.memberCount})...`);
      try {
        // For small servers, use a very short timeout but try to get all members
        const limit = guild.memberCount <= 10 ? guild.memberCount : 10;
        const timeout = guild.memberCount <= 10 ? 1000 : 2000; // 1s for small, 2s for large

        const fetchPromise = guild.members.fetch({ limit, time: timeout });
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Member fetch timeout')), timeout)
        );

        await Promise.race([fetchPromise, timeoutPromise]);
        console.log(`[DEBUG] Successfully fetched members. Now have: ${guild.members.cache.size}`);
      } catch (fetchError) {
        // @ts-ignore
          console.warn('[DEBUG] Could not fetch members:', fetchError.message || fetchError);
        // Continue with whatever we have in cache
      }
    } else {
      console.log('[DEBUG] Using cached members only');
    }

    // Work with whatever members we have in cache
    let members = Array.from(guild.members.cache.values())
      .filter(member => !member.user.bot)
      .map(member => ({
        id: member.id,
        username: member.user.username,
        displayName: member.displayName,
        avatar: member.user.avatar,
        discriminator: member.user.discriminator
      }));

    console.log(`[DEBUG] Total human members found in cache: ${members.length}`);
    console.log(`[DEBUG] Member details:`, members.map(m => `${m.username}#${m.discriminator} (${m.displayName})`));

    // If no members found in cache, provide fallback suggestion
    if (members.length === 0) {
      console.log('[DEBUG] No human members in cache, providing fallback response');
      // Return empty array to trigger manual input UI
      return res.json([]);
    }

    // Apply search filter if provided
    if (search && typeof search === 'string' && search.length >= 2) {
      const searchLower = search.toLowerCase();
      const originalCount = members.length;
      members = members.filter(member =>
        member.username.toLowerCase().includes(searchLower) ||
        member.displayName.toLowerCase().includes(searchLower) ||
        member.id === search // Also search by ID
      );
      console.log(`[DEBUG] Members after search filter "${search}": ${members.length}/${originalCount}`);
    }

    // Limit results
    const limitedMembers = members.slice(0, 50);
    console.log(`[DEBUG] Final member count to return: ${limitedMembers.length}`);

    res.json(limitedMembers);
  } catch (error) {
    console.error('Get guild members error:', error);
    res.status(500).json({ error: 'Failed to fetch guild members' });
  }
});

// Tickets endpoints
app.get('/api/tickets/:guildId', requireAuth, requireGuildAccess, async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;
    const { status } = req.query;

    const tickets = await dbManager.getTickets(guildId, status ? String(status) : undefined);
    res.json(tickets);
  } catch (error) {
    console.error('Get tickets error:', error);
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
});

// Ticket transcripts endpoints
app.get('/api/tickets/:guildId/transcripts', requireAuth, requireGuildAccess, async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;

    const transcripts = await dbManager.getTicketsWithTranscripts(guildId);
    res.json(transcripts);
  } catch (error) {
    console.error('Get ticket transcripts error:', error);
    res.status(500).json({ error: 'Failed to fetch ticket transcripts' });
  }
});

app.get('/api/tickets/:guildId/transcript/:ticketId', requireAuth, requireGuildAccess, async (req: Request, res: Response) => {
  try {
    const { guildId, ticketId } = req.params;

    if (!ticketId) {
      return res.status(400).json({ error: 'Ticket ID is required' });
    }

    const transcript = await dbManager.getTicketTranscript(parseInt(ticketId), guildId);

    if (!transcript) {
      return res.status(404).json({ error: 'Ticket transcript not found' });
    }

    res.json(transcript);
  } catch (error) {
    console.error('Get ticket transcript error:', error);
    res.status(500).json({ error: 'Failed to fetch ticket transcript' });
  }
});

// Tickets endpoints
app.post('/api/tickets', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId, username, reason, guildId, channelId } = req.body;

    if (!userId || !username || !reason || !guildId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const ticketId = await dbManager.createTicket({
      userId,
      username,
      reason,
      channelId: channelId || null,
      guildId
    });
    res.json({ success: true, ticketId });
  } catch (error) {
    console.error('Create ticket error:', error);
    res.status(500).json({ error: 'Failed to create ticket' });
  }
});

app.patch('/api/tickets/:ticketId/close', requireAuth, async (req: Request, res: Response) => {
  try {
    const { ticketId } = req.params;

    if (!ticketId) {
      return res.status(400).json({ error: 'Ticket ID is required' });
    }

    const result = await dbManager.closeTicket(parseInt(ticketId));

    if (result === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Close ticket error:', error);
    res.status(500).json({ error: 'Failed to close ticket' });
  }
});

app.delete('/api/tickets/:ticketId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { ticketId } = req.params;

    if (!ticketId) {
      return res.status(400).json({ error: 'Ticket ID is required' });
    }

    const result = await dbManager.deleteTicket(parseInt(ticketId));

    if (result === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete ticket error:', error);
    res.status(500).json({ error: 'Failed to delete ticket' });
  }
});

// Auto Response endpoints
app.get('/api/autoresponses/:guildId', requireAuth, requireGuildAccess, async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;

    const autoResponses = await dbManager.getAutoResponses(guildId);
    res.json(autoResponses);
  } catch (error) {
    console.error('Get auto responses error:', error);
    res.status(500).json({ error: 'Failed to fetch auto responses' });
  }
});

app.post('/api/autoresponses/:guildId', requireAuth, requireGuildAccess, async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;
    const { trigger, response, isEmbed, embedTitle, embedDescription, embedColor } = req.body;

    if (!trigger || (!response && !embedDescription)) {
      return res.status(400).json({ error: 'Trigger and response/embedDescription are required' });
    }

    const autoResponseId = await dbManager.addAutoResponse({
      trigger,
      response: response || embedDescription,
      isEmbed,
      embedTitle,
      embedDescription,
      embedColor,
      guildId
    });

    if (!autoResponseId) {
      return res.status(409).json({ error: 'Auto response with this trigger already exists' });
    }

    res.json({ success: true, id: autoResponseId });
  } catch (error) {
    console.error('Create auto response error:', error);
    res.status(500).json({ error: 'Failed to create auto response' });
  }
});

app.delete('/api/autoresponses/:guildId/:trigger', requireAuth, requireGuildAccess, async (req: Request, res: Response) => {
  try {
    const { guildId, trigger } = req.params;

    if (!trigger) {
      return res.status(400).json({ error: 'Trigger is required' });
    }

    const decodedTrigger = decodeURIComponent(trigger);
    const result = await dbManager.removeAutoResponse(decodedTrigger, guildId);

    if (result === 0) {
      return res.status(404).json({ error: 'Auto response not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete auto response error:', error);
    res.status(500).json({ error: 'Failed to delete auto response' });
  }
});

// Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

export function startApiServer() {
  app.listen(PORT, () => {
    console.log(`🚀 API Server running on port ${PORT}`);
  });
}

export { app };
