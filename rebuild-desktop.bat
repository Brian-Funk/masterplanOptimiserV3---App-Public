@echo off
setlocal enabledelayedexpansion
title MasterplanOptimiserV3 - App Rebuild
color 0E

echo ============================================================
echo   MasterplanOptimiserV3 - App Rebuild (clean)
echo ============================================================
echo.
echo   This script will:
echo     1. Stop any running App services
echo     2. Re-install Python dependencies (pip, no cache)
echo     3. Re-install npm dependencies
echo     4. Restart Backend and Frontend
echo     5. Open the app in the browser
echo.
echo   Use this after changing backend Python code, requirements,
echo   or frontend code. All running services will be restarted.
echo.

rem ── Get script directory ──
set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

rem ════════════════════════════════════════════════════════════════
rem  1. STOP EXISTING SERVICES
rem ════════════════════════════════════════════════════════════════
echo [1/5] Stopping existing services...
taskkill /FI "WindowTitle eq Backend Server*" /T /F >nul 2>&1
taskkill /FI "WindowTitle eq Frontend Server*" /T /F >nul 2>&1
echo       Existing services stopped.

rem ════════════════════════════════════════════════════════════════
rem  2. CHECK PREREQUISITES
rem ════════════════════════════════════════════════════════════════
echo [2/5] Checking prerequisites...

rem ── Find Python ──
rem Check known real installations first (avoids Windows Store stub)
set PYTHON_EXE=
if exist "%USERPROFILE%\anaconda3\python.exe" set PYTHON_EXE=%USERPROFILE%\anaconda3\python.exe&& goto :found_python
if exist "C:\Python313\python.exe" set PYTHON_EXE=C:\Python313\python.exe&& goto :found_python
if exist "C:\Python312\python.exe" set PYTHON_EXE=C:\Python312\python.exe&& goto :found_python
if exist "C:\Python311\python.exe" set PYTHON_EXE=C:\Python311\python.exe&& goto :found_python
rem Fall back to PATH with validation
where py >nul 2>&1 && set PYTHON_EXE=py&& goto :validate_python
where python3 >nul 2>&1 && set PYTHON_EXE=python3&& goto :validate_python
where python >nul 2>&1 && set PYTHON_EXE=python&& goto :validate_python
goto :no_python

:validate_python
"%PYTHON_EXE%" --version >nul 2>&1
if errorlevel 1 (
    echo  WARNING: "%PYTHON_EXE%" is not a real Python (Windows Store alias?^)
    set PYTHON_EXE=
    goto :no_python
)
goto :found_python

:no_python
echo  ERROR: Python is not installed or not in PATH.
echo  Searched: anaconda3, C:\Python31x, py, python3, python
echo  Disable the Windows Store alias: Settings ^> Apps ^> App execution aliases ^> python.exe OFF
pause
exit /b 1

:found_python
echo       Found Python: %PYTHON_EXE%

node --version >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Node.js is not installed or not in PATH.
    pause
    exit /b 1
)
echo       Python and Node.js found.

rem ════════════════════════════════════════════════════════════════
rem  3. REBUILD BACKEND (pip install --no-cache-dir)
rem ════════════════════════════════════════════════════════════════
echo [3/5] Rebuilding backend dependencies...
cd backend
if exist venv (
    echo       Removing old backend venv...
    rmdir /s /q venv
)
echo       Creating Python virtual environment...
"%PYTHON_EXE%" -m venv venv
call venv\Scripts\activate
echo       Installing backend requirements (no-cache)...
pip install --no-cache-dir -q -r requirements.txt
pip install --no-cache-dir -q -r ..\compute\requirements.txt
cd ..

rem ════════════════════════════════════════════════════════════════
rem  4. REBUILD FRONTEND
rem ════════════════════════════════════════════════════════════════
echo [4/5] Rebuilding frontend...
cd web
echo       Installing npm dependencies...
call npm install

rem Clear Next.js cache
if exist ".next" (
    echo       Clearing Next.js build cache...
    rmdir /s /q ".next"
)
cd ..

rem ════════════════════════════════════════════════════════════════
rem  5. START ALL SERVICES
rem ════════════════════════════════════════════════════════════════
echo [5/5] Starting all services...

echo       Starting Backend (FastAPI + Compute)...
start "Backend Server" cmd /k "cd /d %SCRIPT_DIR%backend && call venv\Scripts\activate && set PYTHONPATH=%SCRIPT_DIR%compute\src;%%PYTHONPATH%% && python -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
timeout /t 3 /nobreak >nul

echo       Starting Frontend (Next.js dev)...
start "Frontend Server" cmd /k "cd /d %SCRIPT_DIR%web && npm run dev"
timeout /t 5 /nobreak >nul

echo       Opening application...
start http://localhost:3000

echo.
echo ============================================================
echo   APP REBUILD COMPLETE
echo ============================================================
echo.
echo   Backend:    http://localhost:8000  (includes optimizer at /compute)
echo   Frontend:   http://localhost:3000
echo.
echo   Press any key to stop all services...
echo ============================================================
pause >nul

echo.
echo Stopping all services...
taskkill /FI "WindowTitle eq Backend Server*" /T /F >nul 2>&1
taskkill /FI "WindowTitle eq Frontend Server*" /T /F >nul 2>&1

echo All services stopped.
pause
exit /b 0

