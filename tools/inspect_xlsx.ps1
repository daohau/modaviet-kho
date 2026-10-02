param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$OutputPath,
    [Parameter(Mandatory=$true)][string]$SummaryPath
)

Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Xml.Linq

$nsMain = [System.Xml.Linq.XNamespace]::Get('http://schemas.openxmlformats.org/spreadsheetml/2006/main')
$nsRel = [System.Xml.Linq.XNamespace]::Get('http://schemas.openxmlformats.org/officeDocument/2006/relationships')
$nsPkgRel = [System.Xml.Linq.XNamespace]::Get('http://schemas.openxmlformats.org/package/2006/relationships')

function Read-ZipXml([System.IO.Compression.ZipArchive]$Zip, [string]$Name) {
    $entry = $Zip.GetEntry($Name)
    if ($null -eq $entry) { return $null }
    $stream = $entry.Open()
    try {
        $reader = New-Object System.IO.StreamReader($stream)
        try { return [System.Xml.Linq.XDocument]::Parse($reader.ReadToEnd()) }
        finally { $reader.Dispose() }
    } finally { $stream.Dispose() }
}

function Get-CellText($Cell, [hashtable]$SharedStrings) {
    $type = if ($null -ne $Cell.Attribute('t')) { [string]$Cell.Attribute('t').Value } else { '' }
    if ($type -eq 'inlineStr') {
        return (($Cell.Descendants($nsMain + 't') | ForEach-Object { [string]$_.Value }) -join '')
    }
    $v = $Cell.Element($nsMain + 'v')
    if ($null -eq $v) { return '' }
    $raw = [string]$v.Value
    if ($type -eq 's' -and $raw -match '^\d+$' -and $SharedStrings.ContainsKey([int]$raw)) {
        return [string]$SharedStrings[[int]$raw]
    }
    if ($type -eq 'b') {
        if ($raw -eq '1') { return 'TRUE' }
        if ($raw -eq '0') { return 'FALSE' }
    }
    return $raw
}

function Get-CellObject($Cell, [hashtable]$SharedStrings) {
    $obj = [ordered]@{
        address = [string]$Cell.Attribute('r').Value
        value = Get-CellText $Cell $SharedStrings
    }
    $formula = $Cell.Element($nsMain + 'f')
    if ($null -ne $formula) { $obj.formula = [string]$formula.Value }
    $type = $Cell.Attribute('t')
    if ($null -ne $type) { $obj.type = [string]$type.Value }
    return $obj
}

