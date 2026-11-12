# Guia de uso do Digifort Monitor

## Instalar e abrir

No Windows x64, execute o instalador com Google Chrome, Chromium compatível ou Microsoft Edge já instalado. O instalador atual aceita Windows 10 e 11; a validação no Windows 10 permanece pendente. Consulte as notas da release para confirmar os requisitos do pacote baixado. No assistente, importe um `.config`, preencha os dados do primeiro servidor ou escolha **Pular por enquanto**. O preenchimento parcial pode ser salvo para completar depois. Na página **Preferências do servidor**, configure o mosaico inicial e as câmeras que devem abrir ao conectar.

Abra **Digifort Monitor** no menu Iniciar ou pelo atalho na área de trabalho, se selecionado na instalação. Fechar a janela encerra o servidor local. Na próxima abertura, o aplicativo restaura a posição, o tamanho e o estado de maximização da janela. Consulte [Distribuição](DISTRIBUICAO.md) para verificar o pacote, atualizar ou desinstalar.

Ao iniciar, o aplicativo verifica se há uma release mais recente. No aviso, **Baixar** abre a página da release, **Ignorar esta versão** impede novos avisos para ela e **Cancelar** fecha o aviso. Uma versão posterior pode gerar um novo aviso. A consulta é silenciosa quando falha e não instala atualizações.

## Configurar um servidor

Use o botão de configurações ao lado do estado de conexão para criar, editar ou excluir servidores. Os arquivos ficam em `%LOCALAPPDATA%\Digifort Monitor\config` na versão instalada e em `config/` na versão executada a partir do código-fonte. O aplicativo exclui [example.config](../config/example.config) da lista de servidores.

O diálogo pausa as transmissões enquanto está aberto. Ao editar uma configuração, deixe a senha vazia para preservar a senha atual; o botão ao lado permite revelar ou ocultar o texto digitado. Ao fechar, o aplicativo retoma as transmissões ou reconecta o servidor alterado.

