# Installs or updates the backend and the frontend as Windows services (NSSM):
# they start with the server before anyone logs in and come back after a
# crash. Started by install_services.bat, which is all there is to run:
#
#   install_services.bat                          install or update
#   install_services.bat -Account LocalSystem     same, no account prompt
#   install_services.bat remove                   stop and delete both services
#
# Everything else is done here: administrator rights, NSSM download, the
# service account, stopping the bat files started by hand, carrying their
# environment into the services, building the jar, waiting for both ports.
#
# Backend runs the boot jar, not `gradlew bootRun`: no Gradle daemon, no
# DevTools, no orphan JVM on 8080. Frontend wraps run_frontend_prod.bat, which
# rebuilds dist on every start. After `git pull`:
#   frontend changes only   nssm restart temnet-frontend
#   Java changes            install_services.bat again: it stops the services
#                           first, the running JVM locks the jar
#
# ASCII only: Windows PowerShell 5.1 reads a script without BOM in the ANSI
# code page.
param([string]$Action = 'install', [string]$Account, [switch]$Pause)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # the progress bar slows Invoke-WebRequest tenfold

$repo = $PSScriptRoot
$backend = Join-Path $repo 'backend\temnet_parser_3.0'
$jar = Join-Path $backend 'build\libs\temnet_parser-0.0.1-SNAPSHOT.jar'
$logs = Join-Path $repo 'logs'
$nssmDir = Join-Path $env:ProgramFiles 'nssm'
$nssm = Join-Path $nssmDir 'nssm.exe'

# On Windows 10 the 2.24 release fails to start services, 2.24-101 works.
# Hashes of the nssm.exe inside the zip, taken from nssm.cc on 2026-09-28.
$nssmUrl = 'https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip'
$nssmHash = @{
    win64 = 'EEE9C44C29C2BE011F1F1E43BB8C3FCA888CB81053022EC5A0060035DE16D848'
    win32 = '682F1025B4C410AE78B1C5BDC4DE7AD315F2EFF292C66947C13969930028C98D'
}

