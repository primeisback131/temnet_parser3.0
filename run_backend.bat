@echo off
REM Any JDK 17+ is enough to run Gradle itself: the JDK 25 the project needs is
REM downloaded automatically by the toolchain resolver (settings.gradle).
REM A locally installed JDK 25 is preferred when it is there.
if exist "C:\Program Files\Java\jdk-25.0.2\bin\java.exe" set "JAVA_HOME=C:\Program Files\Java\jdk-25.0.2"
cd backend\temnet_parser_3.0
chcp 65001 >NUL
call gradlew.bat bootRun
