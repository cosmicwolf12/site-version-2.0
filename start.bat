@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo Python dependencies are not installed yet.
    call setup.bat
    if errorlevel 1 exit /b 1
)

call npm.cmd start
