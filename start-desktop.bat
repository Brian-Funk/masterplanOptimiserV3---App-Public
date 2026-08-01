@echo off
setlocal enabledelayedexpansion
REM Start Masterplan Optimiser Desktop Application
REM This launches the Electron wrapper which starts all services

echo ========================================
echo Masterplan Optimiser - Desktop App
echo ========================================
echo.

REM ── Find Python ──
REM Check known real installations first (avoids Windows Store stub)
set PYTHON_EXE=
if exist "%USERPROFILE%\anaconda3\python.exe" set PYTHON_EXE=%USERPROFILE%\anaconda3\python.exe&& goto :found_python
if exist "C:\Python313\python.exe" set PYTHON_EXE=C:\Python313\python.exe&& goto :found_python
if exist "C:\Python312\python.exe" set PYTHON_EXE=C:\Python312\python.exe&& goto :found_python
if exist "C:\Python311\python.exe" set PYTHON_EXE=C:\Python311\python.exe&& goto :found_python
REM Fall back to PATH with validation
where py >nul 2>&1 && set PYTHON_EXE=py&& goto :validate_python
where python3 >nul 2>&1 && set PYTHON_EXE=python3&& goto :validate_python
where python >nul 2>&1 && set PYTHON_EXE=python&& goto :validate_python
goto :no_python

:validate_python
"%PYTHON_EXE%" --version >nul 2>&1
if errorlevel 1 (
    echo WARNING: "%PYTHON_EXE%" is not a real Python (Windows Store alias?^)
    set PYTHON_EXE=
    goto :no_python
)
goto :found_python

:no_python
echo ERROR: Python is not installed or not in PATH.
echo Searched: anaconda3, C:\Python31x, py, python3, python
echo Disable the Windows Store alias: Settings ^> Apps ^> App execution aliases ^> python.exe OFF
pause
exit /b 1

:found_python
echo Found Python: %PYTHON_EXE%

REM ── Create backend venv if missing or broken ──
if not exist backend\venv\Scripts\python.exe (
    echo Creating backend virtual environment...
    "%PYTHON_EXE%" -m venv backend\venv
    if errorlevel 1 (
        echo ERROR: Failed to create backend venv
        pause
        exit /b 1
    )
    echo Installing backend dependencies...
    call backend\venv\Scripts\activate
    pip install -q -r backend\requirements.txt
    pip install -q -r compute\requirements.txt
) else (
    call backend\venv\Scripts\activate
)
echo.

echo Starting desktop application...
echo This will launch:
echo   - Backend API (localhost:8000, includes optimizer)
echo   - Frontend UI (localhost:3000)
echo   - Electron Window
echo.

cd desktop
call npm start

echo.
echo Desktop application closed.
pause
