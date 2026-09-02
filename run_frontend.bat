@echo off
setlocal
cd /d "%~dp0frontend-react"

REM Vite needs Node 18+. scripts\with-node.cjs runs npm under the newest
REM Node 18+ installed by nvm-windows when the Node on PATH is older, so the
REM global "nvm use" is never touched. It explains what to install otherwise.
if not exist node_modules (
    echo Installing dependencies...
    node scripts\with-node.cjs install
    if errorlevel 1 exit /b 1
)
node scripts\with-node.cjs run dev
