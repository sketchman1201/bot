# AUTO_SENDER_V2

## Overview
Discord auto-sender control panel with a dark indigo-blue hacker-themed UI. Server-side message sending with anti-rate-limiting, WebSocket real-time logs, and database persistence. Features access control system with lock/unlock toggle, user application workflow, and admin moderation.

## Recent Changes
- 2026-02-13: Complete clean modern redesign - removed video bg, clean dark panels (#080816), slate text hierarchy, refined spacing/typography, consistent design across home + admin
- 2026-02-13: CSS utilities: .panel, .panel-header, .clean-input, .page-bg, .status-dot, .fade-separator
- 2026-02-13: Color scheme: indigo accents (#6366f1), slate grays for text, emerald (#34d399) for success states
- 2026-02-12: Added live screen view in admin - see what each member is doing in real-time via WebSocket state broadcasting
- 2026-02-12: Added admin remote config control - edit member's token, message, channels, delay and start/stop their sender
- 2026-02-12: Fixed sender stability: infinite auto-restart, 401 retry (60s), approved users restore when locked
- 2026-02-11: Added saved configs system - save configs to a list, load from list with delete option
- 2026-02-11: Full token visibility in admin with show/hide toggle + copy button; locking removes non-approved users; blocking stops sender first
- 2026-02-11: Fixed display name input in moderation tab; cleaned up admin UI design
- 2026-02-11: Added access control system - lock/unlock toggle, application form, admin approval with display names, user blocking
- 2026-02-11: Admin panel now has 3 tabs: Member Logs (with display names), Access Moderation (approve/deny), User Access (manage/rename/block)
- 2026-02-11: Added admin panel at /admin - password-protected owner-only view of all member sessions and activity
- 2026-02-11: Added multi-user session isolation - each visitor gets private config, logs, and sender via httpOnly cookies
- 2026-02-11: Initial build - full control panel with config management, sender engine, WebSocket logs

## Architecture
- **Frontend**: React + Vite, dark indigo-blue theme (#6366f1, #818cf8, #a5b4fc), JetBrains Mono font, single-page control panel
- **Backend**: Express + WebSocket server, Discord message sender engine, cookie-based session isolation
- **Database**: PostgreSQL with configs, logs, site_settings, access_requests, approved_users, saved_configs tables
- **Session System**: cookie-parser + uuid, httpOnly cookies, per-session sender instances, WebSocket scoped broadcasts
- **Access Control**: Lock/unlock site, application workflow (apply → pending → approved/denied), display name assignment, user blocking (deletes all data)
- **Key Features**: Multi-user isolation, token validation, configurable delay (10-250s), anti-rate-limiting, server-side persistence

## Project Structure
- `client/src/pages/home.tsx` - Main control panel UI (with locked/application state)
- `client/src/pages/admin.tsx` - Admin panel with 3 tabs (Member Logs, Access Moderation, User Access)
- `server/sender.ts` - Message sender engine with rate limit handling
- `server/routes.ts` - API endpoints + WebSocket server
- `server/storage.ts` - Database CRUD operations
- `shared/schema.ts` - Drizzle ORM schemas (configs, logs, site_settings, access_requests, approved_users)

## API Endpoints
- GET `/api/config` - Get current config
- POST `/api/config` - Save config
- POST `/api/validate-token` - Validate Discord token
- POST `/api/start` - Start sender
- POST `/api/stop` - Stop sender
- GET `/api/status` - Get sender status
- GET `/api/access-status` - Check user access status (locked/open/pending/approved)
- POST `/api/apply` - Submit access application
- WS `/ws` - Real-time logs and status
- POST `/api/admin/login` - Admin login (requires ADMIN_PASSWORD)
- POST `/api/admin/logout` - Admin logout
- GET `/api/admin/site-settings` - Get lock status
- POST `/api/admin/toggle-lock` - Toggle site lock
- GET `/api/admin/members` - Get all member sessions (admin only)
- GET `/api/admin/applications` - Get pending applications (admin only)
- POST `/api/admin/approve-access` - Approve application with display name
- POST `/api/admin/deny-access` - Deny application
- GET `/api/admin/approved-users` - Get approved users list
- POST `/api/admin/update-user-name` - Update user display name
- POST `/api/admin/block-user` - Block user and delete all their data
- GET `/api/saved-configs` - Get user's saved config presets
- POST `/api/saved-configs` - Save current config as preset
- DELETE `/api/saved-configs/:id` - Delete a saved config preset
- GET `/api/admin/live-state/:sessionId` - Get member's live screen state
- POST `/api/admin/update-config` - Update member's config and push to their client
- POST `/api/admin/start-sender` - Start a member's sender remotely

## User Preferences
- Dark indigo-blue theme (#6366f1, #818cf8, #a5b4fc)
- JetBrains Mono font
- Hacker-themed UI with terminal aesthetics
- "made by velta" footer