Add-Type -Namespace Win32 -Name Native -MemberDefinition @'
[DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern bool LogonUser(string user, string domain, string password, int type, int provider, out IntPtr token);
[DllImport("kernel32.dll")]
public static extern bool CloseHandle(IntPtr handle);
[DllImport("user32.dll", CharSet = CharSet.Unicode)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);
'@

# Runs nssm with its own command line: PowerShell 5.1 mangles arguments that
# contain quotes (AppParameters, passwords). Output is shown only on failure.
function Invoke-Nssm {
    $argv = $args
    $line = ($argv | ForEach-Object { '"' + ([string]$_ -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"' }) -join ' '
    $out = [IO.Path]::GetTempFileName()
    $p = Start-Process $nssm -ArgumentList $line -NoNewWindow -Wait -PassThru -RedirectStandardOutput $out -RedirectStandardError "$out.err"
    $text = (Get-Content $out, "$out.err" -ErrorAction SilentlyContinue | Where-Object { $_.Trim() }) -join ' '
    Remove-Item $out, "$out.err" -ErrorAction SilentlyContinue
    if ($p.ExitCode -ne 0) { throw "nssm $($argv[0]) $($argv[1]): $text" }
}

function Install-Nssm {
    $arch = if ([Environment]::Is64BitOperatingSystem) { 'win64' } else { 'win32' }
    Write-Host "Downloading NSSM from $nssmUrl ..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $zip = Join-Path $env:TEMP 'nssm-2.24-101.zip'
    $unpacked = Join-Path $env:TEMP 'nssm-2.24-101'
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $nssmUrl -OutFile $zip
    } catch {
        throw "NSSM download failed ($($_.Exception.Message)). Put nssm.exe 2.24-101 ($arch) into $nssmDir by hand and run again."
    }
    Expand-Archive -Path $zip -DestinationPath $unpacked -Force
    $exe = Join-Path $unpacked "nssm-2.24-101-g897c7ad\$arch\nssm.exe"
    if ((Get-FileHash $exe -Algorithm SHA256).Hash -ne $nssmHash[$arch]) {
        throw "Downloaded nssm.exe does not match the known hash, not installing it."
    }
    New-Item -ItemType Directory -Force $nssmDir | Out-Null
    Copy-Item $exe $nssm
    Remove-Item $zip, $unpacked -Recurse -Force -ErrorAction SilentlyContinue

    # Machine PATH, so `nssm restart ...` works in new consoles. Read and
    # written raw: [Environment]::SetEnvironmentVariable would store it as
    # REG_SZ and break every %SystemRoot% entry in it.
    $key = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\CurrentControlSet\Control\Session Manager\Environment', $true)
    $path = $key.GetValue('Path', '', 'DoNotExpandEnvironmentNames')
    if (($path -split ';') -notcontains $nssmDir) {
        $key.SetValue('Path', $path.TrimEnd(';') + ';' + $nssmDir, 'ExpandString')
        $r = [UIntPtr]::Zero
        [void][Win32.Native]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$r)
    }
    $key.Close()
    Write-Host "NSSM installed to $nssmDir"
}

function Major($version) { [int]($version -replace '^v?(\d+).*$', '$1') }

# Node 18+ the way scripts\with-node.cjs looks for it: PATH first, then nvm.
function Find-NodeDir {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($node -and (Major (& $node.Source --version)) -ge 18) { return Split-Path $node.Source }
    $roots = @($env:NVM_HOME, $(if ($env:APPDATA) { Join-Path $env:APPDATA 'nvm' })) | Where-Object { $_ -and (Test-Path $_) }
    if (-not $roots) { return $null }
    Get-ChildItem $roots -Directory |
        Where-Object { $_.Name -match '^v?\d' -and (Major $_.Name) -ge 18 -and (Test-Path (Join-Path $_.FullName 'node.exe')) } |
        Sort-Object { Major $_.Name } | Select-Object -Last 1 -ExpandProperty FullName
}

# Network logon checks the password without the "log on as a service" right,
# which nssm grants later. Only a definite wrong password stops the install.
function Test-Password($account, $password) {
    $domain, $user = if ($account -match '\\') { $account -split '\\', 2 } else { $null, $account }
    $token = [IntPtr]::Zero
    if ([Win32.Native]::LogonUser($user, $domain, $password, 3, 0, [ref]$token)) {
        [void][Win32.Native]::CloseHandle($token)
        return $true
    }
    $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    if ($code -eq 1326) { Write-Host 'Wrong account name or password.' -ForegroundColor Red; return $false }
    Write-Warning "Could not check the password (Windows error $code), going on."
    return $true
}

# Merges NAME=value pairs into the service's AppEnvironmentExtra; entries
# added by hand with `nssm edit` stay.
function Set-ServiceEnvironment($name, $vars) {
    $key = "HKLM:\SYSTEM\CurrentControlSet\Services\$name\Parameters"
    $kept = @((Get-ItemProperty $key -ErrorAction SilentlyContinue).AppEnvironmentExtra) |
        Where-Object { $_ -and -not $vars.Contains(($_ -split '=', 2)[0]) }
    $all = @($kept) + @($vars.Keys | ForEach-Object { "$_=$($vars[$_])" })
    Set-ItemProperty $key AppEnvironmentExtra ([string[]]$all) -Type MultiString
}

function Get-Status($url) {
    try {
        $request = [Net.WebRequest]::Create($url)
        $request.Proxy = $null
        $request.Timeout = 5000
        $response = $request.GetResponse()
        $code = [int]$response.StatusCode
        $response.Close()
        $code
    } catch [Net.WebException] {
        if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    }
}

function Wait-Ready($url, $expected, $seconds, $log) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        if ((Get-Status $url) -eq $expected) { return }
        Start-Sleep -Seconds 3
    }
    Write-Host "--- last lines of $log" -ForegroundColor Yellow
    Get-Content $log -Tail 30 -ErrorAction SilentlyContinue | Write-Host
    throw "$url did not answer $expected within $seconds s, see $log"
}

