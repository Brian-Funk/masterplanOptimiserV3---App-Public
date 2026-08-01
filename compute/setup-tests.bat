@echo off
echo Setting up Python virtual environment for flow checker tests...

REM Navigate to compute directory
cd /d "%~dp0"

REM Create virtual environment if it doesn't exist
if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv
)

REM Activate virtual environment
echo Activating virtual environment...
call venv\Scripts\activate.bat

REM Upgrade pip
echo Upgrading pip...
python -m pip install --upgrade pip

REM Install requirements
echo Installing requirements...
pip install -r requirements.txt

echo.
echo Setup complete! Virtual environment is activated.
echo.
echo To run tests:
echo   pytest
echo   pytest -v
echo   pytest --cov=src --cov-report=html
echo.
echo To deactivate when done:
echo   deactivate
