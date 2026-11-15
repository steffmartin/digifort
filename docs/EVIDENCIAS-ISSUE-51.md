# Evidências da issue 51 — gravação local

## Método

Em 15 de novembro de 2026, o fluxo foi exercitado no Windows 11 com Chromium e uma transmissão Digifort real, sem abrir ou registrar a configuração, nomes de câmeras ou imagens. Uma cópia local do aplicativo direcionou os arquivos de teste para uma pasta isolada. Um instrumento temporário no navegador mediu os instantes dos comandos, a duração dos MP4s e a semelhança entre quadros reduzidos do vídeo salvo e quadros da transmissão, amostrados a cada 200 ms. As comparações de quadro são aproximações, especialmente em cenas com pouco movimento.

## Resultados

| Cenário | Tempo decorrido | Resultado |
| --- | ---: | --- |
| Código anterior, áudio desativado | 18,0 s | MP4 com 7,8 s; primeiro quadro mais semelhante ao da transmissão em aproximadamente 10,2 s. |
| Repetição do código anterior | 24,3 s | MP4 com 3,4 s; primeiro quadro mais semelhante ao da transmissão em aproximadamente 20,8 s. |
| Comparação sem trilha de áudio | 16,3 s | MP4 com 16,1 s; primeiro quadro mais semelhante ao da transmissão em 0,2 s. |
| Comparação com fonte silenciosa conectada | 12,3 s | MP4 com 12,1 s; primeiro quadro mais semelhante ao da transmissão em 0,2 s. |
| Correção, com pausa e retomada | 62,5 s, dos quais 10,6 s pausados | MP4 com 51,9 s; primeiro quadro correspondente ao início e último próximo da finalização. |
| Correção, quatro câmeras simultâneas | 19,5 s | Quatro MP4s com 19,0 a 19,5 s; primeiros quadros correspondentes aos primeiros 0,2 a 0,6 s. |
| Correção, áudio ativado | 14,6 s | MP4 com 14,5 s e trilha AAC; primeiro quadro correspondente aos primeiros 0,2 s. |

O comando iniciou a gravação sem abrir diálogo. Os dez arquivos de comparação foram finalizados com conteúdo e sem arquivos `.part` remanescentes. A qualidade e a audibilidade do áudio da câmera não foram avaliadas.

Os 44 testes automatizados incluem verificações do início direto em MP4, da fonte silenciosa ativa desde o início, pausa e retomada, conexão do áudio ativado durante uma gravação, limpeza de recursos e tratamento da indisponibilidade do formato. As verificações de sintaxe do servidor e do cliente também passaram.

O instalador 1.2.2 foi compilado no Windows 11. Uma variante com identidade de produto e pastas isoladas foi instalada e desinstalada: o runtime distribuído serviu a interface, o cliente instalado correspondeu ao código da versão e a configuração sintética foi preservada na desinstalação. A validação em máquina limpa e no Windows 10 permanece pendente.
