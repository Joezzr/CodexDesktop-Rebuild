function DirSizes($roots, $minGB) {
  foreach ($r in $roots) {
    if (!(Test-Path $r)) { continue }
    $items = Get-ChildItem -Path $r -Directory -Force -ErrorAction SilentlyContinue
    foreach ($it in $items) {
      # skip junction/reparse points to avoid double-counting
      if ($it.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
      $b = (Get-ChildItem -Path $it.FullName -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
      $gb = [math]::Round($b/1GB,1)
      if ($gb -ge $minGB) { Write-Output ("{0,7} GB  {1}" -f $gb, $it.FullName) }
    }
  }
}
Write-Output "== AppData\Local >2GB =="
DirSizes @("C:\Users\Kal\AppData\Local") 2
Write-Output "== AppData\Roaming >1GB =="
DirSizes @("C:\Users\Kal\AppData\Roaming") 1