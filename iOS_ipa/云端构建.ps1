$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'prepared-source.json'))) {
    throw '请先解压 Mineradio-iOS-0.1.0-cloud-source.zip，再运行其中的脚本。'
}
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host '请安装 GitHub CLI：https://cli.github.com/ ，安装后重新打开本脚本。'
    Read-Host '按回车结束'
    exit 1
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw '请先安装 Git for Windows：https://git-scm.com/download/win'
}
gh auth status
if ($LASTEXITCODE -ne 0) {
    gh auth login --web --git-protocol https
    if ($LASTEXITCODE -ne 0) { throw 'GitHub 登录尚未完成。' }
}
$repoName = Read-Host '输入新建的私有仓库名（回车使用 mineradio-ios-private）'
if ([string]::IsNullOrWhiteSpace($repoName)) { $repoName = 'mineradio-ios-private' }
if ($repoName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$') { throw '仓库名只能包含英文字母、数字、点、横线或下划线。' }
if (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.git')) {
    throw '该目录已经运行过上传。请在 GitHub Actions 页面重新运行构建，或重新解压到一个空文件夹。'
}
Write-Host '即将把此文件夹的已准备源码上传到你的新私有仓库，然后运行 macOS 云构建。'
Write-Host '不上传 Apple 账号、音乐平台 Cookie 或当前电脑配置。首次使用请确认 GitHub 账号允许 Actions。'
$confirm = Read-Host '输入 BUILD 开始'
if ($confirm -cne 'BUILD') { exit 0 }
git init -b main
if ($LASTEXITCODE -ne 0) { throw '创建独立 Git 仓库失败。' }
git add --all
if ($LASTEXITCODE -ne 0) { throw '暂存源码失败。' }
git -c user.name=Mineradio -c user.email=local@mineradio.invalid commit -m 'Build prepared Mineradio iOS app'
if ($LASTEXITCODE -ne 0) { throw '保存源码快照失败。' }
gh repo create $repoName --private --source . --remote origin --push
if ($LASTEXITCODE -ne 0) { throw '创建或上传私有仓库失败。请查看上方 GitHub 返回的信息。' }
$repoFullName = (gh repo view --json nameWithOwner --jq '.nameWithOwner').Trim()
if ($LASTEXITCODE -ne 0) { throw '读取仓库地址失败。' }
gh workflow run ios-build.yml --repo $repoFullName --ref main
if ($LASTEXITCODE -ne 0) { throw '触发云构建失败。请在仓库 Actions 页面手动运行工作流。' }
Write-Host "构建已提交：https://github.com/$repoFullName/actions"
Write-Host '构建成功后，下载 Mineradio-iOS-unsigned 附件，解压得到 IPA，再通过 Windows 签名侧载。'
Write-Host '如果失败，请保留 Actions 日志；不能将源码 ZIP 改名当作 IPA 安装。'
Read-Host '按回车结束'
