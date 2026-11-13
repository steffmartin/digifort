# Distribuição do Digifort Monitor para Windows

## Build da versão 1.2.1

Use Windows 11 x64 com o compilador do .NET Framework 4.x e o Inno Setup 7. Na raiz do projeto, execute:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-installer.ps1
```

Use `-IsccPath` se o `ISCC.exe` estiver em um caminho personalizado. O script baixa e confere o SHA-256 do Node.js 24.22.2 x64 oficial. Ele inclui `node.exe`, a licença do runtime, o servidor, `package.json` com a versão instalada, a interface e o WASM versionado. O servidor usa os módulos nativos do Node. O build compila o inicializador gráfico e gera os ícones e as duas imagens do assistente. A arte em `installer/Artwork.cs` também gera `public/favicon.svg`, usado no cabeçalho e na aba da interface; ao atualizar a arte, execute `scripts/build-launcher.ps1` para regenerar os dois formatos.

O instalador é distribuído sem assinatura. Para verificar o download, compare a saída do comando com a linha do instalador no arquivo de checksums:

```powershell
Get-FileHash .\Digifort-Monitor-Setup-1.2.1.exe -Algorithm SHA256
```

## Publicação

Gere o instalador com a árvore do commit da versão na `main`. Use a tag `v1.2.1` e as [notas de versão](NOTAS-DE-VERSAO.md#121). Anexe `dist/Digifort-Monitor-Setup-1.2.1.exe` e `dist/SHA256SUMS.txt` à [release no GitHub](https://github.com/steffmartin/digifort/releases). Confira os nomes dos arquivos e o SHA-256 após a publicação.

## Instalação e execução

O instalador atual exige Windows x64 e aceita Windows 10 a partir da compilação 10240 e Windows 11. O build integrado foi compilado no Windows 11; a instalação e a execução no Windows 10 ainda precisam ser validadas. A disponibilidade e o suporte do navegador variam conforme a versão do sistema.

O instalador roda por usuário em `%LOCALAPPDATA%\Programs\Digifort Monitor` e funciona offline. O instalador e o inicializador procuram Google Chrome, Chromium e Microsoft Edge, nessa ordem, nas pastas padrão, nas entradas App Paths do Windows e no `PATH`. O Edge usa um perfil dedicado separado, com sincronização desativada. A disponibilidade de H.264, AAC e HEVC depende do navegador e, para HEVC, da configuração do sistema.

O atalho inicia o executável gráfico e o Node distribuído no pacote. A janela em modo aplicativo abre quando o Node confirma que está escutando em `127.0.0.1:4177`. Se a porta estiver ocupada, o Digifort exibe um aviso. O inicializador acompanha a janela e usa objetos de trabalho do Windows para encerrar a árvore de processos que iniciou. Ao fechar durante uma gravação, o servidor tenta finalizar os blocos recebidos por completo. Uma gravação sem blocos completos é descartada.

O programa mantém as configurações em `%LOCALAPPDATA%\Digifort Monitor\config`. O perfil dedicado do navegador e a última posição, tamanho e estado de maximização da janela ficam na pasta de dados. O diálogo de configurações do aplicativo permite criar, editar e excluir servidores; quando não há uma configuração utilizável, ele aparece automaticamente. O assistente permite importar um arquivo `.config` existente ou pular a configuração; o preenchimento dos dados é feito no aplicativo.

Para depurar pelo repositório, execute `Iniciar-Digifort.bat --diagnostico`. Os atalhos da instalação abrem sem console. Ao executar o `.bat` diretamente pelo Explorador, o Windows pode exibir brevemente o console que interpreta o arquivo.

## Atualização e desinstalação

Feche o Digifort Monitor e execute o novo instalador para atualizar ou reinstalar. A pasta de dados e os `.config` existentes são preservados. O assistente de configuração inicial reaparece quando a pasta contém apenas o modelo ou está vazia.

Na inicialização, a aplicação consulta a release mais recente. Ao escolher **Instalar**, ela baixa o instalador para uma pasta temporária e verifica seu SHA-256 com o arquivo da release. Em seguida, encerra o aplicativo, executa o instalador sem perguntas e o reabre após a conclusão. Falhas no download ou na verificação mantêm o aplicativo aberto. É possível consultar as notas ou ignorar uma versão; a preferência fica em `update.json` na pasta de configurações.

Na desinstalação, a resposta padrão mantém os `.config`. Se optar por excluí-los, são removidos somente os `.config` dos servidores na pasta de configuração. O modo silencioso exige `/DELETECONFIGS` para essa remoção. Capturas, gravações e o modelo `example.config` são preservados.