$failed = $false
try {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        $relaunch = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" $Action -Pause"
        if ($Account) { $relaunch += " -Account `"$Account`"" }
        Start-Process powershell.exe -Verb RunAs -ArgumentList $relaunch
        return
    }
    if (-not (Test-Path $nssm)) { Install-Nssm }
    $services = 'temnet-backend', 'temnet-frontend'

    if ($Action -eq 'remove') {
        foreach ($name in $services) {
            if (Get-Service $name -ErrorAction SilentlyContinue) {
                Stop-Service $name
                Invoke-Nssm remove $name confirm
                Write-Host "Removed $name"
            }
        }
        return
    }
    if ($Action -ne 'install') { throw "Unknown action '$Action': install or remove." }

    # JDK 25: the install run_backend.bat prefers, else JAVA_HOME.
    $jdk = Get-ChildItem (Join-Path $env:ProgramFiles 'Java') -Directory -Filter 'jdk-25*' -ErrorAction SilentlyContinue |
        Sort-Object Name | Select-Object -Last 1
    $javaHome = if ($jdk) { $jdk.FullName } else { $env:JAVA_HOME }
    if (-not $javaHome -or -not (Select-String -Quiet -Pattern 'JAVA_VERSION="25' -Path (Join-Path $javaHome 'release') -ErrorAction SilentlyContinue)) {
        throw "No JDK 25 in $env:ProgramFiles\Java or JAVA_HOME: install one or point JAVA_HOME at it."
    }
    $java = Join-Path $javaHome 'bin\java.exe'

    $nodeDir = Find-NodeDir
    if (-not $nodeDir) { throw 'Node.js 18+ not found on PATH or in nvm: install it (nvm install 22) and run again.' }

    # Run as the account that starts the bat files by hand today: nvm, the
    # Claude CLI login and user settings belong to it.
    $current = (Get-CimInstance Win32_Service -Filter "Name='temnet-backend'").StartName
    if (-not $Account) {
        $default = if ($current) { $current } else { "$env:USERDOMAIN\$env:USERNAME" }
        $Account = Read-Host "Service account [$default] (or LocalSystem)"
        if (-not $Account) { $Account = $default }
    }
    $password = $null
    $setAccount = $Account -ne $current
    if ($setAccount -and $Account -ne 'LocalSystem') {
        do {
            $secure = Read-Host "Password for $Account" -AsSecureString
            $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
        } until (Test-Password $Account $password)
    }

    # The environment run_backend.bat had when started by hand: the variables
    # application.properties reads, from this session and from the git-ignored
    # run_backend_local.bat. PATH too, which gives the frontend its Node 18+
    # and the backend the claude CLI however the service account logs on.
    $names = Select-String -Path (Join-Path $backend 'src\main\resources\application.properties') -Pattern '\$\{([A-Z0-9_]+):' -AllMatches |
        ForEach-Object { $_.Matches } | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
    $backendEnv = [ordered]@{}
    foreach ($n in $names) {
        $value = [Environment]::GetEnvironmentVariable($n)
        if ($value) { $backendEnv[$n] = $value }
    }
    $localBat = Join-Path $repo 'run_backend_local.bat'
    if (Test-Path $localBat) {
        foreach ($line in Get-Content $localBat) {
            if ($line -match '^\s*set\s+"?([A-Za-z0-9_]+)=(.*?)"?\s*$' -and $names -contains $Matches[1]) {
                $backendEnv[$Matches[1]] = $Matches[2]
            }
        }
    }
    $settingNames = @($backendEnv.Keys)
    $backendEnv['PATH'] = $env:Path
    $frontendEnv = [ordered]@{ PATH = "$nodeDir;$env:Path" }

    # MariaDB's service name differs between installers (MariaDB, MySQL, ...).
    # Running ones only: a stopped leftover would keep the backend down.
    $db = Get-Service | Where-Object { $_.Status -eq 'Running' -and $_.Name -match 'maria|mysql' } |
        Select-Object -First 1 -ExpandProperty Name
    if (-not $db) { Write-Warning 'MariaDB service is not running: the backend will start without waiting for it.' }

    foreach ($name in $services) {
        if (Get-Service $name -ErrorAction SilentlyContinue) { Write-Host "Stopping $name"; Stop-Service $name }
    }
    # The bat files started by hand hold the ports: stop what belongs to this
    # repo (bootRun's JVM, vite's node), refuse to touch anything else.
    foreach ($port in 8080, 5173) {
        $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($id in $owners) {
            $p = Get-CimInstance Win32_Process -Filter "ProcessId=$id"
            $cmd = "$($p.CommandLine)".Replace('/', '\')
            if ($cmd.IndexOf($repo, [StringComparison]::OrdinalIgnoreCase) -lt 0 -and $cmd -notmatch 'com\.temnet\.') {
                throw "Port $port is taken by $($p.Name) (pid $id), which is not this app: free the port and run again."
            }
            Write-Host "Stopping $($p.Name) (pid $id) started by hand on port $port"
            Stop-Process -Id $id -Force
        }
        for ($i = 0; $i -lt 20 -and (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue); $i++) {
            Start-Sleep -Milliseconds 500
        }
    }

    Write-Host 'Building the boot jar...'
    $env:JAVA_HOME = $javaHome
    $build = Start-Process (Join-Path $backend 'gradlew.bat') -ArgumentList 'bootJar -q --no-daemon' -WorkingDirectory $backend -NoNewWindow -Wait -PassThru
    if ($build.ExitCode -ne 0) { throw "gradlew bootJar failed with exit code $($build.ExitCode)." }
    if (-not (Test-Path $jar)) { throw "Jar not found at $jar`: the version in build.gradle changed, update `$jar above." }
    New-Item -ItemType Directory -Force $logs | Out-Null

    $config = @{
        'temnet-backend'  = @{ Display = 'Temnet Parser backend'; App = $java; Params = "-jar `"$jar`""
                               Dir = $backend; Log = 'backend.log'; Env = $backendEnv }
        'temnet-frontend' = @{ Display = 'Temnet Parser frontend'; App = $env:ComSpec; Params = "/c `"$(Join-Path $repo 'run_frontend_prod.bat')`""
                               Dir = $repo; Log = 'frontend.log'; Env = $frontendEnv }
    }
    foreach ($name in $services) {
        $c = $config[$name]
        if (-not (Get-Service $name -ErrorAction SilentlyContinue)) { Invoke-Nssm install $name $c.App }
        # Quoted, and this nssm even when an earlier one registered the service.
        Set-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\$name" ImagePath "`"$nssm`""
        Invoke-Nssm set $name Application $c.App
        Invoke-Nssm set $name AppParameters $c.Params
        Invoke-Nssm set $name AppDirectory $c.Dir
        Invoke-Nssm set $name DisplayName $c.Display
        Invoke-Nssm set $name Start SERVICE_DELAYED_AUTO_START
        Invoke-Nssm set $name AppStdout (Join-Path $logs $c.Log)
        Invoke-Nssm set $name AppStderr (Join-Path $logs $c.Log)
        # A new log file on every start. Rotation while running
        # (AppRotateOnline 1) left a crashed JVM unrestarted and the frontend
        # unstoppable, both hung in RUNNING (nssm 2.24-101, 2026-09-28).
        Invoke-Nssm set $name AppRotateFiles 1
        Invoke-Nssm set $name AppRotateOnline 0
        Set-ServiceEnvironment $name $c.Env
        if ($setAccount) {
            if ($password) { Invoke-Nssm set $name ObjectName $Account $password }
            else { Invoke-Nssm set $name ObjectName $Account }
        }
    }
    if ($db) { Invoke-Nssm set temnet-backend DependOnService $db }

    foreach ($name in $services) { Write-Host "Starting $name"; Invoke-Nssm start $name }
    Write-Host 'Waiting for the backend...'
    Wait-Ready 'http://localhost:8080/api/auth/me' 401 180 (Join-Path $logs 'backend.log')
    Write-Host 'Waiting for the frontend, it rebuilds dist first...'
    Wait-Ready 'http://localhost:5173/' 200 600 (Join-Path $logs 'frontend.log')

    $account = (Get-CimInstance Win32_Service -Filter "Name='temnet-backend'").StartName
    Write-Host ''
    Write-Host "Done: both services run as $account and start with Windows." -ForegroundColor Green
    if ($settingNames) { Write-Host "Backend settings carried over: $($settingNames -join ', ')" }
    Write-Host "App: http://localhost:5173, logs: $logs"
} catch {
    $failed = $true
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    if ($Pause) { Read-Host 'Press Enter to close' | Out-Null }
}
if ($failed) { exit 1 }
