@echo off
REM Installs or updates the app as Windows services. Double-click is enough:
REM install_services.ps1 asks for administrator rights and does the rest,
REM its header lists the options.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_services.ps1" %*
