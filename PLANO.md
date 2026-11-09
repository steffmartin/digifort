# Plano de desenvolvimento — Player Digifort

**Status:** planejamento confirmado; tarefa de configuração inicial concluída.  
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

## Modelo de configuração

Arquivo modelo versionado: `config/example.config`. Criar uma cópia para cada servidor, por exemplo `config/unidade-a.config`, e preencher localmente:

```json
{
  "serverAddress": "http://SERVIDOR:8601",
  "username": "SEU_USUARIO",
  "password": "SUA_SENHA",
  "timeZone": "America/Sao_Paulo",
  "initialCameras": {
    "Nome exato da câmera": "Visualization",
    "Outra câmera": "Recording"
  }
}
```

Os valores acima são placeholders, não credenciais reais. O exemplo contém duas câmeras fictícias, uma com `Visualization` e outra com `Recording`. Os valores válidos para os perfis iniciais são `Visualization` e `Recording`. Todos os arquivos locais em `config/` são ignorados pelo Git, exceto `example.config`; `config.json` e arquivos `.config` na raiz também são ignorados. A aplicação exclui esse modelo da lista de servidores.

## APIs do manual

- `Interface/Cameras/GetCameras` — listar câmeras com direitos de visualização/gravação.
- `Interface/Cameras/GetMediaStream` — stream ao vivo com áudio/vídeo multiplexados; `Profile`, `Audio`, `Video` e `TimestampHeader` conforme necessário.
- `Interface/Cameras/Playback/GetMediaStream` — stream gravado original, com `StartDate` e `StartTime` obrigatórios, fim opcional, `Audio=TRUE` somente para a fonte de áudio e `Push=FALSE` para velocidade 1×.
- `Interface/Cameras/Playback/GetTimelineData` — disponibilidade dos tracks de vídeo/áudio.
- `Interface/Cameras/Playback/GetSnapshot` — JPEG pontual para miniaturas, não para reproduzir o vídeo.
- Autenticação segura do manual: criar/manter sessão de autenticação em memória e calcular `AuthData`. Essa sessão de autenticação é temporária; não altera configurações do servidor.
- Não usar APIs de exportação/download, o stream MJPEG sem áudio ou APIs de escrita/configuração.

## Plano passo a passo

### 1. Modelo e proteção de configurações — concluído

- [x] Criar `config/example.config` com campos e placeholders válidos.
- [x] Criar `.gitignore` para ignorar `config/*.config`, mantendo `config/example.config` como exceção.
- [x] Não abrir nem copiar valores de configurações reais, inclusive o novo JSON local indicado pelo usuário.

### 2. Base do serviço local

- [ ] Criar `package.json` e o servidor Node para servir a interface em `localhost`.
- [ ] Descobrir arquivos `config/*.config`, excluindo `example.config`.
- [ ] Validar campos requeridos sem imprimir seus valores.
- [ ] Se houver um único servidor, ativá-lo automaticamente; com vários, apresentar seletor.
- [ ] Implementar endpoints locais para lista de servidores, câmeras, timeline, snapshots e streams.
- [ ] Garantir que erros e logs removam senha, `AuthData`, `AuthSession` e URLs completas de autenticação; não expor valores lidos de arquivos locais de configuração.

### 3. Integração de leitura com a API

- [ ] Implementar autenticação segura do manual no processo Node, mantendo usuário, senha, nonce e dados de sessão somente em memória.
- [ ] Implementar atualização da sessão de autenticação quando necessária.
- [ ] Carregar a lista de câmeras com `GetCameras` e não solicitar campos desnecessários.
- [ ] Converter datas/horas entre a entrada visual do usuário, `timeZone` configurado e os formatos da API.
- [ ] Encaminhar streams sem gravá-los em disco e sem repassar credenciais à página.

### 4. Parser e decodificação dos streams

- [ ] Interpretar as partes multipart pelo boundary, cabeçalhos `Content-Length`, `Content-Type`, `DGF-FrameType` e timestamps.
- [ ] Preservar a ordem temporal dos frames e a relação entre timestamps de áudio/vídeo.
- [ ] Renderizar frames JPEG se um perfil os produzir.
- [ ] Decodificar vídeo H.264 com WebCodecs; usar H.265 quando o navegador reportar suporte.
- [ ] Decodificar AAC e G.711 com os decoders disponíveis no navegador.
- [ ] Compilar um decoder de G.726 para WebAssembly dentro de Docker e guardar o artefato no projeto; não exigir Docker ou Rust durante a execução normal.
- [ ] Encaminhar PCM ao Web Audio e selecionar apenas o áudio da fonte ativa.
- [ ] Mostrar erro legível quando um stream usar codec não suportado.
- [ ] Encerrar streams e decoders ao fechar câmera, trocar servidor, alternar modo ou sair.

