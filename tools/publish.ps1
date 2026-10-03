# Builds the dashboard (pages + Pokedex data) and force-pushes it as a single commit to gh-pages.
# The world map is not published here; the dashboard embeds the live BlueMap via Tailscale Funnel.
# Skips the push when nothing changed. Run by the hourly scheduled task; safe to run by hand.
param([switch]$Force)

$ErrorActionPreference = 'Stop'
$site    = Split-Path $PSScriptRoot -Parent
$pub     = Join-Path $site '.publish'
$stage   = Join-Path $env:TEMP 'cobblemon-pages-stage'
$logFile = Join-Path $site 'publish.log'
$remote  = 'https://github.com/charles28lc/cobblemon-dashboard.git'

$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
$git = (Get-Command git -ErrorAction SilentlyContinue).Source
if (-not $git) {
  $git = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages') -Filter git.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match 'Git\.MinGit.*\\cmd\\git\.exe$' } | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $git) { throw 'git not found' }

function Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content $logFile $line
  Write-Output $line
  $all = Get-Content $logFile
  if ($all.Count -gt 300) { $all | Select-Object -Last 300 | Set-Content $logFile }
}

function Git { & $git -C $pub @args; if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed ($LASTEXITCODE)" } }

function Mirror($from, $to, [string[]]$excludeDirs = @()) {
  $opts = @('/MIR', '/R:2', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
  if ($excludeDirs) { $opts += '/XD'; $opts += $excludeDirs }
  & robocopy $from $to @opts | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy $from -> $to failed ($LASTEXITCODE)" }
}

try {
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
  New-Item -ItemType Directory $stage | Out-Null

  $pages = 'index.html', 'pokedex.html', 'join.html', 'commands.html', 'controls.html'
  foreach ($f in $pages + 'style.css', 'app.js', 'pokedex.js', 'species.json', 'favicon.svg') { Copy-Item (Join-Path $site $f) $stage }

  # Combined Pokedex (player names only, no UUIDs). Deterministic, so it only triggers a push when someone's dex changed.
  & (Join-Path $PSScriptRoot 'pokedex-data.ps1') -OutFile (Join-Path $stage 'pokedex-data.json')

  # GitHub Pages lets browsers reuse files for 10 min; fingerprint CSS/JS links so new HTML never pairs with old CSS.
  $ver = @{}
  foreach ($a in 'style.css', 'app.js', 'pokedex.js') { $ver[$a] = (Get-FileHash (Join-Path $stage $a) -Algorithm SHA256).Hash.Substring(0, 10).ToLower() }
  foreach ($page in $pages) {
    $p = Join-Path $stage $page
    $html = [IO.File]::ReadAllText($p)
    foreach ($a in $ver.Keys) { $html = $html.Replace("=`"$a`"", "=`"$a`?v=$($ver[$a])`"") }
    [IO.File]::WriteAllText($p, $html)
  }
  New-Item -ItemType File (Join-Path $stage '.nojekyll') | Out-Null

  if (-not (Test-Path (Join-Path $pub '.git'))) {
    New-Item -ItemType Directory -Force $pub | Out-Null
    & $git init -q -b gh-pages $pub
    Git config user.name 'charles28lc'
    Git config user.email '139080546+charles28lc@users.noreply.github.com'
    Git config core.autocrlf false
    Git remote add origin $remote
  }

  Mirror $stage $pub @('.git')

  Git add -A
  $changes = & $git -C $pub status --porcelain
  $hasHead = (& $git -C $pub rev-parse --verify -q HEAD) -ne $null
  if (-not $changes -and $hasHead -and -not $Force) { Log 'No changes; skipped.'; exit 0 }

  $msg = "Publish $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
  if ($hasHead) { Git commit -q --amend -m $msg } else { Git commit -q -m $msg }
  Git push -q --force origin gh-pages
  Git reflog expire --expire=now --all
  Git gc -q --prune=now

  $mb = [math]::Round((Get-ChildItem $stage -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)
  Log "Published: size=${mb}MB"
}
catch {
  Log "FAILED: $($_.Exception.Message)"
  exit 1
}
