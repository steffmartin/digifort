# Notas de versão do Digifort Monitor

## 1.2.0

### Novidades

- Consulta da release mais recente na inicialização, com opções para abrir a página, ignorar a versão ou dispensar o aviso. A instalação continua manual. ([#39](https://github.com/steffmartin/digifort/issues/39))
- Calendário e campos de horário integrados ao tema, com seleção no fuso do servidor e verificação dos limites da revisão. ([#41](https://github.com/steffmartin/digifort/issues/41))
- Comandos de foco, perfil e fechamento no menu de contexto da câmera, indicador de áudio e restauração do mosaico e das câmeras iniciais pelo botão ou por `Ctrl+Alt+R`.
- Miniaturas reutilizadas em memória durante a sessão de navegação, com paginação limitada ao período da revisão. Quando o fim não é informado, a timeline mantém o limite fixado no início da revisão.
- Controles de revisão reorganizados em janelas menores e timeline com altura limitada e rolagem para preservar a grade de câmeras. Os campos de data usam os rótulos **Início** e **Fim**. ([#46](https://github.com/steffmartin/digifort/issues/46))
- Testes unitários adicionais para controles e processamento de mídia no frontend, e para configuração, autenticação, protocolo e gravação no backend. ([#22](https://github.com/steffmartin/digifort/issues/22), [#21](https://github.com/steffmartin/digifort/issues/21))

### Validação e distribuição

O calendário, os menus, os limites das miniaturas e a responsividade de janelas desktop foram verificados em Chromium com dados sintéticos. A suíte automatizada passou com 32 testes. Um build anterior, identificado como 1.1.0, foi instalado e desinstalado com identidade e dados isolados; seu runtime confirmou a persistência da versão ignorada e o aviso de uma versão posterior. O instalador 1.2.0 foi compilado no Windows 11; confira seu SHA-256 conforme [Distribuição](DISTRIBUICAO.md). A validação do pacote 1.2.0 em máquina limpa e no Windows 10 e a ampliação dos testes integrados de HEVC, áudio e captura permanecem pendentes.

## 1.1.0

### Novidades

- Timeline compacta com faixas de vídeo e áudio por câmera, mudança de dia, zoom pela roda do mouse e navegação sincronizada. A ordem das faixas acompanha a grade. ([#26](https://github.com/steffmartin/digifort/issues/26))
- Miniaturas no mosaico, abertas pelo menu da câmera ou por atalhos, com tamanho e intervalo configuráveis, paginação dimensionada à janela e cancelamento das capturas da página anterior. ([#26](https://github.com/steffmartin/digifort/issues/26))
- Correção da conversão de timestamps com milissegundos que podia descartar intervalos da timeline. ([#27](https://github.com/steffmartin/digifort/issues/27))
- Limite opcional de câmeras por servidor em `maxCams`, com validação das câmeras iniciais e bloqueio de mosaicos incompatíveis. ([#38](https://github.com/steffmartin/digifort/issues/38))
- Gestão de configurações no aplicativo, atalhos para monitoramento, revisão e captura, tela cheia sem a barra inferior e ícone compartilhado com o instalador.
- O instalador x64 aceita Windows 10 a partir da compilação 10240 e Windows 11. A finalização após interrupção antes do assistente foi corrigida.

### Validação e distribuição

A revisão, as miniaturas e a navegação foram exercitadas no Windows 11 com câmeras reais; uma consulta de 24 horas confirmou a conversão dos timestamps recebidos. Os testes automatizados cobrem datas, zoom, arraste, reordenação e cancelamento de miniaturas. A instalação, o runtime e a desinstalação foram verificados no Windows 11 com identidade e dados isolados. O teste do pacote no Windows 10, em máquina limpa e dos demais fluxos integrados de áudio e captura permanece pendente. Confira o SHA-256 do instalador conforme [Distribuição](DISTRIBUICAO.md).

## 1.0.0

### Destaques

- Instalador offline para Windows 11 x64, por usuário, com Node.js incluído. O Google Chrome ou Chromium é um pré-requisito. O assistente acompanha o tema do sistema.
- Inicializador gráfico com janela única em modo aplicativo, persistência de posição, tamanho e maximização, aviso de porta ocupada e encerramento do servidor local ao fechar.
- Assistente para importar um `.config`, preencher a configuração inicial ou seguir sem servidor. O diálogo de primeiro acesso permite abrir a pasta, verificar novamente ou fechar o aplicativo.
- Configurações e perfil do navegador ficam na pasta de dados do usuário. A desinstalação preserva as configurações por padrão e mantém as capturas e gravações.
- A versão reúne monitoramento ao vivo, revisão por timeline e miniaturas, mosaicos, áudio, capturas PNG e gravação local.

### Validação e distribuição

O pacote foi compilado e testado no Windows 11 local com dados sintéticos. A validação em máquina limpa e com câmeras reais segue pendente. Consulte [Continuidade](CONTINUIDADE.md#validação-e-limites) para os fluxos exercitados e [Distribuição](DISTRIBUICAO.md) para gerar o instalador sem assinatura e o `SHA256SUMS.txt`.