### 5. Interface de monitoramento

- [ ] Criar layout moderno responsivo em português com lista/pesquisa de câmeras e grade dinâmica.
- [ ] Abrir somente as câmeras especificadas em `initialCameras`; lista vazia inicia sem tiles.
- [ ] Permitir selecionar, abrir e fechar câmeras sem limite fixo imposto pela interface.
- [ ] Indicar tile em foco e permitir selecionar a fonte de áudio.
- [ ] Iniciar sem áudio e habilitá-lo somente após clique do usuário.
- [ ] Oferecer modo ao vivo e selecionar perfil `Visualization`/`Recording` por tile no ao vivo.
- [ ] Ao mudar o perfil de um tile, reiniciar apenas o stream daquele tile.
- [ ] Apresentar estados de conexão, carregamento, sem gravação, erro de autenticação e codec incompatível sem detalhes sensíveis.

### 6. Revisão gravada, timeline e miniaturas

- [ ] Adicionar entrada de data/hora de início e fim opcional no fuso do servidor.
- [ ] Iniciar todos os tiles selecionados no mesmo horário usando `Playback/GetMediaStream`, áudio multiplexado somente para a fonte ativa e `Push=FALSE`.
- [ ] Oferecer iniciar, parar, reiniciar em outro horário e selecionar intervalo de armazenamento se suportado pela tela.
- [ ] Consultar e desenhar tracks de vídeo/áudio via `GetTimelineData`.
- [ ] Permitir iniciar a revisão ao selecionar um ponto na timeline.
- [ ] Buscar miniaturas com `Playback/GetSnapshot` nos pontos da grade de intervalos.
- [ ] Paginar 24 miniaturas por vez, buscar sob demanda e permitir selecionar uma miniatura para iniciar naquele instante.

### 7. Compatibilidade e acabamento — última etapa

- [ ] Verificar ao iniciar se `VideoDecoder`, `AudioDecoder` e codecs necessários estão disponíveis.
- [ ] Mostrar orientação para navegador incompatível; não iniciar fluxo silenciosamente sem decoder.
- [ ] Revisar o funcionamento em `localhost`, o fuso exibido e a ausência de áudio automático.
- [ ] Confirmar visualmente layout responsivo, foco, controles e estados de erro.
- [ ] Documentar instalação/execução Node, criação de `config/<servidor>.config` e build Docker do WASM.
- [ ] Confirmar por revisão do código que nenhuma rota de escrita/configuração foi usada e que valores secretos não aparecem em logs ou respostas da interface.

## Dependências e fatos conhecidos

- Node v26 e npm estão disponíveis nesta máquina.
- O Chromium 156 em `localhost` expõe WebCodecs; a verificação local aceitou H.264, H.265, AAC e G.711 A-law/μ-law. G.726 não é aceito nativamente.
- Docker CLI 29.9.2 está instalado, mas o Docker Desktop Engine não estava acessível na última verificação. A etapa WASM requer Docker Engine ativo durante a compilação.
- `legacy/vision_wasm_internal.wasm` pertence ao bundle de visão e não expõe decoder G.726 identificável.
- A pasta `legacy/` é somente referência e não será alterada.
- Ainda não há projeto Node nem repositório Git na raiz; o documento e os arquivos iniciais serão criados na raiz/pasta `config/`.

## Critérios de conclusão

- Um arquivo real por servidor é carregado sem expor credenciais no navegador, terminal ou logs.
- Câmeras iniciais e seleção dinâmica abrem fluxos de vídeo reais; quando houver áudio suportado, a fonte escolhida toca após ativação explícita.
- Revisão gravada abre o stream no instante escolhido, mantém as câmeras alinhadas e não usa endpoint de download.
- Timeline e miniaturas correspondem aos intervalos/instantes do servidor e podem navegar para a revisão gravada.
- Nenhuma API que altere configuração do servidor ou preferências do usuário é chamada.

