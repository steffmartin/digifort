# Digifort Monitor

Player local de streams Digifort. A interface é servida pelo Node em `localhost`; o navegador recebe e decodifica as partes multipart de áudio e vídeo.

## Configurar um servidor

1. Copie `config/example.config` para `config/<servidor>.config`.
2. Preencha `serverAddress`, `userAgent`, `username`, `password` e `timeZone`; mantenha `useBasicAuth` como `false` para a autenticação segura.
3. Edite `initialCameras` com nomes de câmera exatamente como o Digifort os retorna e o perfil `Visualization` ou `Recording`.
4. Mantenha os arquivos reais dentro de `config/`. O `.gitignore` exclui as configurações locais e preserva somente `example.config`.

O player mantém usuário, senha e dados de autenticação no processo local. Eles não são enviados à página nem escritos em logs. Não edite o exemplo com credenciais reais.

`useBasicAuth` pode ser definido como `true` para autenticação tradicional, enviando `AuthUser` e `AuthPass` na query string de cada chamada da API. Use isso somente quando a autenticação segura não funcionar: credenciais em URLs podem ser registradas pelo servidor, proxy ou infraestrutura de rede. O padrão é `false` (autenticação segura).

## Executar

```powershell
npm start
```

Abra `http://127.0.0.1:4177`. O player só solicita áudio depois de ativá-lo na interface.

Como alternativa, execute `Iniciar-Digifort.bat`: o servidor fica no terminal atual e o Chrome abre quando a porta responder. Encerre o Node com `Ctrl+C` nesse terminal.

O terminal mostra a URL local na inicialização e registra erros de transporte/API. Requisições e respostas normais, incluindo cabeçalhos e prévias de corpo, não são impressas.

## Decodificação de vídeo

O player decodifica vídeo H.264 e H.265/HEVC com WebCodecs. Para H.265, deriva o codec string do SPS recebido, verifica o suporte do navegador à configuração indicada e aguarda VPS/SPS/PPS e um quadro de acesso aleatório antes de iniciar a decodificação. O caminho H.264 permanece disponível. A disponibilidade genérica do WebCodecs no navegador não garante suporte ao perfil HEVC específico de cada stream. A integração H.265 ainda precisa ser validada com streams reais ao vivo e gravados.

## Falha conhecida

No teste atual, `/api/server` responde `200`, mas a chamada Node a `Cameras/GetCameras` falha com `FETCH_ERROR` antes de receber uma resposta HTTP. O usuário observou `200` ao abrir essa rota diretamente no navegador com autenticação tradicional. A causa ainda está sendo investigada; acompanhe a [issue de handoff](https://github.com/steffmartin/digifort/issues/1). Não compartilhe configurações reais nem credenciais nos logs.

## Decoder G.726

Se o servidor enviar áudio G.726, compile o módulo WebAssembly usando Docker Desktop ativo:

```powershell
npm run build:g726
```

O arquivo `.wasm` gerado fica em `public/wasm` e é reutilizado em execuções seguintes. Docker não é necessário para iniciar o player.

O decoder é carregado sob demanda quando o áudio G.726 é habilitado. A taxa vem do MIME do frame (`audio/G726-16/24/32/40`); se o stream não identificar uma taxa válida, o player informa o problema. O manual Digifort não define a ordem de packing, então o player usa LSB conforme RFC 3551 e identifica esse fallback no tile. O código Rust usa `oxideav-adpcm` 0.0.8, sob licença MIT.

## Sem áudio

Ativar o botão faz o player solicitar `Audio=TRUE`, mas uma resposta HTTP 200 não garante que o servidor entregou uma trilha de áudio. Em três observações locais de aproximadamente cinco segundos (duas ao vivo e uma gravada), chegaram apenas partes `video/h265`; não havia amostra de áudio para testar codecs. Permissão, configuração da câmera e disponibilidade da trilha ainda precisam ser distinguidas.

O manual Digifort 7.3.0 também documenta `Cameras/GetAudioStream`, uma rota ao vivo separada que pode entregar PCM ou WAV com metadados de canais, taxa de amostragem, bits por amostra e timestamp. Essa rota ainda não está integrada nem testada. Se o servidor entregar áudio por ela, PCM/WAV evita adivinhar codecs comprimidos; a revisão gravada continua usando áudio multiplexado em `Playback/GetMediaStream?Audio=TRUE`, quando houver áudio gravado.

## APIs

O player usa `GetCameras`, `GetMediaStream`, `Playback/GetMediaStream`, `GetTimelineData` e `Playback/GetSnapshot`. Com `useBasicAuth: false`, usa as chamadas temporárias de sessão da autenticação segura; com `useBasicAuth: true`, envia `AuthUser` e `AuthPass` em cada URL da API. Ele não usa API de exportação/download, MJPEG como substituto do stream de mídia nem APIs que alterem configuração do servidor ou preferências do usuário.