| Campo | Preenchimento |
| --- | --- |
| `name` | Rótulo no seletor. Se estiver vazio, o aplicativo usa o nome do arquivo. |
| `serverAddress` | Endereço HTTP ou HTTPS, com porta quando necessária. Informe usuário e senha nos campos próprios. |
| `userAgent` | User-Agent esperado pelo servidor Digifort. |
| `username` e `password` | Dados da conta usada para acessar o Digifort. |
| `useBasicAuth` | `false` usa autenticação por sessão e é o padrão. `true` envia `AuthUser` e `AuthPass` na URL, que pode ser registrada pelo Digifort, proxy ou infraestrutura de rede. |
| `timeZone` | Fuso IANA do servidor, por exemplo `America/Sao_Paulo`. |
| `initialCameras` | Mapa de nomes exatos de câmera para `Visualization` ou `Recording`. Use `{}` para iniciar com a grade vazia. |
| `maxCams` | Limite opcional de câmeras abertas por servidor; `0` ou ausência significa sem limite. As câmeras iniciais não podem exceder esse valor. |
| `initialMosaic` | ID opcional do [mosaico inicial](#mosaico-inicial). |
| `mediaFolder`, `screenshotFolder` e `videoFolder` | Caminhos completos para pastas graváveis. Cada destino específico vazio ou omitido usa `mediaFolder`. |

O aplicativo seleciona automaticamente uma configuração válida quando ela é a única utilizável. Quando houver mais de uma, escolha o **Servidor** na barra superior. Sem configuração válida, o diálogo abre automaticamente para criar ou corrigir uma configuração.

Mantenha os arquivos reais na pasta local de configurações e use somente dados fictícios em exemplos compartilhados. Usuário, senha e dados de autenticação são tratados no servidor local.

## Monitorar ao vivo

Selecione **Ao vivo**, busque uma câmera na lateral e clique nela para abrir o vídeo na grade. Câmeras adicionadas manualmente começam com o perfil `Visualization`. No menu de contexto do quadro, escolha o perfil, defina a câmera em foco, feche-a ou inicie uma captura. Abra uma câmera em tela cheia com duplo clique ou `F`. Use `Esc` para voltar à grade ou sair do modo vigilância.

Selecione uma câmera no quadro ou em **Em foco:**. A câmera em foco determina a fonte do áudio. Para ouvir, ative o botão de áudio ao lado do seletor; ao mudar o foco, o áudio ativo acompanha a nova câmera. O player aceita AAC, G.711 e G.726 conforme o fluxo recebido. H.264 e H.265/HEVC são decodificados com WebCodecs e dependem do perfil aceito pelo navegador.

### Mosaico inicial

Use um dos valores abaixo em `initialMosaic`. Se estiver ausente ou for desconhecido, inclusive para grades removidas, o aplicativo usa a grade automática silenciosamente. Se a capacidade da grade inicial exceder `maxCams`, também usa a grade automática. A alteração pelo seletor vale para a sessão atual. O botão **Restaurar grade configurada** ou `Ctrl+Alt+R` reconecta o servidor e restaura o mosaico e as câmeras iniciais; gravações locais em andamento são finalizadas.

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

Abra **Revisão**, informe o início e, se desejar, o fim no fuso do servidor. Os campos aceitam edição direta ou seleção no calendário; escolha a hora e clique em **Confirmar**. O fim deve ser posterior ao início para reproduzir. Clique em **Reproduzir**. A timeline mostra os intervalos de vídeo e áudio de cada câmera aberta. Sem fim informado, o limite da timeline é fixado no instante em que a revisão começa; para incluir gravações posteriores, clique novamente em **Reproduzir**. Clique em uma faixa para navegar em todas as câmeras. Use a roda do mouse sobre a timeline para ajustar o zoom no ponto indicado e arraste para navegar quando houver zoom.

Para abrir miniaturas, clique com o botão direito no quadro da câmera e escolha **Esta câmera > Miniaturas**, o tamanho e o intervalo. As miniaturas começam no tamanho grande. Use as setas esquerda e direita para mudar de página ou `Ctrl+Shift+Alt+1` a `Ctrl+Shift+Alt+0` para abri-las na câmera em foco, com intervalos de 5 segundos a 5 horas na ordem do menu. As imagens carregadas são reutilizadas ao navegar entre páginas durante a sessão de miniaturas; o cache é descartado ao sair dela ou alterar parâmetros relevantes. As transmissões pausam enquanto as miniaturas ocupam a grade; clique em uma imagem para retomar todas a partir daquele instante ou use **Voltar às câmeras**. Use **Opções de exibição** para controlar dados sobrepostos e timeline.

## Salvar capturas e gravações

Use o menu de contexto de um quadro para capturar um PNG sem sobreposições ou iniciar, pausar, retomar e finalizar uma gravação local. O vídeo registra os quadros reproduzidos e pode incluir o áudio decodificado quando estiver ativo. O seletor oferece MP4 ou MPG/MPEG conforme o suporte de `MediaRecorder`. O Digifort Monitor salva os arquivos na pasta de mídia configurada. Os nomes usam o fuso do servidor, a hora atual no modo ao vivo ou a posição da reprodução na revisão.

Finalize a gravação para salvar o arquivo completo. Se fechar o aplicativo durante uma gravação, o servidor tenta recuperar os blocos recebidos por inteiro. A desinstalação preserva as capturas e gravações.

## Atalhos de teclado

Abra **Atalhos de teclado** no rodapé da lista de câmeras para consultar os comandos. Os atalhos ficam suspensos durante a edição de campos e enquanto um diálogo está aberto. Espaço controla todas as câmeras quando o foco está na lista lateral; em outros botões, mantém a ativação normal.

Para revisar a câmera em foco, use `Ctrl+1` a `Ctrl+0`; acrescente `Shift` para revisar todas. A ordem é 30 segundos, 1 minuto, 30 minutos, 1 hora, 6 horas, 12 horas, 1 dia, 2 dias, 3 dias e 1 semana. Como no menu de contexto, revisar apenas a câmera em foco fecha as demais e seleciona a grade automática.

Na lista lateral, use as setas para navegar entre câmeras e Enter para abrir ou fechar. Para selecionar mosaicos, use `Ctrl+Alt+A` para automático e `Ctrl+Alt+1` a `Ctrl+Alt+6` para as seis grades fixas na ordem do seletor. Use `Ctrl+PrintScreen` para capturar a câmera em foco ou `Ctrl+Shift+PrintScreen` para todas.
