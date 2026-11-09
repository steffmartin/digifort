# Plano de desenvolvimento — Player Digifort

**Status:** integração H.265 no cliente e correções de layout/tela cheia concluídas; validação de streams reais e revisão no servidor pendentes; investigação de áudio via `GetAudioStream` aberta; bug de transporte em `Cameras/GetCameras` aberto para investigação.
**Objetivo:** criar um player local moderno para vídeo e áudio de câmeras Digifort usando somente as APIs de leitura documentadas e os fluxos multipart de mídia.

## Goals

- **G1 — Configuração local segura:** carregar configurações por servidor em `config/<servidor>.config`, manter credenciais somente em memória durante a execução e nunca mostrá-las ou registrá-las em logs.
- **G2 — Monitoramento ao vivo:** listar e selecionar câmeras, montar os frames de vídeo e áudio do stream multipart, permitir adicionar/remover câmeras durante a sessão e tocar áudio somente da fonte escolhida, após ativação explícita.
- **G3 — Revisão gravada:** abrir fluxos de gravação a partir de data e hora, sincronizar câmeras selecionadas no mesmo instante, usar velocidade normal e permitir fim opcional.
- **G4 — Busca visual:** mostrar disponibilidade de vídeo/áudio na timeline e miniaturas paginadas de snapshots pontuais.
- **G5 — Somente leitura de configuração do servidor:** não chamar APIs que alterem configuração do servidor ou preferências de usuário.
- **G6 — Execução simples:** iniciar um serviço local Node e usar o navegador para a interface e decodificação.

## Decisões de produto

- Interface moderna em português.
- Um servidor ativo por vez. Com um arquivo de servidor, selecioná-lo automaticamente; com vários, pedir escolha. Só abrir as câmeras iniciais depois que a configuração ativa for conhecida.
- `config/example.config` é apenas o modelo e não aparece como servidor disponível.
- Câmeras iniciais são um mapa de nome para perfil. Mapa vazio significa iniciar sem câmeras. Câmeras adicionadas manualmente usam `Visualization` como perfil inicial.
- Ao vivo usa `Visualization` por padrão. Cada tile pode trocar individualmente para `Recording`; essa escolha vale somente na sessão. Revisão gravada usa `Recording`.
- O usuário pode abrir quantas câmeras selecionar; pode adicionar ou fechar tiles durante o uso.
- O áudio começa desabilitado por política de reprodução automática do navegador. Após ativação, a fonte de áudio é a câmera em foco/escolhida. Só essa câmera solicita áudio; ao trocar a fonte durante a revisão, reabrir seu stream no horário inicial selecionado.
- Revisão gravada: início obrigatório, fim opcional, todas as câmeras alinhadas ao mesmo horário e velocidade 1×. Controles: iniciar, parar e reiniciar a partir de outro horário; não simular pausa nem velocidade variável.
- Timeline com intervalos gravados. Miniaturas por `Playback/GetSnapshot`, selecionáveis a cada 30 s, 1 min, 5 min, 15 min ou intervalo personalizado; 24 por página e carregamento sob demanda.
- Cada servidor exige `timeZone` IANA válido. Formatar timestamps da API no fuso configurado.
- Verificação explícita dos recursos do navegador fica para a etapa final. Codec sem decoder disponível deve gerar estado de erro legível no tile.
- Manter suporte a H.264 e acrescentar H.265/HEVC como codec adicional. A presença de `VideoDecoder` ou suporte do navegador, por si só, não significa que o player já decodifique o formato recebido.

## Modelo de configuração

Arquivo modelo versionado: `config/example.config`. Criar uma cópia para cada servidor, por exemplo `config/unidade-a.config`, e preencher localmente:

