$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'helper.cs')))
[FdHelper]::Run([Action[string]] {
  param([string]$line)
  $id = 0
  try {
    $r = ConvertFrom-Json $line
    $id = $r.id
    if ($r.op -eq 'clipSet') {
      if (@($r.paths).Count -eq 0) { [Windows.Forms.Clipboard]::Clear() }
      else {
        $files = New-Object System.Collections.Specialized.StringCollection
        foreach ($p in @($r.paths)) { [void]$files.Add([string]$p) }
        $data = New-Object Windows.Forms.DataObject
        $data.SetFileDropList($files)
        $effect = if ($r.cut) { 2 } else { 5 }
        $data.SetData('Preferred DropEffect', (New-Object IO.MemoryStream (,[byte[]]@($effect, 0, 0, 0))))
        [Windows.Forms.Clipboard]::SetDataObject($data, $true)
      }
      $result = 'ok'
    } elseif ($r.op -eq 'clipGet') {
      $list = @()
      if ([Windows.Forms.Clipboard]::ContainsFileDropList()) { $list = @([Windows.Forms.Clipboard]::GetFileDropList()) }
      $cut = $false
      $effect = [Windows.Forms.Clipboard]::GetData('Preferred DropEffect')
      if ($effect -is [IO.MemoryStream]) { $b = $effect.ToArray(); $cut = $b.Length -gt 0 -and ($b[0] -band 2) -ne 0 }
      $result = ConvertTo-Json -Compress @{ paths = [string[]]$list; cut = $cut }
    } else {
      $result = [FdHelper]::Show([string[]]@($r.paths), [string]$r.folder, [string[]]@($r.ids), [string[]]@($r.labels), [bool]$r.extended, [long]$r.owner)
    }
    [FdHelper]::Write((ConvertTo-Json -Compress @{ id = $id; result = $result }))
  } catch {
    [FdHelper]::Write((ConvertTo-Json -Compress @{ id = $id; error = $_.Exception.Message }))
  }
})
