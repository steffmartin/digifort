# Guia de uso do Digifort Monitor

## Instalar e abrir

No Windows 11 x64, execute o instalador com Google Chrome, Chromium compatível ou Microsoft Edge já instalado. Consulte as notas da release para confirmar os navegadores aceitos pelo pacote baixado. No assistente, importe um `.config`, preencha os dados do primeiro servidor ou escolha **Pular por enquanto**. O preenchimento parcial pode ser salvo para completar depois. Na página **Preferências do servidor**, configure o mosaico inicial e as câmeras que devem abrir ao conectar.

Abra **Digifort Monitor** no menu Iniciar ou pelo atalho na área de trabalho, se selecionado na instalação. Fechar a janela encerra o servidor local. Na próxima abertura, o aplicativo restaura a posição, o tamanho e o estado de maximização da janela. Consulte [Distribuição](DISTRIBUICAO.md) para verificar o pacote, atualizar ou desinstalar.

## Configurar um servidor

Use o botão de configurações ao lado do estado de conexão para criar, editar ou excluir servidores. Os arquivos ficam em `%LOCALAPPDATA%\Digifort Monitor\config` na versão instalada e em `config/` na versão executada a partir do código-fonte. O aplicativo exclui [example.config](../config/example.config) da lista de servidores.

| Campo | Preenchimento |
| --- | --- |
| `name` | Rótulo no seletor. Se estiver vazio, o aplicativo usa o nome do arquivo. |
| `serverAddress` | Endereço HTTP ou HTTPS, com porta quando necessária. Informe usuário e senha nos campos próprios. |
| `userAgent` | User-Agent esperado pelo servidor Digifort. |
| `username` e `password` | Dados da conta usada para acessar o Digifort. |
| `useBasicAuth` | `false` usa autenticação por sessão e é o padrão. `true` envia `AuthUser` e `AuthPass` na URL, que pode ser registrada pelo Digifort, proxy ou infraestrutura de rede. |
| `timeZone` | Fuso IANA do servidor, por exemplo `America/Sao_Paulo`. |
| `initialCameras` | Mapa de nomes exatos de câmera para `Visualization` ou `Recording`. Use `{}` para iniciar com a grade vazia. |
| `initialMosaic` | ID opcional do [mosaico inicial](#mosaico-inicial). |
| `mediaFolder`, `screenshotFolder` e `videoFolder` | Caminhos completos para pastas graváveis. Cada destino específico vazio ou omitido usa `mediaFolder`. |

O aplicativo seleciona automaticamente uma configuração válida quando ela é a única utilizável. Quando houver mais de uma, escolha o **Servidor** na barra superior. Sem configuração válida, o diálogo abre automaticamente para criar ou corrigir uma configuração.

Mantenha os arquivos reais na pasta local de configurações e use somente dados fictícios em exemplos compartilhados. Usuário, senha e dados de autenticação são tratados no servidor local.

## Monitorar ao vivo

Selecione **Ao vivo**, busque uma câmera na lateral e clique nela para abrir o vídeo na grade. Câmeras adicionadas manualmente começam com o perfil `Visualization`. Use os controles do quadro para trocar o perfil e o menu de contexto para iniciar uma captura. Abra uma câmera em tela cheia com duplo clique ou `F`. Use `Esc` para voltar à grade ou sair do modo vigilância.

Para ouvir áudio, escolha uma câmera aberta em **Áudio de** e ative **Áudio**. A interface solicita áudio para a fonte selecionada após essa interação. O player aceita AAC, G.711 e G.726 conforme o fluxo recebido. H.264 e H.265/HEVC são decodificados com WebCodecs e dependem do perfil aceito pelo navegador.

### Mosaico inicial

Use um dos valores abaixo em `initialMosaic`. Se estiver ausente ou for desconhecido, inclusive para grades removidas, o aplicativo usa a grade automática silenciosamente. A alteração pelo seletor vale para a sessão atual.

| ID | Grade |
| --- | --- |
| `auto` | Grade automática |
| `3x3-six` | 3 × 3 · 6 câmeras |
| `4x4-eight` | 4 × 4 · 8 câmeras |
| `4x4-ten` | 4 × 4 · 10 câmeras |
| `4x4-thirteen-a` | 4 × 4 · 13 câmeras A |
| `4x4-thirteen-b` | 4 × 4 · 13 câmeras B |
| `4x4-center` | 4 × 4 · 13 câmeras C |

## Revisar gravações

Abra **Revisão**, informe o início e, se desejar, o fim no fuso do servidor. Clique em **Reproduzir**. A timeline mostra intervalos disponíveis de vídeo e áudio. Clique nela ou em uma miniatura para navegar na gravação. As miniaturas seguem a câmera em foco e podem ter tamanho e intervalo próprios. Use **Opções de exibição** para controlar dados sobrepostos, timeline e miniaturas.

## Salvar capturas e gravações

Use o menu de contexto de um quadro para capturar um PNG sem sobreposições ou iniciar, pausar, retomar e finalizar uma gravação local. O vídeo registra os quadros reproduzidos e pode incluir o áudio decodificado quando estiver ativo. O seletor oferece MP4 ou MPG/MPEG conforme o suporte de `MediaRecorder`. O Digifort Monitor salva os arquivos na pasta de mídia configurada. Os nomes usam o fuso do servidor, a hora atual no modo ao vivo ou a posição da reprodução na revisão.

Finalize a gravação para salvar o arquivo completo. Se fechar o aplicativo durante uma gravação, o servidor tenta recuperar os blocos recebidos por inteiro. A desinstalação preserva as capturas e gravações.

## Atalhos de teclado

Abra **Atalhos de teclado** no rodapé da lista de câmeras para consultar os comandos. Os atalhos ficam suspensos durante a edição de campos e enquanto um diálogo está aberto. Espaço controla todas as câmeras quando o foco está na lista lateral; em outros botões, mantém a ativação normal.

Para revisar a câmera em foco, use `Ctrl+1` a `Ctrl+0`; acrescente `Shift` para revisar todas. A ordem é 30 segundos, 1 minuto, 30 minutos, 1 hora, 6 horas, 12 horas, 1 dia, 2 dias, 3 dias e 1 semana. Como no menu de contexto, revisar apenas a câmera em foco fecha as demais e seleciona a grade automática.

Na lista lateral, use as setas para navegar entre câmeras e Enter para abrir ou fechar. Para selecionar mosaicos, use `Ctrl+Alt+A` para automático e `Ctrl+Alt+1` até `Ctrl+Alt+0` para as grades fixas na ordem do seletor.
