@echo off
setlocal
cd /d "%~dp0frontend-react"

REM Production-style serving: build once, then serve the bundled dist on
REM :5173 for the whole network. A few files instead of hundreds of modules
REM and no HMR websocket, so it stays fast over port forwarding and slow links.
REM /api is proxied to the backend just like in dev (vite.config.ts).
if not exist node_modules (
    echo Installing dependencies...
    node scripts\with-node.cjs install
    if errorlevel 1 exit /b 1
)
node scripts\with-node.cjs run build
if errorlevel 1 exit /b 1
node scripts\with-node.cjs run preview
