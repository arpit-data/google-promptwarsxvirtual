import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import db from './database.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
    },
  });

  const PORT = process.env.PORT || 8080;

  app.use(express.json());

  // API Endpoints
  app.get('/api/zones', (req, res) => {
    const zones = db.prepare('SELECT * FROM zones').all();
    res.json(zones);
  });

  app.get('/api/suggestions', (req, res) => {
    const zones = db.prepare('SELECT * FROM zones').all() as any[];

    // Suggest least crowded gate
    const gates = zones.filter(z => z.id.startsWith('gate'));
    const leastCrowdedGate = gates.reduce((prev, curr) => ((prev.crowd_count / prev.capacity) < (curr.crowd_count / curr.capacity) ? prev : curr));
    const mostCrowdedGate = gates.reduce((prev, curr) => ((prev.crowd_count / prev.capacity) > (curr.crowd_count / curr.capacity) ? prev : curr));

    const suggestions = [];
    if (mostCrowdedGate.crowd_count / mostCrowdedGate.capacity > 0.8) {
      suggestions.push({
        type: 'gate',
        message: `DIGITAL SIGNAGE ACTIVE: Rerouting incoming traffic from ${mostCrowdedGate.name} to ${leastCrowdedGate.name} (50% shorter wait times).`,
        target: leastCrowdedGate.id
      });
    }

    // Suggest least crowded service area
    const foodAreas = zones.filter(z => z.id.includes('food'));
    const bestFoodArea = foodAreas.length > 0 ? foodAreas.reduce((prev, curr) => ((prev.crowd_count / prev.capacity) < (curr.crowd_count / curr.capacity) ? prev : curr)) : null;

    if (bestFoodArea && bestFoodArea.crowd_count / bestFoodArea.capacity < 0.4) {
      const mostCrowdedFood = foodAreas.reduce((prev, curr) => ((prev.crowd_count / prev.capacity) > (curr.crowd_count / curr.capacity) ? prev : curr));
      if (mostCrowdedFood && mostCrowdedFood.crowd_count / mostCrowdedFood.capacity > 0.8) {
        suggestions.push({
          type: 'service',
          message: `MOBILE PUSH: "${mostCrowdedFood.name} busy. Head to ${bestFoodArea.name} for 10% discount on food!"`,
          target: bestFoodArea.id
        });
      }
    }

    const washrooms = zones.filter(z => z.id.includes('washroom'));
    washrooms.forEach(w => {
      if (w.crowd_count / w.capacity > 0.9) {
        suggestions.push({
          type: 'service',
          message: `OVR CAPACITY: Activating Virtual Queue at ${w.name}. Dispatched cleaning crew ETA 4m.`,
          target: w.id
        });
      }
    });

    res.json(suggestions);
  });

  app.post('/api/incidents', (req, res) => {
    const { zone, issue_type, description } = req.body;

    // Input validation
    const allowedTypes = ['Crowd', 'Medical', 'Security', 'Other'];
    if (!zone || typeof zone !== 'string' || zone.trim().length === 0) {
      return res.status(400).json({ error: 'zone is required' });
    }
    if (!issue_type || !allowedTypes.includes(issue_type)) {
      return res.status(400).json({ error: `issue_type must be one of: ${allowedTypes.join(', ')}` });
    }
    const safeZone = zone.trim().slice(0, 100);
    const safeDesc = typeof description === 'string' ? description.trim().slice(0, 500) : '';

    const info = db.prepare('INSERT INTO incidents (zone, issue_type, description) VALUES (?, ?, ?)').run(safeZone, issue_type, safeDesc);
    const incident = { id: info.lastInsertRowid, zone: safeZone, issue_type, description: safeDesc, timestamp: new Date() };
    io.emit('new_incident', incident);

    res.status(201).json(incident);
  });

  app.get('/api/incidents', (req, res) => {
    const incidents = db.prepare('SELECT * FROM incidents ORDER BY timestamp DESC LIMIT 20').all();
    res.json(incidents);
  });

  app.get('/api/history/:zoneId', (req, res) => {
    const history = db.prepare('SELECT * FROM crowd_history WHERE zone_id = ? ORDER BY timestamp DESC LIMIT 30').all(req.params.zoneId);
    res.json(history.reverse());
  });

  app.post('/api/ai-insight', async (req, res) => {
    try {
      const { zones, incidents } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'GEMINI_API_KEY is not set on the server.' });
      }
      const ai = new GoogleGenAI({ apiKey });
      const prompt = "Act as an expert stadium operations manager using a proactive experience engine. Briefly summarize the current venue state using bullet points. Focus on predicting bottlenecks before wait times spike. Mention actionable Proactive Directives for staff such as deploying virtual queues, triggering capacity-based pricing promos, sending app push nudges, or adjusting dynamic digital signage routing. Keep it extremely concise and use markdown formatting: data=" + JSON.stringify(zones) + " incidents=" + JSON.stringify(incidents);

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
      });
      res.json({ text: response.text });
    } catch (error: any) {
      console.error("AI Insight Error:", error);
      res.status(500).json({ error: error.message || 'Error generating AI insight' });
    }
  });

  // Simulator
  setInterval(() => {
    const zones = db.prepare('SELECT * FROM zones').all() as any[];
    zones.forEach(zone => {
      const cap = zone.capacity || 500;
      // Realistic variation logic per 5s: up to 1% of capacity
      const maxChange = Math.max(2, Math.floor(cap * 0.01));
      const variation = Math.floor(Math.random() * (maxChange * 2 + 1)) - maxChange;
      let newCount = zone.crowd_count + variation;

      if (newCount < 0) newCount = 0;
      if (newCount > cap) newCount = cap; // Cap

      db.prepare('UPDATE zones SET crowd_count = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?').run(newCount, zone.id);
      db.prepare('INSERT INTO crowd_history (zone_id, count) VALUES (?, ?)').run(zone.id, newCount);

      // Prune crowd_history to keep only the last 500 entries per zone
      // Prevents unbounded DB growth over long running sessions
      db.prepare(`
        DELETE FROM crowd_history WHERE zone_id = ? AND id NOT IN (
          SELECT id FROM crowd_history WHERE zone_id = ? ORDER BY id DESC LIMIT 500
        )
      `).run(zone.id, zone.id);

      // Auto-incident for Critical thresholds
      const density = newCount / cap;
      if (density > 0.92) {
        // Check if there was a recent incident for this zone in last 1 min to prevent spam
        const recent = db.prepare("SELECT id FROM incidents WHERE zone = ? AND timestamp > DATETIME('now', '-1 minute')").get(zone.name);
        if (!recent) {
          const issue_type = 'Crowd';
          const description = `AUTO-ALERT: ${zone.name} reached ${(density * 100).toFixed(1)}% capacity. High pressure detected.`;
          const info = db.prepare('INSERT INTO incidents (zone, issue_type, description) VALUES (?, ?, ?)').run(zone.name, issue_type, description);
          const incident = { id: info.lastInsertRowid, zone: zone.name, issue_type, description, timestamp: new Date() };
          io.emit('new_incident', incident);
        }
      }
    });

    const updatedZones = db.prepare('SELECT * FROM zones').all();
    io.emit('zones_update', updatedZones);
  }, 3000);

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
