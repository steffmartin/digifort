# Continuidade do Digifort Monitor

A linha de trabalho atual mantém a versão 1.2.0 do instalador Windows. O histórico da implementação inicial está no [plano arquivado](historico/PLANO-INICIAL.md). Consulte as [notas de versão](NOTAS-DE-VERSAO.md) para o que foi entregue e as [issues](https://github.com/steffmartin/digifort/issues) para o estado de propostas e bugs.

## Arquitetura vigente

1. O [inicializador Windows](../installer/Launcher.cs) abre o [servidor Node](../server.mjs) em `127.0.0.1:4177`. Depois que o filho confirma o bind, abre o navegador com perfil dedicado em modo aplicativo. A janela determina o encerramento da sessão e dos processos filhos.
2. O Node lê as configurações, valida a seleção e mantém autenticação e renovação de sessão no processo local. O modo por sessão é o padrão. O modo tradicional é configurável por servidor.
3. O servidor usa as operações documentadas `GetCameras`, `GetMediaStream`, `Playback/GetMediaStream`, `GetTimelineData` e `Playback/GetSnapshot`. Os snapshots servem às miniaturas e os streams multipart à reprodução. Preserve a integração de leitura sem chamadas de escrita, exportação ou alteração de preferências no servidor Digifort.
4. O [player](../public/app.js) trata os frames multipart e decodifica vídeo com WebCodecs. Para HEVC, deriva o codec do SPS, verifica `VideoDecoder.isConfigSupported` e aguarda parâmetros e quadro de acesso aleatório. O áudio AAC e G.711 é tratado no cliente, e o [wrapper WASM](../wasm/g726/README.md) decodifica G.726. O player usa empacotamento LSB como fallback quando a ordem não é informada. O áudio de revisão usa `Playback/GetMediaStream?Audio=TRUE` para a fonte selecionada.
5. A revisão fixa o limite final no início da consulta quando não há fim informado. As miniaturas são mantidas em memória apenas durante sua sessão e descartadas ao sair ou mudar parâmetros relevantes. O servidor consulta a release mais recente uma vez na inicialização e guarda a versão ignorada em `update.json`, separado dos arquivos `.config`.

O [manual e a transcrição OpenAPI](api/README.md) ficam juntos. Use o manual para distinguir tipos e restrições documentados de exemplos e lacunas do schema. Os testes unitários usam dados sintéticos para verificar configuração, autenticação, protocolo, gravação e componentes do cliente; eles não substituem testes integrados com o Digifort.

## Validação e limites

No Windows 11 local, foram validados o assistente, a importação e o preenchimento parcial, a preservação de arquivos em reinstalação e desinstalação, o aviso de porta ocupada, a janela única, o encerramento pelo diálogo e a restauração da geometria. A execução com `PATH` restrito usou o Node incluído no pacote. Na integração posterior, o instalador foi compilado e a criação de configuração, o diálogo e as grades foram verificados com dados sintéticos. A instalação e a desinstalação foram verificadas com identidade de produto, pasta e dados isolados; o runtime instalado serviu a interface e o ícone. A interrupção antes da abertura do assistente também foi verificada. A revisão com câmeras reais foi exercitada: faixas de múltiplas câmeras, zoom, navegação, miniaturas e reordenação da grade. Uma consulta de 24 horas confirmou a conversão dos timestamps recebidos após a correção de milissegundos. Ainda faltam validar o pacote integrado em máquina limpa e no Windows 10 e ampliar a validação dos fluxos combinados de HEVC, áudio e captura.

Antes da mudança para 1.2.0, um build com versão 1.1.0 foi instalado e desinstalado com identidade e dados sintéticos; o runtime instalado confirmou a persistência da versão ignorada após reinício e o aviso de uma versão posterior. O calendário e os limites de miniaturas foram exercitados em Chromium com dados sintéticos. O instalador 1.2.0 foi compilado no Windows 11; a instalação dessa versão em máquina limpa e no Windows 10 permanece pendente.

O [plano arquivado](historico/PLANO-INICIAL.md#handoff--falha-de-transporte-em-getcameras) registra o `FETCH_ERROR` observado em `GetCameras` e a diferença entre a chamada do Node e a resposta informada no navegador. Consulte o histórico e a issue correspondente antes de reproduzir. Use uma configuração sintética e confirme a origem do processo que ocupa a porta local. Registre códigos e categorias de erro sem valores de autenticação ou payloads de mídia.

## Rotina de manutenção

1. Leia [AGENTS.md](../AGENTS.md) e consulte o guia correspondente ao fluxo alterado.
2. Reproduza com dados sintéticos e mantenha arquivos de configuração, perfis e artefatos de build fora do Git.
3. Valide o fluxo afetado e registre limitações verificadas. Para alterações visuais, use [UI](UI.md). Para mudanças de pacote, use [Distribuição](DISTRIBUICAO.md).
4. Execute `npm test` para verificar as regressões de configuração, protocolo e segurança do backend, além de controles da interface, mídia, timeline e miniaturas. A suíte usa dados sintéticos e não substitui a validação no navegador ou com um servidor Digifort.
5. Atualize o [guia de uso](USO.md) quando um fluxo mudar e registre as mudanças que forem compor uma versão nas [notas de versão](NOTAS-DE-VERSAO.md).
