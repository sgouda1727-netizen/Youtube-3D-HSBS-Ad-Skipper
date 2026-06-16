@echo off
title Publish to GitHub
cd /d "%~dp0"

echo ===================================================
echo     PUBLISHING YOUTUBE AD SKIPPER TO GITHUB
echo ===================================================
echo.

rem Check if git is installed and in PATH
set "GIT_FOUND=0"
where git >nul 2>nul
if %errorlevel% equ 0 set "GIT_FOUND=1"

rem Fallback: Check common installation directories
if "%GIT_FOUND%"=="0" if exist "C:\Program Files\Git\cmd\git.exe" (
    echo Found Git in C:\Program Files\Git
    set "PATH=%PATH%;C:\Program Files\Git\cmd"
    set "GIT_FOUND=1"
)
if "%GIT_FOUND%"=="0" if exist "C:\Program Files (x86)\Git\cmd\git.exe" (
    echo Found Git in C:\Program Files ^(x86^)\Git
    set "PATH=%PATH%;C:\Program Files ^(x86^)\Git\cmd"
    set "GIT_FOUND=1"
)
if "%GIT_FOUND%"=="0" if exist "%LocalAppData%\Programs\Git\cmd\git.exe" (
    echo Found Git in AppData Local Programs
    set "PATH=%PATH%;%LocalAppData%\Programs\Git\cmd"
    set "GIT_FOUND=1"
)
if "%GIT_FOUND%"=="0" if exist "%USERPROFILE%\AppData\Local\Programs\Git\cmd\git.exe" (
    echo Found Git in AppData Local Programs (UserProfile)
    set "PATH=%PATH%;%USERPROFILE%\AppData\Local\Programs\Git\cmd"
    set "GIT_FOUND=1"
)

if "%GIT_FOUND%"=="0" (
    echo [ERROR] Git is not installed or not in your PATH.
    echo Please install Git from https://git-scm.com/ and try again.
    echo.
    pause
    exit /b
)

rem Create .gitignore if it doesn't exist
if not exist .gitignore (
    echo Creating .gitignore...
    echo # System files > .gitignore
    echo .DS_Store >> .gitignore
    echo Thumbs.db >> .gitignore
    echo. >> .gitignore
    echo # Python cache >> .gitignore
    echo __pycache__/ >> .gitignore
    echo *.pyc >> .gitignore
    echo. >> .gitignore
    echo # Local settings >> .gitignore
    echo .vscode/ >> .gitignore
    echo .idea/ >> .gitignore
)

rem Check if .git folder exists
if not exist .git (
    echo Initializing git repository...
    git init
)

if not exist .git (
    echo [ERROR] Failed to initialize git.
    pause
    exit /b
)

rem Add files
echo.
echo Adding files to git...
git add .

rem Set temporary identity if none exists
git config user.name >nul 2>&1
if %errorlevel% neq 0 (
    echo Setting local repository git user name...
    git config --local user.name "AdSkipper Developer"
)
git config user.email >nul 2>&1
if %errorlevel% neq 0 (
    echo Setting local repository git user email...
    git config --local user.email "developer@example.com"
)

rem Commit
echo.
echo Committing files...
git commit -m "Initial commit of 3D HSBS Ad Skipper Extension"

rem Set branch to main
git branch -M main

echo.
echo ===================================================
echo   STEP 2: CREATE YOUR REMOTE GITHUB REPOSITORY
echo ===================================================
echo 1. Go to https://github.com and log in.
echo 2. Click the "New" button to create a new repository.
echo 3. Name it (e.g. "Youtube-3D-HSBS-Ad-Skipper").
echo 4. Leave "Add a README", ".gitignore", and "License" UNCHECKED.
echo 5. Click "Create repository".
echo.
echo After creating, copy the HTTPS or SSH link (looks like:
echo https://github.com/your-username/your-repo-name.git)
echo.

set /p repo_url="Enter your GitHub Repository URL: "

if "%repo_url%"=="" (
    echo [ERROR] Repository URL cannot be empty.
    pause
    exit /b
)

rem Check if origin already exists, remove it if so
git remote remove origin >nul 2>nul

echo Linking to remote repository...
git remote add origin %repo_url%

echo.
echo Pushing code to GitHub...
git push -u origin main

echo.
if %errorlevel% equ 0 (
    echo ===================================================
    echo             SUCCESSFULLY PUBLISHED!
    echo ===================================================
    echo Your extension code is now live on GitHub!
) else (
    echo ===================================================
    echo                 PUSH FAILED
    echo ===================================================
    echo If GitHub asks for authentication, please sign in.
    echo Make sure the repository URL was correct.
)
echo.
pause
