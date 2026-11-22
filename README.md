# AdsEnguisher — YouTube Adblock (Manifest V3)

Bloqueador de anúncios de alta performance para YouTube, desenvolvido em **Manifest V3** para navegadores baseados em Chromium (Google Chrome, Microsoft Edge, Brave, Opera, Vivaldi).

Projetado para eliminar anúncios de vídeo instantaneamente (início a 0s sem tela preta), ocultar anúncios no Feed e na Busca, pular anúncios no Shorts e contornar os sistemas de detecção anti-adblock do YouTube.

---

## ⚡ Principais Funcionalidades

- **Início Instantâneo de Vídeo (Zero Black Screen)**:
  - Remove `adConfig`, `daiConfig`, `adPlacements` e `playerAds` diretamente dos dados do player antes da reprodução.
  - O player do YouTube não entra em modo de anúncio nem aguarda timeout de carregamento (sem buffering fantasma de 10s).
- **Shorts Sem Anúncios**:
  - Detecta e salta automaticamente vídeos patrocinados no feed do YouTube Shorts.
- **Feed e Pesquisa Limpos**:
  - Filtra anúncios de topo de busca (`searchPyvRenderer`), banners do feed inicial (`adSlotRenderer`, `inFeedAdLayoutRenderer`, `masthead`) e anúncios laterais (`ytd-companion-slot-renderer`).
- **Bypass de Detecção Anti-Adblock**:
  - Redireciona `ad_status.js` para um stub local com `window.google_ad_status = 1`.
  - Não bloqueia endpoints isca do YouTube (`generate_204`, `jnn-pa`, `pagead/id`), evitando o trigger de aviso de 3 vídeos ou player bloqueado.
  - Fecha automaticamente qualquer modal remanescente de aviso anti-adblock.
- **Interface e Controle Granular**:
  - Popup intuitivo com contador de anúncios bloqueados (total e por aba).
  - Toggles individuais para ativar/desativar bloqueios específicos.

---

## 🚀 Como Instalar (Modo Desenvolvedor)

1. Baixe ou clone esta pasta (`adsenguisher`) no seu computador.
2. Abra seu navegador Chromium e acesse a página de extensões:
   - **Chrome**: `chrome://extensions`
   - **Edge**: `edge://extensions`
   - **Brave**: `brave://extensions`
3. Ative o **Modo do desenvolvedor** (*Developer mode*) no canto superior direito.
4. Clique no botão **Carregar sem compactação** (*Load unpacked*).
5. Selecione a pasta raiz `adsenguisher`.
6. Acesse o [YouTube](https://www.youtube.com) e teste a reprodução de vídeos.

---

## 🧱 Arquitetura em 4 Camadas

```
┌────────────────────────────────────────────────────────┐
│                      NAVEGADOR                         │
├──────────────────────────┬─────────────────────────────┤
│ 1. Camada de Rede (DNR)   │ declarativeNetRequest       │
│    - 20 regras pontuais  │ rules/youtube_ads.json      │
│    - Stub ad_status.js   │ src/injected/ad_status_stub │
├──────────────────────────┼─────────────────────────────┤
│ 2. Interceptador MAIN    │ Execution World: MAIN       │
│    - ytInitialPlayerResp │ src/injected/               │
│    - Hooks fetch/XHR     │   main_interceptor.js       │
│    - Limpeza de JSON     │                             │
├──────────────────────────┼─────────────────────────────┤
│ 3. Ocultação Cosmética   │ CSS Injection               │
│    - Opacity 0 (sem bug) │ src/content/cosmetic.css    │
│    - Feed, search, shorts│                             │
├──────────────────────────┼─────────────────────────────┤
│ 4. Ponte & Automação     │ Execution World: ISOLATED   │
│    - Fast-skip 25ms loop │ src/content/bridge.js       │
│    - Service Worker      │ src/background/             │
│    - Popup interativo    │ src/popup/                  │
└──────────────────────────┴─────────────────────────────┘
```

### 1. Camada de Rede (`rules/youtube_ads.json`)
Utiliza a API nativa `declarativeNetRequest` do Manifest V3 para:
- Redirecionar `static.doubleclick.net/instream/ad_status.js` para um stub que simula anúncio carregado com sucesso, impedindo a detecção anti-adblock.
- Bloquear requisições de telemetria e rastreamento de anúncios (`api/stats/ads`, `pagead/adview`, `pcs/activeview`, `ptracking`, `youtubei/v1/player/ad_break`, etc.) sem derrubar os fluxos normais de streaming de vídeo.

### 2. Interceptação no MAIN World (`src/injected/main_interceptor.js`)
Executado diretamente no contexto da página antes da execução dos scripts do YouTube:
- Intercepta propriedades globais `window.ytInitialPlayerResponse`, `window.ytInitialData` e flags de DAI em `window.ytcfg`.
- Hook transparente em `JSON.parse`, `window.fetch` e `XMLHttpRequest` para remover os nós de anúncios antes que cheguem aos componentes do YouTube.

### 3. Ocultação Cosmética (`src/content/cosmetic.css`)
- Oculta containers visuais de anúncios em tela inicial, barra lateral e resultados de busca.
- Utiliza regras seguras de visibilidade e opacidade para evitar que o motor do player trave botões e elementos interativos.

### 4. Ponte e Fallback no ISOLATED World (`src/content/bridge.js`)
- Conecta as preferências salvas no popup com o interceptador da página via mensagens assíncronas.
- Monitora o DOM com `MutationObserver` e um loop de 25ms: caso qualquer anúncio não catalogado tente ser renderizado, acelera a reprodução para 16x e avança o tempo instantaneamente para o fim do anúncio, clicando nos botões de skip automaticamente.

---

## 📁 Estrutura do Projeto

```
adsenguisher/
├── icons/                      # Ícones da extensão (16, 48, 128 px)
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── rules/                      # Regras de rede Manifest V3
│   └── youtube_ads.json
├── src/
│   ├── background/
│   │   └── service_worker.js   # Gerenciamento de estado e regras dinâmicas
│   ├── content/
│   │   ├── bridge.js           # Ponte de conteúdo e automação DOM
│   │   └── cosmetic.css        # Estilos de ocultação visual
│   ├── injected/
│   │   ├── ad_status_stub.js   # Mock seguro para google_ad_status
│   │   └── main_interceptor.js # Hooks nos objetos globais e APIs de rede
│   └── popup/
│       ├── popup.html          # Interface de usuário
│       ├── popup.css           # Estilos do popup
│       └── popup.js            # Lógica dos controles e contadores
├── manifest.json               # Configuração Manifest V3
└── README.md                   # Documentação do projeto
```

---

## 🛡️ Licença
Distribuído sob licença livre para fins educacionais e uso pessoal.
