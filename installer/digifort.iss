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
  #define ProductVersion "1.0.0"
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
MinVersion=10.0.22000
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
Source: "{#StageDir}\public\*"; DestDir: "{app}\public"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StageDir}\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StageDir}\example.config"; DestDir: "{#UserDataDir}\config"; Flags: onlyifdoesntexist uninsneveruninstall

[Icons]
Name: "{group}\Digifort Monitor"; Filename: "{app}\DigifortMonitor.exe"
Name: "{group}\Pasta de configurações"; Filename: "{app}\DigifortMonitor.exe"; Parameters: "--config-folder"
Name: "{userdesktop}\Digifort Monitor"; Filename: "{app}\DigifortMonitor.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\DigifortMonitor.exe"; Description: "Abrir o Digifort Monitor"; Flags: nowait postinstall skipifsilent

[Code]
const
  ConfigImport = 0;
  ConfigFill = 1;
  ConfigSkip = 2;
  ReparsePoint = $400;
  InvalidFileAttributes = $FFFFFFFF;
  HexDigits = '0123456789abcdef';

var
  ChoicePage: TInputOptionWizardPage;
  ImportPage: TInputFileWizardPage;
  ServerPage, MediaPage: TInputQueryWizardPage;
  OptionsPage: TWizardPage;
  TimeZoneEdit, CameraNameEdit: TNewEdit;
  BasicAuthCheck: TNewCheckBox;
  MosaicCombo, CameraProfileCombo: TNewComboBox;
  CameraList: TNewListBox;
  CameraNames, CameraProfiles: TStringList;

function GetFileAttributes(FileName: String): Cardinal;
  external 'GetFileAttributesW@kernel32.dll stdcall';
function CreateNewFile(FileName: String; Access, Share: Cardinal; Security: Integer;
  Creation, Flags: Cardinal; Template: Integer): THandle;
  external 'CreateFileW@kernel32.dll stdcall';
function CloseFileHandle(Handle: THandle): Boolean;
  external 'CloseHandle@kernel32.dll stdcall';

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

procedure AddLabel(Page: TWizardPage; Caption: String; X, Y: Integer);
var LabelControl: TNewStaticText;
begin
  LabelControl := TNewStaticText.Create(Page);
  LabelControl.Parent := Page.Surface;
  LabelControl.Caption := Caption;
  LabelControl.Left := ScaleX(X);
  LabelControl.Top := ScaleY(Y);
end;

procedure SetCamera(Index: Integer; Name, Profile: String);
begin
  if Index = CameraNames.Count then
  begin
    CameraNames.Add(Name);
    CameraProfiles.Add(Profile);
    CameraList.Items.Add(Name + ' — ' + Profile);
  end else
  begin
    CameraProfiles[Index] := Profile;
    CameraList.Items[Index] := Name + ' — ' + Profile;
  end;
  CameraList.ItemIndex := Index;
end;

procedure AddCamera(Sender: TObject);
var Name, Profile: String; I: Integer;
begin
  Name := Trim(CameraNameEdit.Text);
  if Name = '' then Exit;
  Profile := CameraProfileCombo.Items[CameraProfileCombo.ItemIndex];
  I := 0;
  while (I < CameraNames.Count) and (CompareStr(CameraNames[I], Name) <> 0) do I := I + 1;
  SetCamera(I, Name, Profile);
  CameraNameEdit.Text := '';
end;

procedure RemoveCamera(Sender: TObject);
var I: Integer;
begin
  I := CameraList.ItemIndex;
  if I < 0 then Exit;
  CameraNames.Delete(I);
  CameraProfiles.Delete(I);
  CameraList.Items.Delete(I);
  if I >= CameraList.Items.Count then I := CameraList.Items.Count - 1;
  CameraList.ItemIndex := I;
end;

procedure InitializeWizard;
var AddButton, RemoveButton: TNewButton; I: Integer; Mosaics: TStringList;
begin
  ChoicePage := CreateInputOptionPage(wpSelectTasks, 'Configuração inicial', 'Como deseja começar?',
    'Você pode configurar um servidor agora ou fazer isso depois da instalação.', True, False);
  ChoicePage.Add('Importar um arquivo .config');
  ChoicePage.Add('Preencher os dados de um servidor');
  ChoicePage.Add('Pular por enquanto');
  ChoicePage.SelectedValueIndex := ConfigSkip;

  ImportPage := CreateInputFilePage(ChoicePage.ID, 'Importar configuração', 'Selecione um arquivo .config',
    'O arquivo será copiado para a pasta de configurações do Digifort Monitor.');
  ImportPage.Add('Arquivo de configuração:', 'Configuração Digifort (*.config)|*.config', '.config');

  ServerPage := CreateInputQueryPage(ImportPage.ID, 'Dados do servidor', 'Conexão e credenciais',
    'Preencha o que souber. Você pode completar o arquivo depois.');
  ServerPage.Add('Nome exibido (name):', False);
  ServerPage.Add('Endereço HTTP ou HTTPS (serverAddress):', False);
  ServerPage.Add('Usuário (username):', False);
  ServerPage.Add('Senha (password):', True);
  ServerPage.Add('User-Agent (userAgent):', False);
  ServerPage.Values[4] := 'custom';

  OptionsPage := CreateCustomPage(ServerPage.ID, 'Preferências do servidor', 'Fuso, autenticação, mosaico e câmeras iniciais');
  AddLabel(OptionsPage, 'Fuso horário IANA (timeZone):', 0, 0);
  TimeZoneEdit := TNewEdit.Create(OptionsPage);
  TimeZoneEdit.Parent := OptionsPage.Surface;
  TimeZoneEdit.Top := ScaleY(16);
  TimeZoneEdit.Width := OptionsPage.SurfaceWidth;
  TimeZoneEdit.Text := 'America/Sao_Paulo';
  BasicAuthCheck := TNewCheckBox.Create(OptionsPage);
  BasicAuthCheck.Parent := OptionsPage.Surface;
  BasicAuthCheck.Top := ScaleY(43);
  BasicAuthCheck.Width := OptionsPage.SurfaceWidth;
  BasicAuthCheck.Caption := 'Usar autenticação tradicional (padrão: por sessão)';
  AddLabel(OptionsPage, 'Mosaico inicial (initialMosaic):', 0, 68);
  MosaicCombo := TNewComboBox.Create(OptionsPage);
  MosaicCombo.Parent := OptionsPage.Surface;
  MosaicCombo.Style := csDropDownList;
  MosaicCombo.Top := ScaleY(84);
  MosaicCombo.Width := OptionsPage.SurfaceWidth;
  Mosaics := TStringList.Create;
  try
    Mosaics.CommaText := 'auto,3x3-six,4x4-eight,4x4-ten,4x4-thirteen-a,4x4-thirteen-b,4x4-center';
    for I := 0 to Mosaics.Count - 1 do MosaicCombo.Items.Add(Mosaics[I]);
  finally
    Mosaics.Free;
  end;
  MosaicCombo.ItemIndex := 0;

  CameraNames := TStringList.Create;
  CameraProfiles := TStringList.Create;
  AddLabel(OptionsPage, 'Nome exato da câmera inicial:', 0, 112);
  AddLabel(OptionsPage, 'Perfil de reprodução:', 240, 112);
  CameraNameEdit := TNewEdit.Create(OptionsPage);
  CameraNameEdit.Parent := OptionsPage.Surface;
  CameraNameEdit.SetBounds(0, ScaleY(128), ScaleX(228), CameraNameEdit.Height);
  CameraProfileCombo := TNewComboBox.Create(OptionsPage);
  CameraProfileCombo.Parent := OptionsPage.Surface;
  CameraProfileCombo.SetBounds(ScaleX(240), ScaleY(128), OptionsPage.SurfaceWidth - ScaleX(240), CameraProfileCombo.Height);
  CameraProfileCombo.Style := csDropDownList;
  CameraProfileCombo.Items.Add('Visualization');
  CameraProfileCombo.Items.Add('Recording');
  CameraProfileCombo.ItemIndex := 0;
  AddButton := TNewButton.Create(OptionsPage);
  AddButton.Parent := OptionsPage.Surface;
  AddButton.SetBounds(OptionsPage.SurfaceWidth - ScaleX(90), ScaleY(159), ScaleX(90), ScaleY(25));
  AddButton.Caption := 'Adicionar';
  AddButton.OnClick := @AddCamera;
  RemoveButton := TNewButton.Create(OptionsPage);
  RemoveButton.Parent := OptionsPage.Surface;
  RemoveButton.SetBounds(OptionsPage.SurfaceWidth - ScaleX(90), ScaleY(191), ScaleX(90), ScaleY(25));
  RemoveButton.Caption := 'Remover';
  RemoveButton.OnClick := @RemoveCamera;
  CameraList := TNewListBox.Create(OptionsPage);
  CameraList.Parent := OptionsPage.Surface;
  CameraList.SetBounds(0, ScaleY(159), OptionsPage.SurfaceWidth - ScaleX(102), OptionsPage.SurfaceHeight - ScaleY(159));

  MediaPage := CreateInputQueryPage(OptionsPage.ID, 'Pastas de mídia', 'Escolha onde salvar capturas e gravações',
    'Use caminhos completos. Capturas e gravações podem usar a pasta padrão.');
  MediaPage.Add('Pasta padrão (mediaFolder):', False);
  MediaPage.Add('Pasta de capturas (screenshotFolder):', False);
  MediaPage.Add('Pasta de gravações (videoFolder):', False);
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
  else if PageID = ImportPage.ID then Result := WizardSilent or HasConfig or (ChoicePage.SelectedValueIndex <> ConfigImport)
  else if (PageID = ServerPage.ID) or (PageID = OptionsPage.ID) or (PageID = MediaPage.ID) then
    Result := WizardSilent or HasConfig or (ChoicePage.SelectedValueIndex <> ConfigFill);
end;

function NextButtonClick(PageID: Integer): Boolean;
begin
  Result := True;
  if PageID = ImportPage.ID then
  begin
    Result := FileExists(ImportPage.Values[0]) and (CompareText(ExtractFileExt(ImportPage.Values[0]), '.config') = 0);
    if not Result then MsgBox('Selecione um arquivo .config existente.', mbError, MB_OK);
  end;
  if PageID = OptionsPage.ID then AddCamera(nil);
end;

function JsonString(Value: String): String;
var I, Code: Integer; Ch: Char;
begin
  Result := '"';
  for I := 1 to Length(Value) do
  begin
    Ch := Value[I];
    if (Ch = '"') or (Ch = '\') then Result := Result + '\' + Ch
    else if Ord(Ch) < 32 then
    begin
      Code := Ord(Ch);
      Result := Result + '\u00' + HexDigits[(Code div 16) + 1] + HexDigits[(Code mod 16) + 1];
    end
    else Result := Result + Ch;
  end;
  Result := Result + '"';
end;

procedure AddStringField(Lines: TStrings; Key, Value: String);
begin
  if Value <> '' then Lines.Add('  ' + JsonString(Key) + ': ' + JsonString(Value) + ',');
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

function SaveConfig(Importing: Boolean): Boolean;
var Id, Source, Destination, Cameras, Auth: String; I, Suffix: Integer; Handle: THandle; Lines: TStringList;
begin
  Result := False;
  Source := ImportPage.Values[0];
  if Importing then Id := MakeId(ChangeFileExt(ExtractFileName(Source), ''))
  else Id := MakeId(ServerPage.Values[0]);
  Destination := ConfigDir + '\' + Id + '.config';
  Suffix := 2;
  while FileExists(Destination) or DirExists(Destination) do
  begin
    Destination := ConfigDir + '\' + Id + '-' + IntToStr(Suffix) + '.config';
    Suffix := Suffix + 1;
  end;
  if Importing then
  begin
    Result := CopyFile(Source, Destination, True);
    Exit;
  end;

  Lines := TStringList.Create;
  try
    Lines.Add('{');
    AddStringField(Lines, 'name', Trim(ServerPage.Values[0]));
    AddStringField(Lines, 'serverAddress', Trim(ServerPage.Values[1]));
    AddStringField(Lines, 'username', Trim(ServerPage.Values[2]));
    AddStringField(Lines, 'password', ServerPage.Values[3]);
    AddStringField(Lines, 'userAgent', Trim(ServerPage.Values[4]));
    AddStringField(Lines, 'timeZone', Trim(TimeZoneEdit.Text));
    if BasicAuthCheck.Checked then Auth := 'true' else Auth := 'false';
    Lines.Add('  "useBasicAuth": ' + Auth + ',');
    AddStringField(Lines, 'initialMosaic', MosaicCombo.Items[MosaicCombo.ItemIndex]);
    AddStringField(Lines, 'mediaFolder', Trim(MediaPage.Values[0]));
    AddStringField(Lines, 'screenshotFolder', Trim(MediaPage.Values[1]));
    AddStringField(Lines, 'videoFolder', Trim(MediaPage.Values[2]));
    Cameras := '';
    for I := 0 to CameraNames.Count - 1 do
    begin
      if I > 0 then Cameras := Cameras + ', ';
      Cameras := Cameras + JsonString(CameraNames[I]) + ': ' + JsonString(CameraProfiles[I]);
    end;
    Lines.Add('  "initialCameras": {' + Cameras + '}');
    Lines.Add('}');

    // Reserve the final name without truncating an existing configuration.
    Handle := CreateNewFile(Destination, $40000000, 0, 0, 1, $80, 0);
    if Handle = THandle(-1) then Exit;
    CloseFileHandle(Handle);
    Result := SaveStringToFile(Destination, UTF8Encode(Lines.Text), False);
    if not Result then DeleteFile(Destination);
  finally
    Lines.Free;
  end;
end;

procedure CurStepChanged(Step: TSetupStep);
begin
  if (Step = ssPostInstall) and not WizardSilent and (ChoicePage.SelectedValueIndex <> ConfigSkip) then
    if not SaveConfig(ChoicePage.SelectedValueIndex = ConfigImport) then
      MsgBox('Não foi possível salvar a configuração. Você pode salvar o arquivo manualmente em:' + #13#10 + ConfigDir, mbError, MB_OK);
end;

procedure DeinitializeSetup;
begin
  CameraProfiles.Free;
  CameraNames.Free;
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
