import express from 'express';
import cors from 'cors';
import { dbManager } from '../database/database.js';

const app = express();
const PORT = process.env.API_PORT || 3001;

app.use(cors());
app.use(express.json());

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
