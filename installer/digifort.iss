#ifndef StageDir
  #define StageDir "..\build\installer\stage"
#endif
#ifndef OutputPath
  #define OutputPath "..\dist"
#endif
#ifndef ProductId
  #define ProductId "{{C6F49C1D-EE72-4D14-B0DC-37DAB32F5878}"
#endif
#ifndef UserDataDir
  #define UserDataDir "{localappdata}\Digifort Monitor"
#endif
#ifndef ProductName
  #define ProductName "Digifort Monitor"
#endif
#ifndef ProductVersion
  #define ProductVersion "1.2.1"
#endif

[Setup]
AppId={#ProductId}
AppName={#ProductName}
AppVersion={#ProductVersion}
DefaultDirName={localappdata}\Programs\{#ProductName}
DefaultGroupName={#ProductName}
DisableWelcomePage=no
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64os
ArchitecturesInstallIn64BitMode=x64os
MinVersion=10.0.10240
OutputDir={#OutputPath}
OutputBaseFilename=Digifort-Monitor-Setup-{#ProductVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern dynamic
SetupIconFile={#StageDir}\camera.ico
WizardImageFile={#StageDir}\wizard.bmp
WizardImageFileDynamicDark={#StageDir}\wizard.bmp
WizardSmallImageFile={#StageDir}\wizard-small.bmp
WizardSmallImageFileDynamicDark={#StageDir}\wizard-small.bmp
UninstallDisplayIcon={app}\DigifortMonitor.exe
AppMutex=Local\DigifortMonitor.Launcher
CloseApplications=no

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na área de trabalho"; Flags: unchecked

[Dirs]
Name: "{#UserDataDir}\config"; Flags: uninsneveruninstall

[Files]
Source: "{#StageDir}\DigifortMonitor.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageDir}\DigifortMonitor.exe"; DestName: "BrowserCheck.exe"; Flags: dontcopy
Source: "{#StageDir}\server.mjs"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageDir}\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageDir}\public\*"; DestDir: "{app}\public"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StageDir}\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StageDir}\example.config"; DestDir: "{#UserDataDir}\config"; Flags: onlyifdoesntexist uninsneveruninstall

[Icons]
Name: "{group}\Digifort Monitor"; Filename: "{app}\DigifortMonitor.exe"
Name: "{userdesktop}\Digifort Monitor"; Filename: "{app}\DigifortMonitor.exe"; Tasks: desktopicon

[InstallDelete]
Type: files; Name: "{group}\Pasta de configurações.lnk"

[Run]
Filename: "{app}\DigifortMonitor.exe"; Description: "Abrir o Digifort Monitor"; Flags: nowait postinstall skipifsilent

[Code]
const
  ConfigImport = 0;
  ConfigSkip = 1;
  ReparsePoint = $400;
  InvalidFileAttributes = $FFFFFFFF;

var
  ChoicePage: TInputOptionWizardPage;
  ImportPage: TInputFileWizardPage;

function GetFileAttributes(FileName: String): Cardinal;
  external 'GetFileAttributesW@kernel32.dll stdcall';

function ConfigDir: String;
begin
  Result := ExpandConstant('{#UserDataDir}\config');
end;

function InitializeSetup: Boolean;
var ProbeExit: Integer;
begin
  ExtractTemporaryFile('BrowserCheck.exe');
  Result := Exec(ExpandConstant('{tmp}\BrowserCheck.exe'), '--check-browser', '', SW_HIDE, ewWaitUntilTerminated, ProbeExit) and (ProbeExit = 0);
  if not Result then
    SuppressibleMsgBox('O Digifort Monitor precisa do Google Chrome, do Microsoft Edge ou de um Chromium compatível. Instale um deles e execute este instalador novamente.', mbCriticalError, MB_OK, IDOK);
end;

procedure InitializeWizard;
begin
  ChoicePage := CreateInputOptionPage(wpSelectTasks, 'Configuração inicial', 'Como deseja começar?',
    'Você pode configurar um servidor agora ou fazer isso depois da instalação.', True, False);
  ChoicePage.Add('Importar um arquivo .config');
  ChoicePage.Add('Pular por enquanto');
  ChoicePage.SelectedValueIndex := ConfigSkip;

  ImportPage := CreateInputFilePage(ChoicePage.ID, 'Importar configuração', 'Selecione um arquivo .config',
    'O arquivo será copiado para a pasta de configurações do Digifort Monitor.');
  ImportPage.Add('Arquivo de configuração:', 'Configuração Digifort (*.config)|*.config', '.config');

end;

function HasConfig: Boolean;
var Entry: TFindRec;
begin
  Result := False;
  if FindFirst(ConfigDir + '\*.config', Entry) then
  try
    repeat
      if ((Entry.Attributes and FILE_ATTRIBUTE_DIRECTORY) = 0) and (CompareText(Entry.Name, 'example.config') <> 0) then
      begin
        Result := True;
        Exit;
      end;
    until not FindNext(Entry);
  finally
    FindClose(Entry);
  end;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if PageID = ChoicePage.ID then Result := WizardSilent or HasConfig
  else if PageID = ImportPage.ID then Result := WizardSilent or HasConfig or (ChoicePage.SelectedValueIndex <> ConfigImport);
end;

function NextButtonClick(PageID: Integer): Boolean;
begin
  Result := True;
  if PageID = ImportPage.ID then
  begin
    Result := FileExists(ImportPage.Values[0]) and (CompareText(ExtractFileExt(ImportPage.Values[0]), '.config') = 0);
    if not Result then MsgBox('Selecione um arquivo .config existente.', mbError, MB_OK);
  end;
end;

function MakeId(Value: String): String;
var I: Integer; Ch: Char; Prefix: String;
begin
  Result := '';
  Value := Lowercase(Trim(Value));
  for I := 1 to Length(Value) do
  begin
    Ch := Value[I];
    if ((Ch >= 'a') and (Ch <= 'z')) or ((Ch >= '0') and (Ch <= '9')) or (Ch = '_') or (Ch = '.') then
      Result := Result + Ch
    else if (Length(Result) > 0) and (Result[Length(Result)] <> '-') then Result := Result + '-';
    if Length(Result) >= 100 then Break;
  end;
  while (Length(Result) > 0) and ((Result[1] = '.') or (Result[1] = '-')) do Delete(Result, 1, 1);
  while (Length(Result) > 0) and ((Result[Length(Result)] = '.') or (Result[Length(Result)] = '-')) do Delete(Result, Length(Result), 1);
  if Result = '' then Result := 'servidor';
  I := Pos('.', Result);
  if I > 0 then Prefix := Copy(Result, 1, I - 1) else Prefix := Result;
  if (Result = 'example') or (Prefix = 'con') or (Prefix = 'prn') or (Prefix = 'aux') or (Prefix = 'nul') or
     ((Length(Prefix) = 4) and ((Copy(Prefix, 1, 3) = 'com') or (Copy(Prefix, 1, 3) = 'lpt')) and
      (Prefix[4] >= '0') and (Prefix[4] <= '9')) then Result := 'servidor-' + Result;
end;

function SaveConfig: Boolean;
var Id, Source, Destination: String; Suffix: Integer;
begin
  Source := ImportPage.Values[0];
  Id := MakeId(ChangeFileExt(ExtractFileName(Source), ''));
  Destination := ConfigDir + '\' + Id + '.config';
  Suffix := 2;
  while FileExists(Destination) or DirExists(Destination) do
  begin
    Destination := ConfigDir + '\' + Id + '-' + IntToStr(Suffix) + '.config';
    Suffix := Suffix + 1;
  end;
  Result := CopyFile(Source, Destination, True);
end;

procedure CurStepChanged(Step: TSetupStep);
begin
  if (Step = ssPostInstall) and not WizardSilent and (ChoicePage.SelectedValueIndex = ConfigImport) then
    if not SaveConfig then
      MsgBox('Não foi possível salvar a configuração. Você pode salvar o arquivo manualmente em:' + #13#10 + ConfigDir, mbError, MB_OK);
end;

procedure CurUninstallStepChanged(Step: TUninstallStep);
var I: Integer; DeleteConfigs: Boolean; Entry: TFindRec; Attributes: Cardinal;
begin
  if (Step <> usPostUninstall) or not HasConfig then Exit;
  DeleteConfigs := False;
  if UninstallSilent then
  begin
    for I := 1 to ParamCount do
      if CompareText(ParamStr(I), '/DELETECONFIGS') = 0 then DeleteConfigs := True;
  end else
    DeleteConfigs := MsgBox('Deseja excluir os arquivos de configuração dos servidores? Se escolher Não, eles estarão disponíveis ao reinstalar.',
      mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;
  if not DeleteConfigs then Exit;
  Attributes := GetFileAttributes(ExpandConstant('{#UserDataDir}'));
  if (Attributes = InvalidFileAttributes) or ((Attributes and ReparsePoint) <> 0) then Exit;
  Attributes := GetFileAttributes(ConfigDir);
  if (Attributes = InvalidFileAttributes) or ((Attributes and ReparsePoint) <> 0) then Exit;
  if FindFirst(ConfigDir + '\*.config', Entry) then
  try
    repeat
      if ((Entry.Attributes and (FILE_ATTRIBUTE_DIRECTORY or ReparsePoint)) = 0) and (CompareText(Entry.Name, 'example.config') <> 0) then
        DeleteFile(ConfigDir + '\' + Entry.Name);
    until not FindNext(Entry);
  finally
    FindClose(Entry);
  end;
end;
