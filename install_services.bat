@echo off
setlocal
REM Registers backend and frontend as Windows services (NSSM): they start with
REM the server before anyone logs in and come back after a crash. Run from an
REM administrator console in the repo:
REM
REM   install_services.bat .\user password    install or update, run as that account
REM   install_services.bat                    install or update, keep the account
REM                                           (LocalSystem for a new service)
REM   install_services.bat remove             stop and delete both services
REM
REM Run as the account that starts the bat files by hand today: with-node.cjs
REM finds Node 18+ in that user's nvm, and the Claude CLI login is per user.
REM
REM Backend runs the boot jar, not `gradlew bootRun`: no Gradle daemon, no
REM DevTools, no orphan JVM on 8080. Frontend wraps run_frontend_prod.bat,
REM which rebuilds dist on every start. After `git pull`:
REM   frontend changes only   nssm restart temnet-frontend
REM   Java changes            install_services.bat again: it stops the
REM                           services first, the running JVM locks the jar

set "REPO=%~dp0"
set "REPO=%REPO:~0,-1%"
set "BACKEND=%REPO%\backend\temnet_parser_3.0"
set "JAR=%BACKEND%\build\libs\temnet_parser-0.0.1-SNAPSHOT.jar"

where nssm >NUL 2>&1
if errorlevel 1 (
    echo nssm.exe is not on PATH. On Windows 10 take the 2.24-101 build, the
    echo 2.24 release fails to start services there:
    echo https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip
    echo Keep it in a permanent folder such as C:\nssm: the services run it from there.
    exit /b 1
)

if /i "%~1"=="remove" (
    nssm stop temnet-frontend
    nssm remove temnet-frontend confirm
    nssm stop temnet-backend
    nssm remove temnet-backend confirm
    exit /b 0
)

REM JDK 25 for gradlew and the service: the install run_backend.bat prefers,
REM else JAVA_HOME.
for /d %%j in ("C:\Program Files\Java\jdk-25*") do set "JAVA_HOME=%%~fj"
findstr /r /c:"JAVA_VERSION=.25" "%JAVA_HOME%\release" >NUL 2>&1
if errorlevel 1 (
    echo No JDK 25 in "C:\Program Files\Java" or JAVA_HOME: install one or point JAVA_HOME at it.
    exit /b 1
)
set "JAVA=%JAVA_HOME%\bin\java.exe"

REM MariaDB's service name differs between installers (MariaDB, MySQL, ...).
REM Running ones only: a stopped leftover would keep the backend down.
set "DB_SERVICE="
for /f "tokens=2" %%s in ('sc query ^| findstr /i "SERVICE_NAME" ^| findstr /i "maria mysql"') do if not defined DB_SERVICE set "DB_SERVICE=%%s"
if not defined DB_SERVICE (
    echo MariaDB service is not running: the backend will start without waiting for it.
)

sc query temnet-frontend >NUL 2>&1 && nssm stop temnet-frontend
sc query temnet-backend >NUL 2>&1 && nssm stop temnet-backend
for %%p in (8080 5173) do (
    netstat -ano | findstr /r /c:":%%p .*LISTENING" >NUL && (
        echo Port %%p is taken: close run_backend.bat and run_frontend_prod.bat first.
        exit /b 1
    )
)

echo Building the boot jar...
pushd "%BACKEND%"
call "%BACKEND%\gradlew.bat" bootJar -q --no-daemon || exit /b 1
popd
if not exist "%JAR%" (
    echo Jar not found at "%JAR%": the version in build.gradle changed, update JAR above.
    exit /b 1
)
if not exist "%REPO%\logs" mkdir "%REPO%\logs"

sc query temnet-backend >NUL 2>&1 || nssm install temnet-backend "%JAVA%"
nssm set temnet-backend Application "%JAVA%"
nssm set temnet-backend AppParameters -jar "\"%JAR%\""
nssm set temnet-backend AppDirectory "%BACKEND%"
nssm set temnet-backend DisplayName "Temnet Parser backend"
nssm set temnet-backend Start SERVICE_DELAYED_AUTO_START
if defined DB_SERVICE nssm set temnet-backend DependOnService %DB_SERVICE%
nssm set temnet-backend AppStdout "%REPO%\logs\backend.log"
nssm set temnet-backend AppStderr "%REPO%\logs\backend.log"
nssm set temnet-backend AppRotateFiles 1
REM A new log file on every start. Rotation while running (AppRotateOnline 1)
REM left a crashed JVM unrestarted, the service hung in RUNNING (nssm
REM 2.24-101, 2026-09-28).
nssm set temnet-backend AppRotateOnline 0
REM Settings that differ from the application.properties defaults (DB_PASSWORD
REM and the like) go into `nssm edit temnet-backend`, Environment tab; a re-run
REM keeps them. A LocalSystem service does not see anyone's user variables.

sc query temnet-frontend >NUL 2>&1 || nssm install temnet-frontend "%ComSpec%"
nssm set temnet-frontend Application "%ComSpec%"
nssm set temnet-frontend AppParameters /c "\"%REPO%\run_frontend_prod.bat\""
nssm set temnet-frontend AppDirectory "%REPO%"
nssm set temnet-frontend DisplayName "Temnet Parser frontend"
nssm set temnet-frontend Start SERVICE_DELAYED_AUTO_START
nssm set temnet-frontend AppStdout "%REPO%\logs\frontend.log"
nssm set temnet-frontend AppStderr "%REPO%\logs\frontend.log"
nssm set temnet-frontend AppRotateFiles 1
nssm set temnet-frontend AppRotateOnline 0

if not "%~1"=="" (
    nssm set temnet-backend ObjectName "%~1" "%~2"
    nssm set temnet-frontend ObjectName "%~1" "%~2"
)

nssm start temnet-backend
nssm start temnet-frontend
echo.
echo The frontend rebuilds dist before :5173 answers. Check:
echo   curl http://localhost:8080/api/auth/me    401 = backend alive
echo   logs in "%REPO%\logs"