```json
{
  "serverAddress": "http://SERVIDOR:8601",
  "userAgent": "VALOR_CONFIGURADO_PARA_O_SERVIDOR",
  "useBasicAuth": false,
  "username": "SEU_USUARIO",
  "password": "SUA_SENHA",
  "timeZone": "America/Sao_Paulo",
  "initialCameras": {
    "Nome exato da câmera": "Visualization",
    "Outra câmera": "Recording"
  }
}
```

Os valores acima são placeholders, não credenciais reais. O exemplo contém duas câmeras fictícias, uma com `Visualization` e outra com `Recording`. Os valores válidos para os perfis iniciais são `Visualization` e `Recording`. `useBasicAuth` é opcional e, quando omitido, equivale a `false`. Com `true`, cada chamada envia usuário e senha na query string; o servidor, proxies ou componentes de rede podem registrar esses URLs, então prefira `false` sempre que possível. Todos os arquivos locais em `config/` são ignorados pelo Git, exceto `example.config`; `config.json` e arquivos `.config` na raiz também são ignorados. A aplicação exclui esse modelo da lista de servidores.

## APIs do manual

- `Interface/Cameras/GetCameras` — listar câmeras com direitos de visualização/gravação.
- `Interface/Cameras/GetMediaStream` — stream ao vivo com áudio/vídeo multiplexados; `Profile`, `Audio`, `Video` e `TimestampHeader` conforme necessário.
- `Interface/Cameras/Playback/GetMediaStream` — stream gravado original, com `StartDate` e `StartTime` obrigatórios, fim opcional, `Audio=TRUE` somente para a fonte de áudio e `Push=FALSE` para velocidade 1×.
- `Interface/Cameras/Playback/GetTimelineData` — disponibilidade dos tracks de vídeo/áudio.
- `Interface/Cameras/Playback/GetSnapshot` — JPEG pontual para miniaturas, não para reproduzir o vídeo.
- Autenticação segura do manual: criar/manter sessão de autenticação em memória e calcular `AuthData`. Essa sessão de autenticação é temporária; não altera configurações do servidor.
- Não usar APIs de exportação/download, o stream MJPEG sem áudio ou APIs de escrita/configuração.

## Handoff — falha de transporte em GetCameras

