@echo off
cd frontend-react
if not exist node_modules (
    echo Installing dependencies...
    call npm install
)
call npm run dev
