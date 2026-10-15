WebScada Site Package (Runtime website)

What this is
- A runnable Windows folder: Spring Boot server + web UI + one published project + resources.
- NOT a single HTML file. Others open it in a browser over the network.

On the server
1. Copy/unzip to a writable folder (e.g. C:\WebScadaSite). Do NOT use Program Files.
2. Double-click start.bat (this package uses start-site defaults: opens /runtime).
3. Local browser: http://127.0.0.1:8787/runtime

For other PCs on the LAN
1. Find this machine IP (ipconfig).
2. Open http://SERVER_IP:8787/runtime
3. Windows Firewall: allow inbound TCP 8787.

Security
- API / WebSocket have NO login by default (intranet prototype).
- Do not expose to the public Internet without SCADA_API_TOKEN / reverse proxy.
- Optional: set SCADA_API_TOKEN and SCADA_AUTH_REQUIRED=true in .env

Stop
- stop.bat

Logs
- %TEMP%\WebScada-launch.log
- data\server.log
- diagnose.bat

Rebuild site zip from repo
- pnpm pack:win
- pnpm pack:site -- -ProjectId prj_xxx
  or Designer: File -> Export website package