**Issue:** [investigar `FETCH_ERROR` em `Cameras/GetCameras`](https://github.com/steffmartin/digifort/issues/1)

- Sintoma observado: `/api/server` retorna `200`; `/api/cameras` retorna `502` com `transport:Cameras_GetCameras:FETCH_ERROR`.
- Log atual comprova que o Node inicia a chamada `GET /Interface/Cameras/GetCameras`; query params de autenticação aparecem mascarados. O `fetch` rejeita antes de uma resposta HTTP do Digifort.
- O usuário informou que a mesma rota responde `200` quando aberta diretamente no navegador com autenticação tradicional. Não assumir que isso prova que o caminho Node ou a configuração ativa sejam idênticos.
- O modo `useBasicAuth` estava ativo na tentativa registrada. Não expor ou imprimir credenciais, valores de `User-Agent`, URL completa, query string de autenticação ou conteúdo de configurações reais.
- Reproduções anteriores tiveram interferência de processos/porta local ocupada. Antes de uma nova reprodução, confirme qual processo está atendendo a porta; use uma porta local alternativa se necessário.
- Investigar o `error.cause` de `fetch` e classificar a causa (DNS, conexão, timeout, TLS, proxy ou header) sem registrar o erro original, URL ou headers sensíveis. Comparar a requisição Node com o caminho que respondeu no navegador sem testar credenciais em URLs inseguras fora do fluxo do app.
- Não trocar a autenticação segura padrão nem remover o toggle. `useBasicAuth` permanece opt-in, pois credenciais em query string podem ser registradas por servidor/proxy.
- Critério de conclusão: identificar causa reproduzível; corrigir o caminho Node sem expor autenticação; `/api/cameras` retorna `200` e as câmeras são listadas; logs continuam mascarando autenticação.

## Plano passo a passo

### 1. Modelo e proteção de configurações — concluído

- [x] Criar `config/example.config` com campos e placeholders válidos.
- [x] Criar `.gitignore` para ignorar `config/*.config`, mantendo `config/example.config` como exceção.
- [x] Não abrir nem copiar valores de configurações reais, inclusive o novo JSON local indicado pelo usuário.

### 2. Base do serviço local

- [x] Criar `package.json` e o servidor Node para servir a interface em `localhost`.
- [x] Descobrir arquivos `config/*.config`, excluindo `example.config`.
- [x] Validar campos requeridos sem imprimir seus valores.
- [x] Se houver um único servidor, ativá-lo automaticamente; com vários, apresentar seletor.
- [x] Implementar endpoints locais para lista de servidores, câmeras, timeline, snapshots e streams.
- [x] Garantir que erros e logs removam senha, `AuthData`, `AuthSession` e URLs completas de autenticação; não expor valores lidos de arquivos locais de configuração.

### 3. Integração de leitura com a API

- [x] Implementar autenticação segura do manual no processo Node, mantendo usuário, senha, nonce e dados de sessão somente em memória.
- [x] Permitir seleção por servidor entre autenticação segura (padrão) e `useBasicAuth`; documentar risco das credenciais na query string no modo tradicional.
- [x] Implementar atualização da sessão de autenticação quando necessária.
- [x] Carregar a lista de câmeras com `GetCameras` e não solicitar campos desnecessários.
- [x] Converter datas/horas entre a entrada visual do usuário, `timeZone` configurado e os formatos da API.
- [x] Encaminhar streams sem gravá-los em disco e sem repassar credenciais à página.

### 4. Parser e decodificação dos streams

- [x] Interpretar as partes multipart pelo boundary, cabeçalhos `Content-Length`, `Content-Type`, `DGF-FrameType` e timestamps.
- [x] Preservar timestamps de áudio/vídeo na linha temporal de decodificação.
- [x] Renderizar frames JPEG se um perfil os produzir.
- [x] Decodificar vídeo H.264 com WebCodecs.
- [x] Registrar a linha de base do H.264 em uso: formato dos frames multipart, identificação de keyframes/parâmetros e configuração do `VideoDecoder`; usar esse fluxo como referência para a integração H.265 sem remover H.264.
- [x] Decodificar AAC e G.711 com os decoders disponíveis no navegador.
- [ ] Investigar e integrar `Interface/Cameras/GetAudioStream` como caminho de áudio ao vivo separado: `Format=PCM` (padrão) ou `WAV`, `TimestampHeader=TRUE`; manter as credenciais no processo Node e encaminhar somente os chunks multipart autorizados.
- [ ] Interpretar os cabeçalhos PCM (`DGF-PCMChannels`, `DGF-PCMSamplesPerSecond`, `DGF-PCMBitsPerSample`, `DGF-FrameDate` e `DGF-FrameTime`) e enviar o áudio PCM ao Web Audio sem codec guessing; tratar WAV conforme o cabeçalho e amostras recebidos.
- [ ] Confirmar em uma conta/câmera com áudio habilitado se `GetAudioStream` entrega frames; exibir separadamente ausência de track, falta de permissão e erro de formato. Não criar amostra nem tentar codecs quando não houver payload de áudio.
- [ ] Preservar o áudio multiplexado de `Playback/GetMediaStream?Audio=TRUE` para revisão gravada; o manual não documenta uma rota separada de reprodução gravada somente de áudio.
- [ ] Inspecionar cabeçalhos e payloads H.265/HEVC dos frames recebidos (`Content-Type`, `DGF-FrameType`, NALs e timestamps) para identificar formato de empacotamento e parâmetros necessários à configuração do decoder; usar fixtures locais sem credenciais e sem registrar payloads de mídia.
- [x] Derivar a configuração HEVC exigida pelo WebCodecs a partir dos parâmetros do SPS e consultar `VideoDecoder.isConfigSupported` para o codec string derivado antes de iniciar a decodificação.
- [x] Integrar a decodificação H.265 ao ciclo de vida de vídeo já usado por H.264: despacho por codec, keyframes, timestamps, renderização no canvas, atualização de estado/indicador, fila de decodificação, fechamento e reinício do decoder.
- [ ] Manter o caminho H.264 funcional e testar a seleção entre H.264 e H.265 em streams multipart; não presumir suporte apenas pelo nome do navegador ou por teste de configuração genérico.
- [x] Apresentar erro específico quando o navegador não suportar o perfil HEVC derivado, quando faltarem parâmetros do stream ou quando um frame H.265 for inválido; não deixar a mensagem genérica de codec compatível ocultar a causa.
- [ ] Validar H.264 e H.265 com streams reais em modo ao vivo e revisão gravada, incluindo primeira imagem após keyframe, continuidade de timestamps e comportamento ao fechar/reabrir tile ou trocar perfil.
- [x] Integrar o decoder G.726 WebAssembly compilado em Docker. A taxa é lida do MIME `audio/G726-16/24/32/40`; se ausente ou inválida, a interface mostra um erro em vez de presumir uma taxa. Como o manual Digifort não especifica a ordem de packing, usa LSB do RFC 3551 quando não existe metadado explícito e mostra essa escolha no tile.
- [x] Encaminhar PCM ao Web Audio e selecionar apenas o áudio da fonte ativa.
- [x] Mostrar erro legível quando um stream usar codec não suportado.
- [x] Encerrar streams e decoders ao fechar câmera, trocar servidor ou reiniciar modo/perfil.

### 5. Interface de monitoramento

- [x] Criar layout moderno responsivo em português com lista/pesquisa de câmeras e grade dinâmica.
- [x] Abrir somente as câmeras especificadas em `initialCameras`; lista vazia inicia sem tiles.
- [x] Permitir selecionar, abrir e fechar câmeras sem limite fixo imposto pela interface.
- [x] Indicar tile em foco e permitir selecionar a fonte de áudio.
- [x] Iniciar sem áudio e habilitá-lo somente após clique do usuário.
- [x] Limitar a altura da grade de câmeras e permitir rolagem interna para manter os controles e a timeline visíveis.
- [x] Manter o aspect ratio das imagens e permitir expandir um tile para tela cheia por duplo clique ou tecla F; sair com Esc.
- [x] Oferecer modo ao vivo e selecionar perfil `Visualization`/`Recording` por tile no ao vivo.
- [x] Ao mudar o perfil de um tile, reiniciar apenas o stream daquele tile.
- [x] Apresentar estados de conexão, carregamento, sem gravação e codec incompatível sem detalhes sensíveis.

### 6. Revisão gravada, timeline e miniaturas

- [x] Adicionar entrada de data/hora de início e fim opcional no fuso do servidor.
- [x] Iniciar todos os tiles selecionados no mesmo horário usando `Playback/GetMediaStream`, áudio multiplexado somente para a fonte ativa e `Push=FALSE`.
- [x] Oferecer iniciar, parar e reiniciar em outro horário.
- [x] Consultar e desenhar tracks de vídeo/áudio via `GetTimelineData`.
- [x] Permitir iniciar a revisão ao selecionar um ponto na timeline.
- [x] Buscar miniaturas com `Playback/GetSnapshot` nos pontos da grade de intervalos.
- [x] Paginar 24 miniaturas por vez, buscar sob demanda e permitir selecionar uma miniatura para iniciar naquele instante.

### 7. Compatibilidade e acabamento — última etapa

- [x] Verificar WebCodecs por decoder/codec durante a recepção da mídia e informar quando não estiver disponível.
- [x] Mostrar orientação para navegador incompatível; não iniciar decodificação sem decoder.
- [ ] Revisar o funcionamento em `localhost`, o fuso exibido e a ausência de áudio automático.
- [ ] Confirmar visualmente layout responsivo, foco, controles e estados de erro.
- [x] Revisar lista rolável, tiles limitados, proporção da imagem e entrada/saída de tela cheia em viewports de desktop e tablet, usando APIs mockadas.
- [x] Documentar instalação/execução Node, criação de `config/<servidor>.config` e build Docker do WASM.
- [x] Confirmar por revisão estática do código que nenhuma rota de escrita/configuração foi usada e que valores secretos não aparecem em logs ou respostas da interface.

## Dependências e fatos conhecidos

- Node v26 e npm estão disponíveis nesta máquina; o projeto declara Node 20 ou superior.
- O Chromium 156 em `localhost` expõe WebCodecs; a verificação local aceitou H.264, H.265, AAC e G.711 A-law/μ-law. G.726 não é aceito nativamente.
- O cliente decodifica H.264 e agora implementa a configuração/decodificação H.265 via WebCodecs; compatibilidade do perfil HEVC exato e formato real das unidades multipart ainda precisam de validação com streams reais.
- Em diagnóstico local com acesso possivelmente limitado, `Audio=TRUE` retornou HTTP 200 em duas chamadas ao vivo e uma de revisão; durante aproximadamente 5 s por chamada foram observadas somente partes `video/h265`, sem MIME/cabeçalho de áudio. Nenhuma amostra de áudio foi salva nem codec tentado porque não chegou payload de áudio. Permissão da conta, configuração da câmera e disponibilidade da trilha continuam como causas possíveis.
- O manual da Digifort 7.3.0/API 1.9.0 documenta `Cameras/GetAudioStream` (seção 4.3.8, páginas 73–75): stream multipart ao vivo PCM ou WAV, com cabeçalhos de canais, samples/segundo, bits por sample e timestamps. Essa rota não está implementada nem testada no player; pode contornar decodificação de G.711/G.726/AAC se o servidor conceder acesso e entregar áudio.
- O mesmo manual documenta que `Playback/GetMediaStream` só inclui áudio gravado quando `Audio=TRUE` e quando há áudio gravado; `GetJPEGStream` de revisão não transmite áudio. Não há rota de reprodução gravada somente de áudio documentada no índice/API consultados.
- Docker CLI 29.9.2 está instalado, mas o Docker Desktop Engine não estava acessível na última verificação. A etapa WASM requer Docker Engine ativo durante a compilação.
- `legacy/vision_wasm_internal.wasm` pertence ao bundle de visão e não expõe decoder G.726 identificável.
- A pasta `legacy/` é somente referência e não será alterada.
- O repositório Git privado foi inicializado pelo responsável do projeto; não fazer commits sem autorização explícita.
- O app foi iniciado localmente: `/api/server` respondeu `200`, mas a chamada Node a `Cameras/GetCameras` retornou `FETCH_ERROR` antes de obter resposta HTTP. A API aberta diretamente no navegador retornou `200` segundo o usuário; investigar a diferença está em aberto na issue acima.
- H.265 está integrado como suporte adicional; H.264 continua suportado. Não houve validação de imagem com stream H.265 real nesta implementação.
- O player ainda precisa de validação abrangente com streams reais de áudio/vídeo. A ordem de packing G.726 deve ser confirmada com os dados reais do servidor. Revisão visual em runtime continua pendente.

## Critérios de conclusão

- Um arquivo real por servidor é carregado sem expor credenciais no navegador, terminal ou logs.
- Câmeras iniciais e seleção dinâmica decodificam fluxos H.264 e H.265 reais ao vivo e gravados; quando houver áudio suportado, a fonte escolhida toca após ativação explícita.
- Revisão gravada abre o stream no instante escolhido, mantém as câmeras alinhadas e não usa endpoint de download.
- Timeline e miniaturas correspondem aos intervalos/instantes do servidor e podem navegar para a revisão gravada.
- Nenhuma API que altere configuração do servidor ou preferências do usuário é chamada.

