@echo off
setlocal enabledelayedexpansion

echo Checking prerequisites...

call :check_dependency "Node.js" "node" "https://nodejs.org" ""
call :check_dependency "Git" "git" "https://git-scm.com/downloads/win" ""
call :check_dependency "Python" "python" "https://www.python.org/downloads/" "You might see 'Python was not found' error if you don't have Python installed. You can download it from here https://www.python.org/downloads/ DO NOT DOWNLOAD FROM THE MICROSOFT STORE."

REM Special handling for Bun as it needs installation
call :check_bun

goto :main

:check_dependency
set NAME=%~1
set CMD=%~2
set URL=%~3
set EXTRA_MSG=%~4

if not "%EXTRA_MSG%"=="" echo %EXTRA_MSG%
where %CMD% >nul 2>&1
if %errorlevel% neq 0 (
    echo %NAME% is not installed. Please install from %URL%
    exit /b 1
)
%CMD% --version
exit /b 0

:check_bun
where bun >nul 2>&1
if %errorlevel% equ 0 (
    echo Found Bun: && bun --version
    exit /b 0
)

echo Installing Bun...
powershell -Command "iwr https://bun.sh/install.ps1 -Useb | iex"
if !errorlevel! neq 0 (
    echo Failed to install Bun
    exit /b 1
)
exit /b 0

:main
REM Start pinger with arguments or default
echo:
echo:
echo Starting pinger...
echo:
echo:
if "%~1"=="" (
    call bun run src/index.ts 1.1.1.1
) else (
    call bun run src/index.ts %*
)