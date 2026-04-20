# CrowdPulse: AI-Powered Venue Crowd Orchestration

**CrowdPulse** is a next-generation operational dashboard designed for stadium and large venue managers. It transforms raw sensor data into actionable situational awareness, moving beyond simple monitoring to a **"Sense-Predict-Act"** cycle powered by AI.

---

## 🏟️ The Use Case: Situational Awareness at Scale

Managing 50,000+ attendees requires more than just reactive security. CrowdPulse addresses critical operational bottlenecks by providing:

1.  **Sense**: Real-time occupancy tracking across Gates, Concessions, and Restrooms.
2.  **Predict**: A proprietary **"Wait Vector" Engine** that calculates current pressure and projects wait times 15 minutes into the future using linear flow models.
3.  **Act**: Direct remediation triggers—dispatching staff or triggering dynamic digital signage and mobile promotions—straight from the dashboard.

### Operational Benefits:
- **Reduced Friction**: Guide attendees to "Green Zones" (low-density areas) to balance venue load.
- **Safety First**: Automated incident logging for over-capacity thresholds.
- **ROI Driven**: Increase concession revenue by rerouting traffic to under-utilized food courts via real-time "Pulse" notifications.

---

## 🛠️ The Tech Stack

CrowdPulse is built as a high-performance Full-Stack TypeScript application designed for low-latency data streaming and sharp visual clarity.

### Frontend (The Control Center)
- **Framework**: [React 19](https://react.dev/) with [Vite](https://vitejs.dev/) for ultra-fast builds and HMR.
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) for a custom "Bento Box" grid system and cohesive dark-mode aesthetics.
- **UI Components**: Built on [Radix UI](https://www.radix-ui.com/) and [shadcn/ui](https://ui.shadcn.com/) for accessible, responsive design.
- **Visualizations**: [Recharts](https://recharts.org/) for responsive SVG trend mapping and critical threshold monitoring.
- **Animations**: [Motion](https://motion.dev/) for smooth state transitions and spatial overlays.
- **Icons**: [Lucide React](https://lucide.dev/) for sharp, scalable vector diagnostics.

### Backend (The Intelligence Layer)
- **Runtime**: [Node.js](https://nodejs.org/) with [Express](https://expressjs.com/).
- **Real-Time Data**: [Socket.io](https://socket.io/) for bidirectional, sub-100ms updates to zone density and incident feeds.
- **Database**: [SQLite](https://sqlite.org/) (via `better-sqlite3`) providing a lightweight, high-speed persistence layer for history and logs.
- **AI Engine**: [Google Gemini API](https://ai.google.dev/) (via `@google/genai`) integrated server-side to analyze venue health and generate proactive operational tips.

---

## 🚀 Key Features

- **Digital Twin Spatial View**: An abstract venue schematic with live sensor overlays.
- **"Wait Vector" Analytics**: Predictive metrics for current throughput vs. projected bottlenecking.
- **AIOps Automated Incidents**: Backend monitoring that auto-logs alerts when a zone exceeds 92% capacity.
- **Attendee "Venue Vitality" Page**: A lightweight, mobile-optimized view for venue guests to find the shortest lines via a "Find Nearest Green Zone" logic.
- **Responsive Viewports**: Optimized for large Control Room video walls, tablet-wielding concourse staff, and mobile attendees.

---

