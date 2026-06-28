@echo off
setlocal enabledelayedexpansion

if "%~1"=="" (
    echo Usage: process.bat ^<path_to_pdf^>
    pause
    exit /b 1
)

:: Check if Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Python is required but not installed or not in PATH.
    echo Please install Python 3 from https://www.python.org/ and check "Add Python to PATH"
    pause
    exit /b 1
)

:: Run script
python "%~dp0process_pdf.py" "%~1"

pause
