# Issue 61 — baseline e matriz de regressão

Baseline obtida no commit `a90de8c` (Node.js v26.13.0):

- `node --check server.mjs`: aprovado.
- `node --check public/app.js`: aprovado.
- `npm test`: 70 testes aprovados, nenhum reprovado ou ignorado.
- Dados de validação: `.validation/issue-61/`, com diretórios isolados para configuração e mídia; não usar dados ou credenciais reais.
- Navegador das capturas parciais: Chromium, user agent Chrome/157.0.0.0, Windows 64 bits.
- Capturas parciais: `.validation/issue-61/configuracao-<largura>x<altura>.png`, diálogo inicial sem configuração, nas sete dimensões previstas.
- Capturas exploratórias adicionais: `ao-vivo-sintetico-<largura>x<altura>.png` e `revisao-vazia-<largura>x<altura>.png`. Usaram respostas HTTP interceptadas e dois quadros JPEG sintéticos. A transmissão simulada termina após um quadro, portanto não substitui uma baseline estável de reprodução contínua nem valida reconexão.
- Por autorização do usuário, a validação visual também usou o servidor configurado, sem leitura do arquivo de configuração ou inspeção do tráfego de autenticação. As imagens reais ficam somente na pasta local de validação e não devem ser adicionadas ao Git.
- Capturas `real-ao-vivo-*` (grade fixa), `real-revisao-vazia-*`, `real-revisao-*`, `real-miniaturas-*`, `real-gravacao-*` e `real-atualizacao-*` foram feitas nas sete dimensões. O diálogo de configuração foi capturado separadamente com configuração vazia. A gravação usou vídeo real, com o destino local interceptado; o diálogo de atualização usou uma resposta fictícia. As primeiras capturas chamadas `real-vigilancia-*` e `real-tela-cheia-*` não comprovaram esses estados; foram refeitas e verificadas separadamente.
- A reprodução real, a disponibilidade na timeline, uma página de miniaturas e o início da gravação foram observados na interface. Relógio, imagens e outros dados dinâmicos não são adequados à comparação literal pixel a pixel; devem ser mascarados ou avaliados separadamente na comparação posterior.
- Após a extração do shell, o navegador integrado exibiu a grade de vigilância, ampliou uma câmera e restaurou a grade e a interface com `V`. O navegador recusou o bloqueio de `Esc`; o fluxo completo com essa tecla ainda precisa de validação em uma janela que conceda o bloqueio.

## Matriz de funcionalidades

Levantamento de `docs/UI.md` e `docs/NOTAS-DE-VERSAO.md`; todos os itens devem ser comparados antes e depois da extração.

| Área | Estados e operações a preservar |
| --- | --- |
| Servidores e configuração | Criar, editar, excluir, trocar, restaurar, conexão, sessão, falhas e retomada após diálogo. |
| Câmeras e mosaico | Listar, filtrar, abrir, fechar, foco, perfis, status, ordem, grades automáticas e fixas, limites, salvar e restaurar. |
| Ao vivo e áudio | Reprodução dos codecs suportados, reconexão, fonte em foco, ativação e pausa do áudio. |
| Presença | Desativada, foco e todas as câmeras; sinais, ausência, intervalo, suspensão, falha e retomada. |
| Revisão | Datas, horários, fuso, limites, inversão, reprodução, saltos sincronizados e mudança de dia. |
| Timeline | Faixas, zoom, arraste, clique, reordenação, rolagem, ocultação e restauração. |
| Miniaturas | Abertura, tamanho, intervalo, páginas, cancelamento, cache e prévia intermediária. |
| Captura | PNG, MP4, indisponibilidade, início, pausa, retomada, finalização, áudio e escopo multicâmera. |
| Vigilância e tela cheia | Entrada, ampliação, restauração, saída em dois níveis, menu de contexto e atalhos. |
| Interface | Barra flutuante, teclado, foco, menus, diálogos, rótulos, janelas estreitas e tela cheia. |
| Atualização e distribuição | Consulta, ignorar, progresso, SHA-256, falha, instalação e desinstalação isoladas. |
| Segurança e transporte | Loopback, origem, sessão e renovação, canais temporários, caminhos de mídia e diagnóstico sem dados privados. |

## Comparação posterior

- O código do commit `a90de8c` foi executado em pasta isolada e comparado à implementação atual nas sete dimensões. Ao vivo, revisão vazia, revisão carregada e miniaturas foram comparados pixel a pixel com vídeo, lista dinâmica, relógio, mensagens e demais regiões variáveis mascarados. Os controles restantes diferiram em até oito pixels por imagem, nas bordas das máscaras ou por arredondamento visual.
- Vigilância e câmera ampliada foram capturadas em Chromium separado, após confirmar a entrada em tela cheia e a ampliação. Com quadros, estados e mensagens dinâmicos ocultos, as sete comparações de cada estado não apresentaram pixels diferentes.
- A gravação ativa também foi repetida com o destino de mídia interceptado e as regiões dinâmicas mascaradas; as imagens diferiram em até sete pixels por resolução. Os diálogos de configuração vazia e atualização fictícia foram capturados em condições sintéticas: o primeiro diferiu em até oito pixels de antialiasing e o segundo não apresentou pixels diferentes.
- No aplicativo com o transporte modular, foram exercitados conexão, vídeo, alternância da fonte de áudio e desligamento, revisão com seis faixas e paginação de miniaturas. O teste automatizado em Chromium exercitou também a ampliação e a saída da vigilância em dois níveis por eventos de teclado; a permissão real de bloqueio de `Esc` continua dependente do navegador.
- Essas comparações não verificam o conteúdo das regiões mascaradas. A validação real complementa, mas não substitui, os testes sintéticos automatizados de falhas e estados raros.

## Distribuição com transporte modular

- Em uma cópia de trabalho isolada, o instalador de teste compilou com Inno Setup 7.1.1. O SHA-256 calculado e o arquivo de checksums coincidiram: `4b1d745e68f0ec5b78a6d0cb65a1de3482f3333f39ca3b6a2d15e2a641a6b50f`. Este é um artefato de teste local, não uma release.
- Uma variante com identidade, pasta de instalação e dados isolados foi instalada e desinstalada. Os hashes dos módulos de transporte, shell e player instalados corresponderam aos da preparação; o Node instalado serviu a interface e o shell em loopback. A desinstalação removeu o servidor e preservou a configuração de exemplo.
- A validação não usou a pasta de configurações real nem inspecionou autenticação. Não substitui a instalação em máquina limpa ou no Windows 10.
