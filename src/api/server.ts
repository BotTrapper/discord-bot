import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
// @ts-ignore - No type definitions available
import session from 'express-session';
// @ts-ignore - No type definitions available
import connectPgSimple from 'connect-pg-simple';
// @ts-ignore - No type definitions available
import passport from 'passport';
// @ts-ignore - No type definitions available
import { Strategy as DiscordStrategy } from 'passport-discord';
import jwt from 'jsonwebtoken';
import { dbManager } from '../database/database.js';
import { featureManager, type FeatureName } from '../features/featureManager.js';
import { versionManager } from '../utils/version.js';
import type {Client, Snowflake} from 'discord.js';

// Type definitions for untyped modules
interface DiscordProfile {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  guilds?: any[];
}

// Custom user type that extends the default passport user
interface CustomUser {
  id: string;
  username?: string;
  discriminator?: string;
  avatar?: string | null;
  guilds?: any[];
  accessToken?: string;
  refreshToken?: string;
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

// Create PostgreSQL session store
const PgSession = connectPgSimple(session);

// Middleware
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true
}));
app.use(express.json());

// Configure session with PostgreSQL store
app.use(session({
  store: new PgSession({
    pool: dbManager.connectionPool,
    tableName: 'user_sessions',
    createTableIfMissing: true
  }),
  secret: JWT_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true, // Reset expiry on each request
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(requestLogger);

// Discord OAuth Strategy
// @ts-ignore - Passport Discord types are inconsistent
passport.use(new DiscordStrategy({
  clientID: process.env.CLIENT_ID || '',
  clientSecret: CLIENT_SECRET,
  callbackURL: `${process.env.API_BASE_URL || 'http://localhost:3001'}/auth/discord/callback`,
  scope: ['identify', 'guilds']
}, (accessToken: string, refreshToken: string, profile: DiscordProfile, done: Function) => {
  try {
    const user: CustomUser = {
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

// Utility to validate guildId parameter
const validateGuildId = (guildId: string | undefined): guildId is string => {
  return typeof guildId === 'string' && guildId.length > 0;
};

// Middleware to check authentication (Session OR JWT from DB)
// Token refresh function
const refreshDiscordToken = async (refreshToken: string): Promise<{ accessToken: string; newRefreshToken: string } | null> => {
  try {
    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.CLIENT_ID || '',
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return {
        accessToken: data.access_token,
        newRefreshToken: data.refresh_token || refreshToken, // Some responses don't include new refresh token
      };
    }
    
    console.log(`❌ Token refresh failed with status: ${response.status}`);
    return null;
  } catch (error) {
    console.error('❌ Error refreshing token:', error);
    return null;
  }
};

const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  if (req.user) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, JWT_SECRET) as any;

      // Check if token exists in database and is still valid
      const storedToken = await dbManager.getUserToken(decoded.userId);
      if (storedToken && storedToken.jwt_token === token) {
        // Get stored tokens properly
        let accessToken = storedToken.access_token;
        const refreshToken = storedToken.refresh_token;
        
        try {
          // Try to fetch user data from Discord API
          let userResponse = await fetch('https://discord.com/api/users/@me', {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          });
          
          let guildsResponse = await fetch('https://discord.com/api/users/@me/guilds', {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          });

          // If access token is expired (401), try to refresh it
          if (userResponse.status === 401 && refreshToken) {
            console.log('🔄 Access token expired, attempting refresh...');
            const refreshResult = await refreshDiscordToken(refreshToken);
            
            if (refreshResult) {
              accessToken = refreshResult.accessToken;
              
              // Update stored token in database
              const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
              await dbManager.updateUserTokens(decoded.userId, accessToken, refreshResult.newRefreshToken, expiresAt);
              
              console.log('✅ Token refreshed successfully');
              
              // Retry the API calls with new token
              userResponse = await fetch('https://discord.com/api/users/@me', {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              });
              
              guildsResponse = await fetch('https://discord.com/api/users/@me/guilds', {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              });
            }
          }

          if (userResponse.ok && guildsResponse.ok) {
            const userData = await userResponse.json();
            const guildsData = await guildsResponse.json();
            
            req.user = {
              id: userData.id,
              username: userData.username,
              discriminator: userData.discriminator,
              avatar: userData.avatar,
              guilds: guildsData,
              accessToken: accessToken,
              refreshToken: refreshToken
            } as CustomUser;
            
            console.log(`✅ JWT authenticated user: ${userData.username}#${userData.discriminator}`);
            return next();
          } else {
            console.log(`❌ Failed to fetch user data from Discord API after refresh attempt - User: ${userResponse.status}, Guilds: ${guildsResponse.status}`);
            // If refresh also failed, remove token from database
            await dbManager.removeUserToken(decoded.userId);
          }
        } catch (discordError) {
          console.error('❌ Discord API error:', discordError);
          // On Discord API error, try to continue with minimal user data
          req.user = {
            id: decoded.userId
          } as CustomUser;
          return next();
        }
      } else {
        console.log('❌ Token not found in database or expired');
      }
    } catch (error) {
      console.error('❌ JWT verification failed:', error);
    }
  }

  res.status(401).json({ error: 'Authentication required' });
};

// Middleware to check guild access
const requireGuildAccess = async (req: Request, res: Response, next: NextFunction) => {
  const { guildId } = req.params;
  const user = req.user as CustomUser;
  
  if (!user) {
    return res.status(403).json({ error: 'No user found' });
  }

  // Check if user is global admin (bypasses guild access check)
  const adminStatus = await dbManager.isGlobalAdmin(user.id);
  if (adminStatus.isAdmin) {
    console.log(`✅ Global admin ${user.username} accessing guild ${guildId}`);
    (req.user as any).isGlobalAdmin = true;
    (req.user as any).adminLevel = adminStatus.level;
    return next();
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

// Middleware to require global admin access
const requireGlobalAdmin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const user = req.user;

  if (!user?.id) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const adminStatus = await dbManager.isGlobalAdmin(user.id);
  if (!adminStatus.isAdmin) {
    res.status(403).json({ error: 'Global admin access required' });
    return;
  }

  (req.user as any).isGlobalAdmin = true;
  (req.user as any).adminLevel = adminStatus.level;
  
  console.log(`🔐 Global admin ${user.username} (Level ${adminStatus.level}) accessing admin endpoint`);
  next();
};

// Auth routes
app.get('/auth/discord', passport.authenticate('discord'));

// Admin API routes
app.get('/api/admin/status', requireAuth, async (req: Request, res: Response) => {
  const user = req.user as CustomUser;
  const adminStatus = await dbManager.isGlobalAdmin(user.id);
  return res.json(adminStatus);
});

app.get('/api/admin/settings', requireAuth, requireGlobalAdmin, async (req: Request, res: Response) => {
  try {
    const settings = await dbManager.getAllGlobalSettings();
    return res.json(settings);
  } catch (error) {
    console.error('Get global settings error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/admin/settings/:key', requireAuth, requireGlobalAdmin, async (req: Request, res: Response) => {
  try {
    const { key } = req.params;
    const { value, type, description } = req.body;
    const user = req.user as CustomUser;

    if (!key) {
      return res.status(400).json({ error: 'Setting key is required' });
    }

    await dbManager.setGlobalSetting(key, value, type || 'string', description || '', user.id);
    await dbManager.logAdminActivity(user.id, 'UPDATE_GLOBAL_SETTING', 'setting', key, `${key} = ${value}`);

    return res.json({ success: true });
  } catch (error) {
    console.error('Update global setting error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/admins', requireAuth, requireGlobalAdmin, async (req: Request, res: Response) => {
  try {
    const admins = await dbManager.getAllGlobalAdmins();
    return res.json(admins);
  } catch (error) {
    console.error('Get global admins error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/admins', requireAuth, requireGlobalAdmin, async (req: Request, res: Response) => {
  try {
    const { userId, username, level } = req.body;
    const user = req.user as CustomUser;

    if (!userId || !username) {
      return res.status(400).json({ error: 'User ID and username are required' });
    }

    const adminId = await dbManager.addGlobalAdmin(userId, username, level || 1, user.id);
    await dbManager.logAdminActivity(user.id, 'ADD_GLOBAL_ADMIN', 'user', userId, `Added ${username} as admin (Level ${level || 1})`);

    return res.json({ id: adminId, success: true });
  } catch (error) {
    console.error('Add global admin error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/admin/admins/:userId', requireAuth, requireGlobalAdmin, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const user = req.user as CustomUser;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    if (userId === user.id) {
      return res.status(400).json({ error: 'Cannot remove yourself as admin' });
    }

    const result = await dbManager.removeGlobalAdmin(userId);
    if (result === 0) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    await dbManager.logAdminActivity(user.id, 'REMOVE_GLOBAL_ADMIN', 'user', userId, 'Removed admin access');

    return res.json({ success: true });
  } catch (error) {
    console.error('Remove global admin error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/guilds', requireAuth, requireGlobalAdmin, async (req: Request, res: Response) => {
  try {
    // Get all guilds the bot is connected to from Discord client
    if (!discordClient) {
      return res.status(500).json({ error: 'Discord client not available' });
    }

    const guildsData = discordClient.guilds.cache.map(guild => {
      return {
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL({ size: 64 }),
        memberCount: guild.memberCount,
        ownerID: guild.ownerId,
        features: guild.features,
        createdAt: guild.createdAt.toISOString(),
        joinedAt: guild.joinedAt?.toISOString() || null
      };
    });

    // Sort by member count (descending) then by name
    guildsData.sort((a, b) => {
      if (b.memberCount !== a.memberCount) {
        return b.memberCount - a.memberCount;
      }
      return a.name.localeCompare(b.name);
    });

    return res.json(guildsData);
  } catch (error) {
    console.error('Get all guilds error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/activity', requireAuth, requireGlobalAdmin, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const activities = await dbManager.getAdminActivityLog(limit);
    return res.json(activities);
  } catch (error) {
    console.error('Get admin activity error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Auth routes
app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: `${FRONTEND_URL}/login?error=failed` }),
  async (req: Request, res: Response) => {
    const user = req.user as any;
    const token = jwt.sign(
      { userId: user.id },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    // Store tokens in database for persistent authentication
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours for JWT
    try {
      await dbManager.storeUserToken(
        user.id, 
        token, 
        user.accessToken || '', 
        user.refreshToken || '', 
        expiresAt
      );
      console.log(`✅ Stored JWT token for user ${user.id} with Discord tokens`);
      console.log(`Access Token: ${user.accessToken?.substring(0, 10)}...`);
      console.log(`Refresh Token: ${user.refreshToken?.substring(0, 10)}...`);
    } catch (error) {
      console.error('Failed to store JWT token:', error);
    }
    
    res.redirect(`${FRONTEND_URL}/dashboard?token=${token}`);
  }
);

app.get('/auth/logout', requireAuth, async (req: Request, res: Response) => {
  const user = req.user as CustomUser;
  
  // Remove token from database
  if (user?.id) {
    try {
      await dbManager.removeUserToken(user.id);
      console.log(`✅ Removed JWT token for user ${user.id}`);
    } catch (error) {
      console.error('Failed to remove JWT token:', error);
    }
  }

  if (req.logout) {
    return req.logout((err) => {
      if (err) {
        console.error('Logout error:', err);
        return res.status(500).json({ error: 'Logout failed' });
      }
      return res.redirect(FRONTEND_URL);
    });
  } else {
    return res.redirect(FRONTEND_URL);
  }
});

app.get('/auth/me', requireAuth, (req: Request, res: Response) => {
  const user = req.user as CustomUser;
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

    return res.json(stats);
  } catch (error) {
    console.error('Dashboard stats error:', error);
    return res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

// DSCP Permissions API routes
app.get('/api/permissions/:guildId', requireAuth, requireGuildAccess, async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;
    const userId = (req.user as CustomUser)?.id;

    if (!guildId) {
      return res.status(400).json({ error: 'Guild ID is required' });
    }

    // Get guild info to check owner
    const guild = discordClient?.guilds.cache.get(guildId);
    const isOwner = guild?.ownerId === userId;

    const permissions = await dbManager.getDSCPPermissions(guildId);

    // Refresh names from Discord API for better accuracy
    const updatedPermissions = await Promise.all(
      permissions.map(async (permission: any) => {
        try {
          if (permission.type === 'role' && guild) {
            const role = guild.roles.cache.get(permission.target_id);
            if (role) {
              return {
                id: permission.id,
                type: permission.type,
                targetId: permission.target_id,
                targetName: role.name,
                permissions: permission.permissions,
                createdAt: permission.created_at,
                color: role.color,
                position: role.position
              };
            }
          } else if (permission.type === 'user' && guild) {
            const member = guild.members.cache.get(permission.target_id);
            if (member) {
              return {
                id: permission.id,
                type: permission.type,
                targetId: permission.target_id,
                targetName: member.displayName || member.user.username,
                permissions: permission.permissions,
                createdAt: permission.created_at,
                avatar: member.user.avatarURL({ size: 32 }),
                discriminator: member.user.discriminator
              };
            }
          }
          
          // Fallback to stored name if Discord data is not available
          return {
            id: permission.id,
            type: permission.type,
            targetId: permission.target_id,
            targetName: permission.target_name || `${permission.type === 'role' ? 'Rolle' : 'Benutzer'} (${permission.target_id.substring(0, 8)}...)`,
            permissions: permission.permissions,
            createdAt: permission.created_at
          };
        } catch (error) {
          console.error(`Error refreshing name for ${permission.type} ${permission.target_id}:`, error);
          return {
            id: permission.id,
            type: permission.type,
            targetId: permission.target_id,
            targetName: permission.target_name || `${permission.type === 'role' ? 'Rolle' : 'Benutzer'} (${permission.target_id.substring(0, 8)}...)`,
            permissions: permission.permissions,
            createdAt: permission.created_at
          };
        }
      })
    );

    // Add implicit owner permission if user is the server owner
    if (isOwner && guild) {
      const ownerUser = guild.members.cache.get(<Snowflake>userId);
      const ownerPermission = {
        id: -1, // Special ID for owner
        type: 'user' as const,
        targetId: userId || '',
        targetName: ownerUser?.displayName || ownerUser?.user.username || 'Serverbesitzer',
        permissions: ['dashboard.admin', 'dashboard.view', 'tickets.manage', 'tickets.view', 'autoresponse.manage', 'autoresponse.view'],
        createdAt: guild.createdAt.toISOString(),
        isOwner: true, // Special flag to identify owner permissions
        avatar: ownerUser?.user.avatarURL({ size: 32 }) || undefined,
        discriminator: ownerUser?.user.discriminator || undefined
      };

      // Add owner permission at the beginning of the list
      updatedPermissions.unshift(ownerPermission as any);
    }

    return res.json(updatedPermissions);
  } catch (error) {
    console.error('Get permissions error:', error);
    return res.status(500).json({ error: 'Internal server error' });
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

    return res.json({ id: permissionId, success: true });
  } catch (error) {
    console.error('Add permission error:', error);
    return res.status(500).json({ error: 'Internal server error' });
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
    return res.json({ success: true });
  } catch (error) {
    console.error('Remove permission error:', error);
    return res.status(500).json({ error: 'Internal server error' });
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

    return res.json(roles);
  } catch (error) {
    console.error('Get guild roles error:', error);
    return res.status(500).json({ error: 'Internal server error' });
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

    return res.json({
      guildId,
      enabledFeatures,
      settings: settings.settings || {},
      updatedAt: settings.updatedAt
    });
  } catch (error) {
    console.error('Get guild settings error:', error);
    return res.status(500).json({ error: 'Internal server error' });
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
    const validFeatures: FeatureName[] = ['tickets', 'autoresponses', 'statistics'];
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

    return res.json({
      success: true,
      enabledFeatures: await featureManager.getEnabledFeatures(guildId),
      commandsUpdated: !!registerGuildCommandsFunction
    });
  } catch (error) {
    console.error('Update guild features error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/settings/:guildId/features/:feature/status', requireAuth, requireGuildAccess, async (req: Request, res: Response) => {
  try {
    const { guildId, feature } = req.params;

    if (!guildId || !feature) {
      return res.status(400).json({ error: 'Guild ID and feature are required' });
    }

    const isEnabled = await featureManager.isFeatureEnabled(guildId, feature as FeatureName);

    return res.json({
      guildId,
      feature,
      enabled: isEnabled
    });
  } catch (error) {
    console.error('Check feature status error:', error);
    return res.status(500).json({ error: 'Internal server error' });
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

    return res.json(limitedMembers);
  } catch (error) {
    console.error('Get guild members error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Tickets endpoints
app.get('/api/tickets/:guildId', requireAuth, requireGuildAccess, async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;
    const { status } = req.query;

    if (!validateGuildId(guildId)) {
      return res.status(400).json({ error: 'Invalid guild ID' });
    }

    const tickets = await dbManager.getTickets(guildId, status ? String(status) : undefined);
    return res.json(tickets);
  } catch (error) {
    console.error('Get tickets error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Ticket transcripts endpoints
app.get('/api/tickets/:guildId/transcripts', requireAuth, requireGuildAccess, async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;
    
    if (!validateGuildId(guildId)) {
      return res.status(400).json({ error: 'Valid Guild ID is required' });
    }

    const transcripts = await dbManager.getTicketsWithTranscripts(guildId);
    return res.json(transcripts);
  } catch (error) {
    console.error('Get ticket transcripts error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/tickets/:guildId/transcript/:ticketId', requireAuth, requireGuildAccess, async (req: Request, res: Response) => {
  try {
    const { guildId, ticketId } = req.params;
    
    if (!validateGuildId(guildId)) {
      return res.status(400).json({ error: 'Valid Guild ID is required' });
    }

    if (!ticketId) {
      return res.status(400).json({ error: 'Ticket ID is required' });
    }

    const transcript = await dbManager.getTicketTranscript(parseInt(ticketId), guildId);

    if (!transcript) {
      return res.status(404).json({ error: 'Ticket transcript not found' });
    }

    return res.json(transcript);
  } catch (error) {
    console.error('Get ticket transcript error:', error);
    return res.status(500).json({ error: 'Internal server error' });
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
    return res.json({ id: ticketId, success: true });
  } catch (error) {
    console.error('Create ticket error:', error);
    return res.status(500).json({ error: 'Internal server error' });
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

    return res.json({ success: true });
  } catch (error) {
    console.error('Close ticket error:', error);
    return res.status(500).json({ error: 'Internal server error' });
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

    return res.json({ success: true });
  } catch (error) {
    console.error('Delete ticket error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Auto Response endpoints
app.get('/api/autoresponses/:guildId', requireAuth, requireGuildAccess, async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;
    
    if (!validateGuildId(guildId)) {
      return res.status(400).json({ error: 'Valid Guild ID is required' });
    }

    const autoResponses = await dbManager.getAutoResponses(guildId);
    return res.json(autoResponses);
  } catch (error) {
    console.error('Get auto responses error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/autoresponses/:guildId', requireAuth, requireGuildAccess, async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;
    const { trigger, response, isEmbed, embedTitle, embedDescription, embedColor } = req.body;
    
    if (!validateGuildId(guildId)) {
      return res.status(400).json({ error: 'Valid Guild ID is required' });
    }

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

    return res.json({ id: autoResponseId, success: true });
  } catch (error) {
    console.error('Create auto response error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/autoresponses/:guildId/:trigger', requireAuth, requireGuildAccess, async (req: Request, res: Response) => {
  try {
    const { guildId, trigger } = req.params;
    
    if (!validateGuildId(guildId)) {
      return res.status(400).json({ error: 'Valid Guild ID is required' });
    }

    if (!trigger) {
      return res.status(400).json({ error: 'Trigger is required' });
    }

    const decodedTrigger = decodeURIComponent(trigger);
    const result = await dbManager.removeAutoResponse(decodedTrigger, guildId);

    if (result === 0) {
      return res.status(404).json({ error: 'Auto response not found' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Delete auto response error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check
// Version and changelog endpoints
app.get('/api/version', (req: Request, res: Response) => {
  try {
    const versionInfo = versionManager.getVersionInfo();
    const uptime = versionManager.getUptimeString();
    
    res.json({
      version: versionInfo.version,
      name: versionInfo.name,
      description: versionInfo.description,
      startTime: versionInfo.startTime.toISOString(),
      uptime: uptime
    });
  } catch (error) {
    console.error('Error getting version info:', error);
    res.status(500).json({ error: 'Failed to get version information' });
  }
});

// Changelog data - in a real app, this could come from a database or external file
const changelog = [
  {
    version: '1.0.0',
    date: '2025-09-12',
    type: 'major',
    changes: {
      added: [
        'Initial release of BotTrapper',
        'Ticket system with categories',
        'Auto-response system with embed support', 
        'Permission management system',
        'Statistics dashboard',
        'Feature toggle system',
        'Discord OAuth2 dashboard',
        'Version tracking and changelog',
        'Footer mit Versionierung und Julscha Copyright'
      ],
      changed: [],
      fixed: [],
      removed: []
    }
  }
];

app.get('/api/changelog', (req: Request, res: Response) => {
  try {
    const version = req.query.version as string;
    
    if (version) {
      // Get specific version
      const entry = changelog.find(entry => entry.version === version);
      if (!entry) {
        return res.status(404).json({ error: `Version ${version} not found` });
      }
      return res.json(entry);
    }
    
    // Get all changelog entries
    return res.json(changelog);
  } catch (error) {
    console.error('Error getting changelog:', error);
    return res.status(500).json({ error: 'Failed to get changelog' });
  }
});

app.get('/api/changelog/markdown', (req: Request, res: Response) => {
  try {
    const generateMarkdown = () => {
      let markdown = '# Changelog\n\n';
      markdown += 'All notable changes to BotTrapper will be documented in this file.\n\n';
      
      changelog.forEach((entry) => {
        const date = new Date(entry.date).toLocaleDateString('de-DE', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
        
        markdown += `## [${entry.version}] - ${date}\n\n`;
        markdown += `**Type:** ${entry.type.toUpperCase()}\n\n`;
        
        // Add changes by category
        Object.entries(entry.changes).forEach(([type, items]) => {
          if (items && items.length > 0) {
            const emojis: Record<string, string> = {
              added: '✨',
              changed: '🔄',
              fixed: '🐛',
              removed: '🗑️'
            };
            
            const labels: Record<string, string> = {
              added: 'Added',
              changed: 'Changed',
              fixed: 'Fixed',
              removed: 'Removed'
            };
            
            markdown += `### ${emojis[type] || '•'} ${labels[type] || type}\n\n`;
            items.forEach(item => {
              markdown += `- ${item}\n`;
            });
            markdown += '\n';
          }
        });
        
        markdown += '---\n\n';
      });
      
      return markdown;
    };
    
    const markdownContent = generateMarkdown();
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    return res.send(markdownContent);
  } catch (error) {
    console.error('Error generating changelog markdown:', error);
    return res.status(500).send('# Error\n\nFailed to generate changelog');
  }
});

app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

export function startApiServer() {
  app.listen(PORT, () => {
    console.log(`🚀 API Server running on port ${PORT}`);
  });
}

export { app };
