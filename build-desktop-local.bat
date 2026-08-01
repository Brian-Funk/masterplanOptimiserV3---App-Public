@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Masterplan Optimiser - Local Desktop Build
color 0B

set "SCRIPT_DIR=%~dp0"
set "BACKEND_DIR=%SCRIPT_DIR%backend"
set "WEB_DIR=%SCRIPT_DIR%web"
set "DESKTOP_DIR=%SCRIPT_DIR%desktop"
set "BACKEND_PY=%BACKEND_DIR%\venv\Scripts\python.exe"

echo ============================================================
echo   Masterplan Optimiser - Local Windows Installer Build
echo ============================================================
echo.
echo   This builds the desktop installer locally so GitHub Actions
echo   does not need to store the build artefact.
echo.
echo   Output:
echo     %DESKTOP_DIR%\dist
echo.

cd /d "%SCRIPT_DIR%"

echo [1/6] Checking prerequisites...
where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js was not found in PATH.
    goto :fail
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo ERROR: npm.cmd was not found in PATH.
    goto :fail
)

if exist "%BACKEND_PY%" (
    echo       Using existing backend virtual environment.
) else (
    echo       Backend virtual environment not found. Creating it now...
    call :find_python
    if errorlevel 1 goto :fail
    %BASE_PYTHON% -m venv "%BACKEND_DIR%\venv"
    if errorlevel 1 goto :fail
)

echo       Prerequisites available.
echo.

echo [2/6] Installing backend and compute dependencies...
cd /d "%BACKEND_DIR%"
"%BACKEND_PY%" -m pip install --upgrade pip
if errorlevel 1 goto :fail
"%BACKEND_PY%" -m pip install -r requirements.txt
if errorlevel 1 goto :fail
"%BACKEND_PY%" -m pip install -r "%SCRIPT_DIR%compute\requirements.txt"
if errorlevel 1 goto :fail
"%BACKEND_PY%" -m pip install pyinstaller
if errorlevel 1 goto :fail
echo.

echo [3/6] Packaging backend with PyInstaller...
cd /d "%BACKEND_DIR%"

echo       Collecting Python runtime DLLs required by native imports...
if exist ".build-runtime-dlls" rmdir /s /q ".build-runtime-dlls"
mkdir ".build-runtime-dlls"
"%BACKEND_PY%" scripts\collect_runtime_dlls.py ".build-runtime-dlls"
if errorlevel 1 goto :fail

set "RUNTIME_BIN_ARGS="
for %%F in (.build-runtime-dlls\*.dll) do (
    if exist "%%F" set "RUNTIME_BIN_ARGS=!RUNTIME_BIN_ARGS! --add-binary=%%F;."
)

"%BACKEND_PY%" -m PyInstaller --noconfirm --onedir --name backend !RUNTIME_BIN_ARGS! ^
  --paths . ^
  --paths "%SCRIPT_DIR%compute\src" ^
  --hidden-import uvicorn.logging ^
  --hidden-import uvicorn.loops ^
  --hidden-import uvicorn.loops.auto ^
  --hidden-import uvicorn.protocols ^
  --hidden-import uvicorn.protocols.http ^
  --hidden-import uvicorn.protocols.http.auto ^
  --hidden-import uvicorn.protocols.websockets ^
  --hidden-import uvicorn.protocols.websockets.auto ^
  --hidden-import uvicorn.lifespan ^
  --hidden-import uvicorn.lifespan.on ^
  --hidden-import uvicorn.lifespan.off ^
  --hidden-import sqlalchemy.dialects.sqlite ^
  --hidden-import pydantic_settings ^
  --hidden-import multipart ^
  --hidden-import flow_checker ^
  --hidden-import fatigue_optimizer ^
  --collect-binaries cryptography ^
  --collect-binaries ortools ^
  --collect-binaries pydantic_core ^
  --copy-metadata keyring ^
  --collect-submodules app ^
  --collect-submodules keyring ^
  --collect-submodules ortools ^
  app/main.py
if errorlevel 1 goto :fail

echo       Checking packaged backend native imports...
set "MASTERPLAN_BACKEND_IMPORT_SMOKE=1"
"%BACKEND_DIR%\dist\backend\backend.exe"
set "MASTERPLAN_BACKEND_IMPORT_SMOKE="
if errorlevel 1 goto :fail

if exist "%BACKEND_DIR%\.env.desktop" (
    copy /Y "%BACKEND_DIR%\.env.desktop" "%BACKEND_DIR%\dist\backend\.env.desktop" >nul
) else (
    echo       WARNING: backend\.env.desktop was not found. Continuing without it.
)
echo.

echo [4/6] Installing frontend dependencies...
cd /d "%WEB_DIR%"
call npm.cmd ci
if errorlevel 1 goto :fail
echo.

echo [5/6] Installing desktop dependencies...
cd /d "%DESKTOP_DIR%"
call npm.cmd ci
if errorlevel 1 goto :fail
echo.

echo       Cleaning stale electron-builder winCodeSign cache...
if exist "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign" (
    rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign"
    if errorlevel 1 goto :fail
)
echo [6/6] Building Windows desktop installer...
echo       Local builds use an unsigned integrity manifest unless
echo       MANIFEST_SIGNING_KEY is set in this terminal.
echo       Disabling local code-signing certificate auto-discovery.
set "CSC_IDENTITY_AUTO_DISCOVERY=false"
cd /d "%DESKTOP_DIR%"
call npm.cmd run build:win
if errorlevel 1 goto :fail
echo.

echo ============================================================
echo   BUILD COMPLETE
echo ============================================================
echo.
echo   Installer location:
echo     %DESKTOP_DIR%\dist
echo.
dir /b "%DESKTOP_DIR%\dist\*.exe" 2>nul
echo.
pause
exit /b 0

:find_python
set "BASE_PYTHON="

py -3.11 --version >nul 2>&1
if not errorlevel 1 (
    set "BASE_PYTHON=py -3.11"
    exit /b 0
)

py -3 --version >nul 2>&1
if not errorlevel 1 (
    set "BASE_PYTHON=py -3"
    exit /b 0
)

python --version >nul 2>&1
if not errorlevel 1 (
    set "BASE_PYTHON=python"
    exit /b 0
)

echo ERROR: Python was not found. Install Python 3.11 or add it to PATH.
exit /b 1

:fail
echo.
echo ============================================================
echo   BUILD FAILED
echo ============================================================
echo.
echo   Check the error above. The build can be run again after fixing it.
echo.
pause
exit /b 1
