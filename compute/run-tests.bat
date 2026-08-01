@echo off
REM Run tests in the virtual environment

cd /d "%~dp0"

if not exist "venv" (
    echo Virtual environment not found. Running setup...
    call setup-tests.bat
) else (
    call venv\Scripts\activate.bat
)

echo Running tests...
pytest %*

REM %* passes all command line arguments to pytest
REM Examples:
REM   run-tests.bat -v                                           (run all tests verbose)
REM   run-tests.bat --cov=src --cov-report=html                  (run with coverage)
REM   run-tests.bat tests/test_flow_checker.py                   (run only flow_checker tests)
REM   run-tests.bat tests/test_fatigue_optimizer.py              (run only optimiser tests)
REM   run-tests.bat tests/test_flow_checker.py -v                (run flow_checker tests verbose)
REM   run-tests.bat tests/test_fatigue_optimizer.py -v           (run optimiser tests verbose)
