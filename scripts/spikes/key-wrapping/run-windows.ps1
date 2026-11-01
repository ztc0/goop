# T11 Windows run in the throwaway VM: item u setup, then the report.
$ErrorActionPreference = 'Continue'
$exe = 'C:\goop\goop-key-check.exe'
$d = 'C:\goop\u'
$log = 'C:\goop\steps.txt'
function Step($text) { $text | Tee-Object -FilePath $log -Append }
New-Item -ItemType Directory -Force -Path $d | Out-Null

Step "== whoami: $(whoami)"
Step "== logon groups: $((whoami /groups | Select-String 'NT AUTHORITY\\(NETWORK|INTERACTIVE|BATCH|SERVICE|LOCAL)' | ForEach-Object { ($_ -split '\s{2,}')[0] }) -join ', ')"
Step "== Protect folder before: $((Get-ChildItem -Force "$env:APPDATA\Microsoft\Protect" -Recurse -ErrorAction SilentlyContinue | Measure-Object).Count) entries"

Step "== baseline report, before anything else"
& $exe 2>&1 | Tee-Object -FilePath $log -Append
Step "exit $LASTEXITCODE"
Step "== baseline report again (second process)"
& $exe 2>&1 | Tee-Object -FilePath $log -Append
Step "exit $LASTEXITCODE"

Step "== wrap as owner"
$out = & $exe --wrap $d 2>&1 | Out-String
Step "exit $LASTEXITCODE; blob exists: $(Test-Path "$d\blob.bin"); $($out.Trim())"
$out = & $exe --unwrap $d 2>&1 | Out-String
Step "owner unwrap: $((Get-Content "$d\other.txt" -ErrorAction SilentlyContinue) -join ' ') $($out.Trim())"
Remove-Item "$d\other.txt" -ErrorAction SilentlyContinue
Step "== Protect folder after: $((Get-ChildItem -Force "$env:APPDATA\Microsoft\Protect" -Recurse -ErrorAction SilentlyContinue | ForEach-Object Name) -join ', ')"

Step "== create second user goopother"
$chars = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
$pw = (-join (1..24 | ForEach-Object { $chars | Get-Random })) + 'a7#'
$secure = ConvertTo-SecureString $pw -AsPlainText -Force
try { New-LocalUser -Name goopother -Password $secure -AccountNeverExpires -PasswordNeverExpires -ErrorAction Stop | Out-Null; Step 'user created' } catch { Step "New-LocalUser: $_" }
icacls $d /grant 'goopother:(OI)(CI)M' | Out-Null
icacls 'C:\goop' /grant 'goopother:(OI)(CI)RX' | Out-Null

Step "== grant goopother the batch logon right (secedit)"
$sid = (Get-LocalUser goopother).SID.Value
secedit /export /cfg C:\goop\sec.inf /areas USER_RIGHTS | Out-Null
$inf = Get-Content C:\goop\sec.inf
$inf = $inf | ForEach-Object { if ($_ -match '^SeBatchLogonRight') { "$_,*$sid" } else { $_ } }
if (-not ($inf -match '^SeBatchLogonRight')) { $inf = $inf -replace '^\[Privilege Rights\]$', "[Privilege Rights]`r`nSeBatchLogonRight = *$sid" }
$inf | Set-Content C:\goop\sec2.inf -Encoding Unicode
secedit /configure /db C:\goop\sec.sdb /cfg C:\goop\sec2.inf /areas USER_RIGHTS | Out-Null
Step "secedit exit $LASTEXITCODE; $((Get-Content C:\goop\sec2.inf | Select-String SeBatchLogonRight) -join ' ')"
wevtutil sl Microsoft-Windows-TaskScheduler/Operational /e:true

Step "== attempt 1: scheduled task as goopother (password logon)"
try {
  $action = New-ScheduledTaskAction -Execute $exe -Argument "--unwrap $d"
  Register-ScheduledTask -TaskName goop-u -Action $action -User goopother -Password $pw -RunLevel Limited -ErrorAction Stop | Out-Null
  Start-ScheduledTask -TaskName goop-u -ErrorAction Stop
  $deadline = (Get-Date).AddSeconds(120)
  do { Start-Sleep -Seconds 3; $task = Get-ScheduledTask -TaskName goop-u } while (-not (Test-Path "$d\other.txt") -and (Get-Date) -lt $deadline)
  $info = Get-ScheduledTaskInfo -TaskName goop-u
  Step "task state $($task.State); LastRunTime $($info.LastRunTime); LastTaskResult $($info.LastTaskResult)"
  Get-WinEvent -LogName Microsoft-Windows-TaskScheduler/Operational -MaxEvents 15 -ErrorAction SilentlyContinue | Sort-Object TimeCreated | ForEach-Object { Step "  event $($_.Id): $($_.Message -replace '\s+', ' ')" }
} catch { Step "scheduled task: $_" }

if (-not (Test-Path "$d\other.txt")) {
  Step "== attempt 2: Start-Process -Credential"
  try {
    $cred = New-Object System.Management.Automation.PSCredential('goopother', $secure)
    $p = Start-Process -FilePath $exe -ArgumentList '--unwrap', $d -Credential $cred -LoadUserProfile -Wait -PassThru -ErrorAction Stop
    Step "Start-Process exit $($p.ExitCode)"
  } catch { Step "Start-Process: $_" }
}
Step "== other.txt: $(if (Test-Path "$d\other.txt") { (Get-Content "$d\other.txt") -join ' ' } else { 'missing' })"

Step "== owner wrap after the other user ran: retry every 5 s, up to 180 s"
$deadline = (Get-Date).AddSeconds(180)
$t1 = Get-Date
do {
  $out = & $exe --wrap C:\goop 2>&1 | Out-String
  $code = $LASTEXITCODE
  Step ("  +{0:N0}s exit $code $(([regex]::Match($out, 'error: (.*)')).Groups[1].Value)" -f ((Get-Date) - $t1).TotalSeconds)
  if ($code -ne 0) { Start-Sleep -Seconds 5 }
} while ($code -ne 0 -and (Get-Date) -lt $deadline)
Step "== report"
& $exe --other $d 2>&1 | Tee-Object -FilePath 'C:\goop\result.txt'
exit $LASTEXITCODE
