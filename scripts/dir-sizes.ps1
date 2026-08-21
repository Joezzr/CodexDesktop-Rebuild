function DirSizes($roots, $depth, $minGB) {
  foreach ($r in $roots) {
    if (!(Test-Path $r)) { continue }
    $items = Get-ChildItem -Path $r -Directory -Force -ErrorAction SilentlyContinue
    foreach ($it in $items) {
      $b = (Get-ChildItem -Path $it.FullName -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
      $gb = [math]::Round($b/1GB,1)
      if ($gb -ge $minGB) { Write-Output ("{0,7} GB  {1}" -f $gb, $it.FullName) }
    }
  }
}
Write-Output "== Users\Kal 下 >2GB 目录 =="
DirSizes @("C:\Users\Kal") 1 2
Write-Output ""
Write-Output "== Program Files 下 >2GB 目录 =="
DirSizes @("C:\Program Files", "C:\Program Files (x86)") 1 2
Write-Output ""
Write-Output "== ProgramData 下 >1GB 目录 =="
DirSizes @("C:\ProgramData") 1 1