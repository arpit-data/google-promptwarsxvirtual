import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'crowdpulse.db');

const db = new Database(dbPath);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS zones (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    crowd_count INTEGER DEFAULT 0,
    capacity INTEGER DEFAULT 500,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zone TEXT NOT NULL,
    issue_type TEXT NOT NULL,
    description TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS crowd_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zone_id TEXT NOT NULL,
    count INTEGER NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_crowd_history_zone_id ON crowd_history(zone_id);
  CREATE INDEX IF NOT EXISTS idx_incidents_timestamp ON incidents(timestamp DESC);
`);

// Initial Data for Zones with realistic setup
const initialZones = [
  { id: 'gate-a', name: 'Gate A', capacity: 5000, initialRaw: 0.35 },
  { id: 'gate-b', name: 'Gate B', capacity: 5000, initialRaw: 0.15 },
  { id: 'food-court', name: 'Food Court', capacity: 1500, initialRaw: 0.85 },
  { id: 'washrooms', name: 'Washroom Area', capacity: 50, initialRaw: 0.60 },
  { id: 'seating-a', name: 'Seating Section 100', capacity: 12000, initialRaw: 0.70 },
  { id: 'seating-b', name: 'Seating Section 200', capacity: 12000, initialRaw: 0.45 }
];

const insertZone = db.prepare('INSERT OR IGNORE INTO zones (id, name, crowd_count, capacity) VALUES (?, ?, ?, ?)');
const updateCapacity = db.prepare('UPDATE zones SET capacity = ? WHERE id = ?');
initialZones.forEach(zone => {
  const baseCount = Math.floor(zone.capacity * zone.initialRaw);
  // Add some random scatter
  const initialCount = baseCount + Math.floor((Math.random() - 0.5) * (zone.capacity * 0.1));
  insertZone.run(zone.id, zone.name, Math.max(0, initialCount), zone.capacity);
  updateCapacity.run(zone.capacity, zone.id);
});

export default db;
