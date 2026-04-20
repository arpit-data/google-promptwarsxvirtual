import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import db from "./database.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  const PORT = Number(process.env.PORT) || 8080;

  app.use(express.json());

  // API Endpoints
  app.get('/api/zones', (req, res) => {
    const zones = db.prepare('SELECT * FROM zones').all() as any[];
    res.json(zones);
  });

  app.get('/api/suggestions', (req, res) => {
    const zones = db.prepare('SELECT * FROM zones').all() as any[];

    const gates = zones.filter((z: any) => z.id.startsWith('gate'));
    if (gates.length === 0) return res.json([]);

    const leastCrowdedGate = gates.reduce((prev: any, curr: any) =>
      (prev.crowd_count / prev.capacity) < (curr.crowd_count / curr.capacity) ? prev : curr
    );

    const mostCrowdedGate = gates.reduce((prev: any, curr: any) =>
      (prev.crowd_count / prev.capacity) > (curr.crowd_count / curr.capacity) ? prev : curr
    );

    const suggestions: any[] = [];

    if (mostCrowdedGate.crowd_count / mostCrowdedGate.capacity > 0.8) {
      suggestions.push({
        type: 'gate',
        message: `DIGITAL SIGNAGE ACTIVE: Rerouting from ${mostCrowdedGate.name} to ${leastCrowdedGate.name}`,
        target: leastCrowdedGate.id
      });
    }

    const foodAreas = zones.filter((z: any) => z.id.includes('food'));

    if (foodAreas.length > 0) {
      const bestFoodArea = foodAreas.reduce((prev: any, curr: any) =>
        (prev.crowd_count / prev.capacity) < (curr.crowd_count / curr.capacity) ? prev : curr
      );

      const mostCrowdedFood = foodAreas.reduce((prev: any, curr: any) =>
        (prev.crowd_count / prev.capacity) > (curr.crowd_count / curr.capacity) ? prev : curr
      );

      if (mostCrowdedFood.crowd_count / mostCrowdedFood.capacity > 0.8) {
        suggestions.push({
          type: 'service',
          message: `Go to ${bestFoodArea.name} for faster service`,
          target: bestFoodArea.id
        });
      }
    }

    res.json(suggestions);
  });

  app.post('/api/incidents', (req, res) => {
    const { zone, issue_type, description } = req.body;

    const info = db.prepare(
      'INSERT INTO incidents (zone, issue_type, description) VALUES (?, ?, ?)'
    ).run(zone, issue_type, description);

    const incident = {
      id: info.lastInsertRowid,
      zone,
      issue_type,
      description,
      timestamp: new Date()
    };

    io.emit('new_incident', incident);
    res.status(201).json(incident);
  });

  app.get('/api/incidents', (req, res) => {
    const incidents = db.prepare(
      'SELECT * FROM incidents ORDER BY timestamp DESC LIMIT 20'
    ).all() as any[];

    res.json(incidents);
  });

  // Simulator
  setInterval(() => {
    const zones = db.prepare('SELECT * FROM zones').all() as any[];

    zones.forEach((zone: any) => {
      const variation = Math.floor(Math.random() * 20 - 10);
      let newCount = zone.crowd_count + variation;

      if (newCount < 0) newCount = 0;
      if (newCount > zone.capacity) newCount = zone.capacity;

      db.prepare(
        'UPDATE zones SET crowd_count = ? WHERE id = ?'
      ).run(newCount, zone.id);
    });

    const updatedZones = db.prepare('SELECT * FROM zones').all() as any[];
    io.emit('zones_update', updatedZones);
  }, 3000);

  // Vite / Production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // In production, server.js is in dist/, so the assets are in the same dir
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