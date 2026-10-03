# Builds species.json (the Pokedex tab's species list) from the Cobblemon jar.
# Re-run after a Cobblemon update:  powershell -File tools\build-species.ps1
# Output per species: dex number, id, display name, types, generation, and whether it can be found in the wild
# (has a wild spawn, or evolves from something that does).
param([string]$Jar = (Get-ChildItem 'C:\cobblemon-server\mods' -Filter 'Cobblemon-fabric-*.jar' | Select-Object -First 1).FullName)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($Jar)
function ReadJson($entry) { $r = New-Object IO.StreamReader($entry.Open()); try { $r.ReadToEnd() | ConvertFrom-Json } finally { $r.Close() } }

try {
  # Scan the raw text: herd spawns nest their "pokemon" entries deeper than single spawns do.
  $spawnable = @{}
  foreach ($e in $zip.Entries | Where-Object { $_.FullName -match '^data/cobblemon/spawn_pool_world/.+\.json$' }) {
    $r = New-Object IO.StreamReader($e.Open()); $text = $r.ReadToEnd(); $r.Close()
    foreach ($m in [regex]::Matches($text, '"pokemon"\s*:\s*"([a-z0-9_]+)')) { $spawnable[$m.Groups[1].Value] = $true }
  }

  $all = @{}
  foreach ($e in $zip.Entries | Where-Object { $_.FullName -match '^data/cobblemon/species/[^/]+/[^/]+\.json$' }) {
    $j = ReadJson $e
    if (-not $j.implemented) { continue }
    $id = $e.Name -replace '\.json$', ''
    $types = @($j.primaryType); if ($j.secondaryType) { $types += $j.secondaryType }
    $evo = @($j.evolutions | ForEach-Object { if ($_.result) { ($_.result -split ' ')[0].ToLower() } })
    $all[$id] = [pscustomobject]@{ id = $id; dex = [int]$j.nationalPokedexNumber; name = $j.name; types = $types; evo = $evo }
  }

  # Wild = spawns naturally, or is reachable by evolving something that does.
  $wild = @{}
  $queue = New-Object System.Collections.Queue
  foreach ($id in $all.Keys) { if ($spawnable[$id]) { $wild[$id] = $true; $queue.Enqueue($id) } }
  while ($queue.Count) { foreach ($n in $all[$queue.Dequeue()].evo) { if ($all[$n] -and -not $wild[$n]) { $wild[$n] = $true; $queue.Enqueue($n) } } }

  function Gen([int]$d) { foreach ($g in @(@(151,1),@(251,2),@(386,3),@(493,4),@(649,5),@(721,6),@(809,7),@(905,8))) { if ($d -le $g[0]) { return $g[1] } }; 9 }

  $out = $all.Values | Sort-Object dex | ForEach-Object {
    [ordered]@{ n = $_.dex; id = $_.id; name = $_.name; t = $_.types; g = (Gen $_.dex); w = [bool]$wild[$_.id] }
  }
  $path = Join-Path (Split-Path $PSScriptRoot -Parent) 'species.json'
  [IO.File]::WriteAllText($path, (ConvertTo-Json -InputObject @($out) -Compress -Depth 4), (New-Object Text.UTF8Encoding $false))
  "Wrote $path : $(@($out).Count) species, $((@($out) | Where-Object { $_.w }).Count) found in the wild"
}
finally { $zip.Dispose() }
