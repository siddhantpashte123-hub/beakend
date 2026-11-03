# 🔵 BlueBeakend

**Self-Hosted Firebase Alternative — 1-Command Install on Any Linux VPS**

BlueBeakend is a complete, production-ready **Backend-as-a-Service (BaaS)** platform that gives your **Flutter, Web, React/Next.js, and Python** apps drop-in **Authentication, Firestore-style Document Database, S3/MinIO Object Storage, Realtime WebSockets, a Next.js 14 Web Admin Console, and an Interactive VPS CLI (`bb`)** — running 100% on your own server with zero vendor lock-in.

---

## ⚡ 1-Command VPS Install

Run on a fresh **Ubuntu 20.04+ / Debian 11+ / RHEL 8+** VPS (Hetzner, Contabo, DigitalOcean, AWS, Vultr):

```bash
curl -fsSL https://get.bluebeakend.com | sudo bash
```

*(Or directly from GitHub:)*

```bash
curl -fsSL https://raw.githubusercontent.com/siddhantpashte123-hub/beakend/main/install.sh | sudo bash
```

What `install.sh` does automatically:
1. Detects OS (`Ubuntu`/`Debian`/`CentOS`/`Rocky`/`Alma`) & CPU architecture (`amd64`/`arm64`)
2. Verifies root privileges, ≥ 2 GB RAM, and ≥ 10 GB free disk
3. Installs Docker Engine, Docker Compose v2, `curl`, `git`, `jq`, `openssl`, and `ufw`
4. Deploys the stack to `/opt/bluebeakend`
5. Generates 256-bit cryptographic secrets (`POSTGRES_PASSWORD`, `JWT_SECRET`, `REDIS_PASSWORD`, `MINIO_ROOT_PASSWORD`, `ADMIN_PASSWORD`, `API_KEY`) into `/opt/bluebeakend/.env`
6. Prompts for an optional domain (defaults to your VPS public IP)
7. Starts `postgres`, `redis`, `minio`, `api`, `realtime`, `nginx`, and `certbot` via Docker Compose
8. Waits for healthchecks (`/healthz`) to pass
9. Locks down the firewall (`UFW`: allows `22`, `80`, `443`)
10. Installs `bb` and `bluebeakend` CLI commands to `/usr/local/bin`
11. Saves credentials to `/opt/bluebeakend/credentials.txt` and launches the interactive `bb` menu

---

## 🖥️ Interactive CLI (`bb`)

Type `bb` or `bluebeakend` anywhere on your server:

```text
╔══════════════════════════════════════════════════════════════════╗
║              🔵  BLUEBEAKEND  v1.0.0  🔵                         ║
║           Self-Hosted Firebase Alternative                       ║
╠══════════════════════════════════════════════════════════════════╣
║   [1]  🚀  INSTALL          (Setup on this VPS)                  ║
║   [2]  🗑️   UNINSTALL        (Remove everything)                  ║
║   [3]  📊  STATUS           (Health & Metrics)                   ║
║   [4]  ⬆️   UPDATE           (Pull latest version)                ║
║   [5]  🔑  API KEYS         (Manage project keys)                ║
║   [6]  👥  USERS            (Manage users)                       ║
║   [7]  💾  BACKUP           (Create/Restore backup)              ║
║   [8]  📜  LOGS             (View live logs)                     ║
║   [9]  🌐  DOMAIN & SSL     (Configure domain)                   ║
║   [10] ⚙️   SETTINGS         (SMTP, limits, etc.)                 ║
║   [11] 📖  DOCS             (Open API docs)                      ║
║   [12] ❌  EXIT                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

Direct non-interactive subcommands are also supported:

```bash
bb status
bb apikeys
bb users
bb backup
bb backup-now
bb logs api
bb docs
```

---

## 📱 Client SDKs

### JavaScript / TypeScript (`@bluebeakend/js` — `sdk/js`)

```javascript
import { Bluebeakend } from '@bluebeakend/js';

const bb = new Bluebeakend({
  apiKey: "bb_live_xxx",
  authDomain: "api.myapp.com",
  projectId: "my-app"
});

// Auth
await bb.auth.signup("user@x.com", "pass123");
await bb.auth.login("user@x.com", "pass123");

// Database
const doc = await bb.db.collection("todos").add({ title: "Buy milk", done: false });
const list = await bb.db.collection("todos").where("done", "==", false).get();
await bb.db.collection("todos").doc(doc.id).update({ done: true });

// Storage
const file = await bb.storage.upload(myFile, { folder: "avatars" });
const url = await bb.storage.getUrl(file.id);

