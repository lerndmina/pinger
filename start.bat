REM start.bat
@echo off
setlocal enabledelayedexpansion

echo Checking prerequisites...

REM Check for Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js is not installed. Please install from https://nodejs.org
    exit /b 1
)

REM Check for Python (python3 or python)
where python3 >nul 2>&1
if %errorlevel% equ 0 (
    echo Found Python: python3 && python3 --version
    set PYTHON_CMD=python3
) else (
    where python >nul 2>&1
    if %errorlevel% equ 0 (
        echo Found Python: python && python --version
        set PYTHON_CMD=python
    ) else (
        echo Python is not installed. Please install from https://python.org
        exit /b 1
    )
)

REM Check for git
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo Git is not installed. Please install from https://git-scm.com/downloads/win
    exit /b 1
)

REM Check for Bun
where bun >nul 2>&1
if %errorlevel% neq 0 (
    echo Bun is not installed. Installing...
    powershell -Command "iwr https://bun.sh/install.ps1 -Useb | iex"
    if !errorlevel! neq 0 (
        echo Failed to install Bun
        exit /b 1
    )
)

REM Install dependencies
echo Installing dependencies...
call bun install
if %errorlevel% neq 0 (
    echo Failed to install dependencies
    exit /b 1
)

REM Start pinger with arguments or default
echo Starting pinger...
if "%~1"=="" (
    call bun run src/index.ts 1.1.1.1
) else (
    call bun run src/index.ts %*
)