import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import { Strategy as DiscordStrategy } from 'passport-discord';
import jwt from 'jsonwebtoken';
import { dbManager } from '../database/database.js';
import type { Client } from 'discord.js';

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

// Discord OAuth Strategy
passport.use(new DiscordStrategy({
  clientID: process.env.CLIENT_ID || '',
  clientSecret: CLIENT_SECRET,
  callbackURL: `${process.env.API_BASE_URL || 'http://localhost:3001'}/auth/discord/callback`,
  scope: ['identify', 'guilds']
}, async (accessToken, refreshToken, profile, done) => {
  try {
    // Store user info with guilds
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
    return done(error, null);
  }
}));

passport.serializeUser((user: any, done) => {
  done(null, user);
});

passport.deserializeUser((user: any, done) => {
  done(null, user);
});

// Store Discord client reference
let discordClient: Client;

export function setDiscordClient(client: Client) {
  discordClient = client;
}

// Middleware to check authentication
const requireAuth = (req: any, res: any, next: any) => {
  if (req.user) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
};

// Middleware to check guild access
const requireGuildAccess = async (req: any, res: any, next: any) => {
  const { guildId } = req.params;
  const user = req.user;
  
  if (!user || !user.guilds) {
    return res.status(403).json({ error: 'No guild access' });
  }
  
  // Check if user has access to the guild
  const hasAccess = user.guilds.some((guild: any) => 
    guild.id === guildId && (guild.permissions & 0x20) === 0x20 // MANAGE_GUILD permission
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
  (req, res) => {
    // Generate JWT token
    const token = jwt.sign(
      { userId: (req.user as any).id },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.redirect(`${FRONTEND_URL}/dashboard?token=${token}`);
  }
);

app.get('/auth/logout', (req, res) => {
  req.logout(() => {
    res.redirect(FRONTEND_URL);
  });
});

app.get('/auth/me', requireAuth, (req, res) => {
  const user = req.user as any;
  // Filter guilds where bot is present and user has manage permissions
  const availableGuilds = user.guilds?.filter((guild: any) => {
    const discordGuild = discordClient?.guilds.cache.get(guild.id);
    return discordGuild && (guild.permissions & 0x20) === 0x20; // MANAGE_GUILD permission
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
app.get('/api/dashboard/:guildId/stats', requireAuth, requireGuildAccess, async (req, res) => {
  try {
    const { guildId } = req.params;
    
    // Get basic stats
    const ticketCount = await dbManager.getTicketCount(guildId);
    const autoResponseCount = await dbManager.getAutoResponseCount(guildId);
    
    // Get Discord guild info
    const guild = discordClient?.guilds.cache.get(guildId);
    
    res.json({
      guildName: guild?.name || 'Unknown Guild',
      guildIcon: guild?.iconURL(),
      memberCount: guild?.memberCount || 0,
      ticketCount,
      autoResponseCount,
      openTickets: await dbManager.getTicketCount(guildId, 'open')
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

// Tickets endpoints
app.get('/api/tickets/:guildId', async (req, res) => {
  try {
    const { guildId } = req.params;
    const { status } = req.query;
    const tickets = await dbManager.getTickets(guildId, status as string);
    res.json(tickets);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
});

app.post('/api/tickets', async (req, res) => {
  try {
    const { userId, username, reason, channelId, guildId } = req.body;
    const ticketId = await dbManager.createTicket({
      userId,
      username,
      reason,
      channelId,
      guildId
    });
    res.json({ id: ticketId, success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create ticket' });
  }
});

app.patch('/api/tickets/:id/close', async (req, res) => {
  try {
    const { id } = req.params;
    await dbManager.closeTicket(parseInt(id));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to close ticket' });
  }
});

app.delete('/api/tickets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await dbManager.deleteTicket(parseInt(id));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete ticket' });
  }
});

app.get('/api/tickets/:guildId/:id', async (req, res) => {
  try {
    const { guildId, id } = req.params;
    const ticket = await dbManager.getTicketById(parseInt(id), guildId);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    res.json(ticket);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch ticket' });
  }
});

// Auto responses endpoints
app.get('/api/autoresponses/:guildId', async (req, res) => {
  try {
    const { guildId } = req.params;
    const responses = await dbManager.getAutoResponses(guildId);
    res.json(responses);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch auto responses' });
  }
});

app.post('/api/autoresponses', async (req, res) => {
  try {
    const { trigger, response, isEmbed, embedTitle, embedDescription, embedColor, guildId } = req.body;
    const responseId = await dbManager.addAutoResponse({
      trigger,
      response,
      isEmbed,
      embedTitle,
      embedDescription,
      embedColor,
      guildId
    });
    res.json({ id: responseId, success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create auto response' });
  }
});

app.delete('/api/autoresponses/:guildId/:trigger', async (req, res) => {
  try {
    const { guildId, trigger } = req.params;
    await dbManager.removeAutoResponse(trigger, guildId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete auto response' });
  }
});

// Statistics endpoints
app.get('/api/stats/:guildId', async (req, res) => {
  try {
    const { guildId } = req.params;
    const { days = '30' } = req.query;
    const stats = await dbManager.getCommandStats(guildId, parseInt(days as string));
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Webhooks endpoints
app.get('/api/webhooks/:guildId', async (req, res) => {
  try {
    const { guildId } = req.params;
    const webhooks = await dbManager.getWebhooks(guildId);
    res.json(webhooks);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch webhooks' });
  }
});

app.post('/api/webhooks', async (req, res) => {
  try {
    const { name, url, guildId } = req.body;
    const webhookId = await dbManager.addWebhook(name, url, guildId);
    res.json({ id: webhookId, success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create webhook' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

export function startApiServer() {
  app.listen(PORT, () => {
    console.log(`🚀 API Server running on port ${PORT}`);
  });
}

export { app };