// Realtime
bb.db.collection("todos").onSnapshot((changes) => console.log(changes));
```

### Python (`sdk/python`)

```python
from bluebeakend import Bluebeakend

bb = Bluebeakend(api_key="bb_live_xxx", auth_domain="api.myapp.com", project_id="my-app")
bb.auth.signup("user@x.com", "pass123")
doc = bb.db.collection("todos").add({"title": "Buy milk", "done": False})
items = bb.db.collection("todos").where("done", "==", False).get()
bb.db.collection("todos").doc(doc["id"]).update({"done": True})
```

### Flutter / Dart (`sdk/flutter`)

```dart
import 'package:bluebeakend/bluebeakend.dart';

final bb = Bluebeakend(apiKey: 'bb_live_xxx', authDomain: 'api.myapp.com', projectId: 'my-app');
await bb.auth.login('user@x.com', 'pass123');
final doc = await bb.db.collection('todos').add({'title': 'Buy milk', 'done': false});
bb.db.collection('todos').snapshots().listen(print);
```

---

## 🌐 Web Admin Console (`/admin`)

Built with **Next.js 14 + TailwindCSS + shadcn/ui + Recharts** (default dark theme, `#0066FF` primary accent):

- **Login (`/admin/login`)** — JWT admin sign-in + Forgot/Reset password flow
- **Dashboard (`/admin`)** — Total Users, Documents, Storage, Requests Today, 7-day request chart, Top Collections bar chart, Recent Activity feed, Quick Actions
- **Auth / Users (`/admin/users`)** — Search, filters, bulk ban/unban/delete, CSV export, slide-over User Detail drawer (sessions, activity, editable JSON metadata, password reset)
- **Database (`/admin/database`)** — Collections sidebar, paginated table, click-cell inline editing, JSON document editor, Query Builder, JSON Import/Export
- **Storage (`/admin/storage`)** — Multi-file drag & drop uploader, folders, image thumbnails, 1-click signed URL copy, usage bar
- **API Keys (`/admin/apikeys`)** — Create/revoke project keys, per-key request counters, Firebase-style JSON config export
- **Realtime (`/admin/realtime`)** — Live WebSocket connection counter, active channels, test event broadcaster & live stream inspector
- **Logs (`/admin/logs`)** — Live WebSocket log tail (`admin:logs`), level/service filters, search, `.log` download
- **Settings (`/admin/settings`)** — Branding, SMTP (+ test email), Rate limits, CORS, IP allowlist, Automated Backups, Danger Zone
- **Docs (`/admin/docs`)** — Live-key SDK snippets + embedded Swagger UI (`/docs`)

---

## 🔧 REST & WebSocket API Summary

All `/api/v1/*` endpoints require `X-API-Key: bb_live_...` (except `/health`, `/healthz`, `/docs`, and `/api/v1/admin/*` which uses admin `Bearer` JWT):

| Group | Endpoints |
|---|---|
| **Auth** (`/api/v1/auth`) | `POST /register`, `POST /login`, `POST /logout`, `POST /refresh`, `GET /me`, `PATCH /me`, `POST /password/forgot`, `POST /password/reset`, `POST /verify-email`, `GET /sessions`, `DELETE /sessions/:id`, `POST /oauth/google`, `POST /oauth/github` |
| **Database** (`/api/v1/db/:collection`) | `POST /`, `GET /`, `GET /:id`, `PATCH /:id`, `PUT /:id`, `DELETE /:id`, `POST /batch`, `POST /query`, `GET /count`, `WS /:collection/realtime` |
| **Storage** (`/api/v1/storage`) | `POST /upload`, `GET /list`, `POST /signed-url`, `GET /:fileId`, `GET /:fileId/download`, `DELETE /:fileId` |
| **Realtime** (`/realtime`) | `WS /realtime?token=JWT` — channels `db:{collection}`, `user:{userId}`, `custom:{name}` |
| **Admin** (`/api/v1/admin`) | `POST /login`, `GET /stats`, `GET/POST/PATCH/DELETE /users`, `GET/POST/DELETE /collections`, `GET/POST/DELETE /apikeys`, `GET /logs`, `GET /health`, `GET/PATCH /settings`, `GET/POST /backups` |
| **Health & Docs** | `GET /health`, `GET /healthz`, `GET /docs`, `GET /openapi.json` |

---

## 🧪 Local Development & Tests

```bash
# Build Next.js 14 Admin Console
npm run build:admin

# Run automated integration & SDK test suite
npm test

# Start server locally on 0.0.0.0:8080 (with demo seed data)
ADMIN_PASSWORD=admin123 SEED_DEMO=true npm start
```

---

## 📄 License

MIT © BlueBeakend Contributors
