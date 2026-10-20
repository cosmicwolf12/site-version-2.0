@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (
    echo Python Launcher ^(py^) was not found. Install Python 3.10 or newer from python.org.
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo Creating a local Python virtual environment...
    py -3 -m venv .venv
    if errorlevel 1 goto :failed
)

echo Installing FastAPI dependencies...
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto :failed

echo.
echo Setup complete. Run start.bat to launch AeroView.
pause
exit /b 0

:failed
echo.
echo Setup failed. Check that Python 3.10+ and internet access are available.
pause
exit /b 1