$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $Path))
try {
    $shared = @{}
    $sharedDoc = Read-ZipXml $zip 'xl/sharedStrings.xml'
    if ($null -ne $sharedDoc) {
        $i = 0
        foreach ($si in $sharedDoc.Root.Elements($nsMain + 'si')) {
            $shared[$i] = (($si.Descendants($nsMain + 't') | ForEach-Object { [string]$_.Value }) -join '')
            $i++
        }
    }

    $relsDoc = Read-ZipXml $zip 'xl/_rels/workbook.xml.rels'
    $rels = @{}
    foreach ($rel in $relsDoc.Root.Elements($nsPkgRel + 'Relationship')) {
        $target = [string]$rel.Attribute('Target').Value
        if ($target.StartsWith('/')) { $target = $target.TrimStart('/') }
        elseif (-not $target.StartsWith('xl/')) { $target = 'xl/' + $target }
        $rels[[string]$rel.Attribute('Id').Value] = $target
    }

    $workbookDoc = Read-ZipXml $zip 'xl/workbook.xml'
    $sheetResults = New-Object System.Collections.Generic.List[object]
    $summaryResults = New-Object System.Collections.Generic.List[object]
    foreach ($sheet in $workbookDoc.Root.Element($nsMain + 'sheets').Elements($nsMain + 'sheet')) {
        $title = [string]$sheet.Attribute('name').Value
        $state = if ($null -ne $sheet.Attribute('state')) { [string]$sheet.Attribute('state').Value } else { '' }
        $rid = [string]$sheet.Attribute($nsRel + 'id').Value
        $sheetPath = $rels[$rid]
        $doc = Read-ZipXml $zip $sheetPath
        $rows = New-Object System.Collections.Generic.List[object]
        $allCells = New-Object System.Collections.Generic.List[object]
        $formulaCount = 0
        $nonEmptyRows = 0
        $minRow = $null; $maxRow = 0; $minCol = $null; $maxCol = 0
        $dimensionRef = ''
        if ($null -ne $doc) {
            $dimension = $doc.Root.Element($nsMain + 'dimension')
            $dimensionRef = if ($null -ne $dimension) { [string]$dimension.Attribute('ref').Value } else { '' }
            $sheetData = $doc.Root.Element($nsMain + 'sheetData')
            if ($null -ne $sheetData) {
                foreach ($row in $sheetData.Elements($nsMain + 'row')) {
                    $rowCells = New-Object System.Collections.Generic.List[object]
                    foreach ($cell in $row.Elements($nsMain + 'c')) {
                        $co = Get-CellObject $cell $shared
                        $rowCells.Add($co)
                        if ($co.value -ne '' -or $co.Contains('formula')) {
                            $allCells.Add($co)
                            $formulaCount += if ($co.Contains('formula')) { 1 } else { 0 }
                        }
                        $address = $co.address
                        if ($address -match '^([A-Z]+)(\d+)$') {
                            $colLetters = $Matches[1]
                            $rowNum = [int]$Matches[2]
                            $colNum = 0
                            foreach ($ch in $colLetters.ToCharArray()) { $colNum = ($colNum * 26) + ([int][char]$ch - [int][char]'A' + 1) }
                            if ($null -eq $minRow -or $rowNum -lt $minRow) { $minRow = $rowNum }
                            if ($rowNum -gt $maxRow) { $maxRow = $rowNum }
                            if ($null -eq $minCol -or $colNum -lt $minCol) { $minCol = $colNum }
                            if ($colNum -gt $maxCol) { $maxCol = $colNum }
                        }
                    }
                    if ($rowCells.Count -gt 0) {
                        $rows.Add([ordered]@{ row = [int]$row.Attribute('r').Value; cells = $rowCells })
                        if ($rowCells | Where-Object { $_.value -ne '' -or $_.Contains('formula') }) { $nonEmptyRows++ }
                    }
                }
            }
        }
        $result = [ordered]@{
            title = $title
            state = if ($state) { $state } else { 'visible' }
            worksheet = $sheetPath
            dimension = $dimensionRef
            bounds = [ordered]@{ minRow=$minRow; maxRow=$maxRow; minCol=$minCol; maxCol=$maxCol }
            nonEmptyCells = $allCells.Count
            formulaCount = $formulaCount
            rows = $rows
        }
        $sheetResults.Add($result)
        $previewRows = @($rows | Select-Object -First 8)
        $summaryResults.Add([ordered]@{
            title=$title; state=($result.state); dimension=$dimensionRef; nonEmptyCells=$allCells.Count; formulaCount=$formulaCount; nonEmptyRows=$nonEmptyRows; bounds=$result.bounds; previewRows=$previewRows
        })
    }

    $inventory = [ordered]@{
        source = (Resolve-Path $Path).Path
        extractedAt = (Get-Date).ToString('o')
        sharedStringCount = $shared.Count
        sheetCount = $sheetResults.Count
        sheets = $sheetResults
    }
    $summary = [ordered]@{
        source = (Resolve-Path $Path).Path
        extractedAt = $inventory.extractedAt
        sharedStringCount = $shared.Count
        sheetCount = $summaryResults.Count
        sheets = $summaryResults
    }
    $inventory | ConvertTo-Json -Depth 20 -Compress | Set-Content -LiteralPath $OutputPath -Encoding UTF8
    $summary | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $SummaryPath -Encoding UTF8
    Write-Output ($summary | ConvertTo-Json -Depth 10)
}
finally { $zip.Dispose() }
