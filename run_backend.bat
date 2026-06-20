@echo off
REM Use the installed JDK 25 (Gradle toolchain also auto-detects it).
set "JAVA_HOME=C:\Program Files\Java\jdk-25.0.2"
cd backend\temnet_parser_2.0
call gradlew.bat bootRun
