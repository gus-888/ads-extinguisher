(() => {
  'use strict';

  if (window.__ADSENGUISHER_MAIN__) return;
  window.__ADSENGUISHER_MAIN__ = true;

  const DEFAULT_CONFIG = {
    enabled: true,
    blockVideoAds: true,
    blockFeedAds: true,
    blockShortsAds: true,
    antiAdblock: true
  };

  let cfg = { ...DEFAULT_CONFIG };
  try {
    const raw = window.localStorage.getItem('__adsenguisher_cfg__');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        cfg = { ...DEFAULT_CONFIG, ...parsed };
      }
    }
  } catch (_) {}

  const stats = {
    prunedCount: 0,
    videoAds: 0,
    feedAds: 0,
    shortsAds: 0,
    antiAdblock: 0,
    interceptedEndpoints: []
  };
  window.__ADSENGUISHER_STATS__ = stats;

  const AD_RENDERER_KEYS = new Set([
    'adSlotRenderer',
    'inFeedAdLayoutRenderer',
    'searchPyvRenderer',
    'promotedSparklesWebRenderer',
    'promotedSparklesTextSearchRenderer',
    'promotedVideoRenderer',
    'compactPromotedItemRenderer',
    'compactPromotedVideoRenderer',
    'displayAdRenderer',
    'videoMastheadAdV3Renderer',
    'mastheadAdRenderer',
    'bannerPromoRenderer',
    'statementBannerRenderer',
    'primetimePromoRenderer',
    'brandVideoShelfRenderer',
    'brandVideoSingletonRenderer',
    'mealbarPromoRenderer',
    'enforcementMessageViewModel',
    'bkaEnforcementMessageViewModel'
  ]);

  const PLAYER_AD_KEYS = [
    'adPlacements',
    'playerAds',
    'adSlots',
    'adBreakHeartbeatParams',
    'adBreakParams',
    'adBreaks',
    'adBreakService',
    'adPlaybackConfig'
  ];

  const DAI_FLAGS = [
    'enable_server_stitched_dai',
    'enable_dai_sdf_h5_preroll',
    'enable_sdf_dai_h5_midroll',
    'html5_server_stitched_dai_group'
  ];

  const TOP_INDICATOR_KEYS = [
    'adPlacements',
    'playerAds',
    'adSlots',
    'adBreakHeartbeatParams',
    'adBreakParams',
    'onResponseReceivedCommands',
    'onResponseReceivedActions',
    'onResponseReceivedEndpoints',
    'auxiliaryUi',
    'contents',
    'entries',
    'playerResponse',
    'raw_player_response',
    'engagementPanels',
    'playabilityStatus',
    'items',
    'response',
    'watchNextResponse',
    'playerOverlays'
  ];

  const API_URL_RE = /\/youtubei\/v1\/(player|next|browse|search|get_watch|reel\/)|\/get_midroll_info/;
  const AD_SHORT_CIRCUIT_RE = /\/youtubei\/v1\/player\/ad_break|\/get_midroll_info/;
  const MAX_DEPTH = 26;

  let bridgeReady = false;
  let reportedCount = 0;

  function flushToBridge(category) {
    if (!bridgeReady) return;
    const delta = stats.prunedCount - reportedCount;
    if (delta <= 0) return;
    reportedCount = stats.prunedCount;
    try {
      window.postMessage({ __adsenguisher: 'blocked', count: delta, category: category || 'general' }, '*');
    } catch (_) {}
  }

  window.addEventListener('message', (ev) => {
    try {
      if (ev.source !== window || !ev.data || typeof ev.data !== 'object') return;
      if (ev.data.__adsenguisher === 'config' && ev.data.payload && typeof ev.data.payload === 'object') {
        cfg = { ...DEFAULT_CONFIG, ...ev.data.payload };
        applyAntiAdblockGlobals();
      } else if (ev.data.__adsenguisher === 'bridge_ready') {
        bridgeReady = true;
        flushToBridge('initial');
      }
    } catch (_) {}
  });

  function reportBlocked(count, category) {
    if (!count || count <= 0) return;
    stats.prunedCount += count;
    if (Object.prototype.hasOwnProperty.call(stats, category)) {
      stats[category] += count;
    }
    flushToBridge(category);
  }

  function recordEndpoint(urlStr) {
    try {
      const parsed = new URL(urlStr, window.location.origin);
      const path = parsed.pathname;
      if (!stats.interceptedEndpoints.includes(path)) {
        if (stats.interceptedEndpoints.length >= 30) {
          stats.interceptedEndpoints.shift();
        }
        stats.interceptedEndpoints.push(path);
      }
    } catch (_) {}
  }

  function applyAntiAdblockGlobals() {
    if (!cfg.enabled || !cfg.antiAdblock) return;
    try {
      window.google_ad_status = 1;
    } catch (_) {}
  }
  applyAntiAdblockGlobals();

  function hasAdRendererKey(obj) {
    if (!obj || typeof obj !== 'object') return false;
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
      if (AD_RENDERER_KEYS.has(keys[i])) return true;
    }
    return false;
  }

  function isShortsAdItem(item) {
    if (!item || typeof item !== 'object') return false;
    if (item.adSlotRenderer) return true;
    const ep = item.reelWatchEndpoint || (item.command && item.command.reelWatchEndpoint);
    if (ep && ep.adClientParams) return true;
    return false;
  }

  function hasEnforcementPopup(action) {
    if (!action || typeof action !== 'object') return false;
    const popup = action.openPopupAction && action.openPopupAction.popup;
    if (!popup || typeof popup !== 'object') return false;
    const dialog = popup.confirmDialogRenderer || popup.mealbarPromoRenderer || popup.dismissableDialogRenderer || popup;
    if (dialog && (dialog.enforcementMessageViewModel || dialog.bkaEnforcementMessageViewModel)) return true;
    const serializedKeys = Object.keys(popup);
    for (let i = 0; i < serializedKeys.length; i++) {
      if (/enforcementMessageViewModel/i.test(serializedKeys[i])) return true;
    }
    return false;
  }

  function isAdEngagementPanel(panel) {
    if (!panel || typeof panel !== 'object') return false;
    const renderer = panel.engagementPanelSectionListRenderer;
    if (!renderer) return false;
    if (renderer.targetId === 'engagement-panel-ads') return true;
    const content = renderer.content;
    if (content && content.adsEngagementPanelContentRenderer) return true;
    return false;
  }

  function stripPlayerAdsOnObject(obj, delta) {
    if (!obj || typeof obj !== 'object') return;
    for (let i = 0; i < PLAYER_AD_KEYS.length; i++) {
      const k = PLAYER_AD_KEYS[i];
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        const val = obj[k];
        const count = Array.isArray(val) ? val.length : (val ? 1 : 0);
        if (count > 0) delta.videoAds += count;
        delete obj[k];
      }
    }
    if (obj.playerConfig && typeof obj.playerConfig === 'object') {
      if (obj.playerConfig.adConfig) {
        delete obj.playerConfig.adConfig;
        delta.videoAds += 1;
      }
      if (obj.playerConfig.daiConfig) {
        delete obj.playerConfig.daiConfig;
        delta.videoAds += 1;
      }
    }
  }

  function stripAntiAdblockOnObject(obj, delta) {
    if (!obj || typeof obj !== 'object') return;

    if (obj.auxiliaryUi && obj.auxiliaryUi.messageRenderers && typeof obj.auxiliaryUi.messageRenderers === 'object') {
      const mr = obj.auxiliaryUi.messageRenderers;
      if (mr.bkaEnforcementMessageViewModel) {
        delete mr.bkaEnforcementMessageViewModel;
        delta.antiAdblock += 1;
      }
      if (mr.enforcementMessageViewModel) {
        delete mr.enforcementMessageViewModel;
        delta.antiAdblock += 1;
      }
    }

    const errScreen = obj.playabilityStatus && obj.playabilityStatus.errorScreen;
    if (errScreen && typeof errScreen === 'object') {
      const pem = errScreen.playerErrorMessageRenderer;
      if (pem && (pem.bkaEnforcementMessageViewModel || pem.enforcementMessageViewModel ||
          (pem.subreason && JSON.stringify(pem).includes('enforcement')))) {
        delete errScreen.playerErrorMessageRenderer;
        delta.antiAdblock += 1;
      }
    }

    for (const actionKey of ['onResponseReceivedActions', 'onResponseReceivedEndpoints']) {
      if (Array.isArray(obj[actionKey])) {
        const before = obj[actionKey].length;
        obj[actionKey] = obj[actionKey].filter((item) => !hasEnforcementPopup(item));
        const diff = before - obj[actionKey].length;
        if (diff > 0) delta.antiAdblock += diff;
      }
    }
  }

  function shouldDropFeedItem(item) {
    if (!item || typeof item !== 'object') return false;
    if (hasAdRendererKey(item)) return true;
    if (item.richItemRenderer && hasAdRendererKey(item.richItemRenderer.content)) return true;
    if (item.richSectionRenderer && hasAdRendererKey(item.richSectionRenderer.content)) return true;
    return false;
  }

  function pruneNode(node, seen, depth, delta) {
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      let writeIdx = 0;
      for (let i = 0; i < node.length; i++) {
        const item = node[i];
        if (cfg.blockShortsAds && isShortsAdItem(item)) {
          delta.shortsAds += 1;
          continue;
        }
        if (cfg.blockFeedAds && shouldDropFeedItem(item)) {
          delta.feedAds += 1;
          continue;
        }
        if (cfg.blockFeedAds && item && typeof item === 'object' && item.itemSectionRenderer && Array.isArray(item.itemSectionRenderer.contents)) {
          const prevFeed = delta.feedAds;
          pruneNode(item.itemSectionRenderer.contents, seen, depth + 1, delta);
          if (item.itemSectionRenderer.contents.length === 0 && delta.feedAds > prevFeed) {
            continue;
          }
          pruneNode(item.itemSectionRenderer, seen, depth + 1, delta);
          node[writeIdx++] = item;
          continue;
        }
        pruneNode(item, seen, depth + 1, delta);
        node[writeIdx++] = item;
      }
      node.length = writeIdx;
      return;
    }

    if (cfg.blockVideoAds) {
      stripPlayerAdsOnObject(node, delta);
      if (node.playerResponse && typeof node.playerResponse === 'object') {
        stripPlayerAdsOnObject(node.playerResponse, delta);
      }
      if (node.raw_player_response && typeof node.raw_player_response === 'object') {
        stripPlayerAdsOnObject(node.raw_player_response, delta);
      }
    }

    if (cfg.antiAdblock) {
      stripAntiAdblockOnObject(node, delta);
    }

    if (cfg.blockFeedAds) {
      if (Array.isArray(node.onResponseReceivedCommands)) {
        const before = node.onResponseReceivedCommands.length;
        node.onResponseReceivedCommands = node.onResponseReceivedCommands.filter(
          (cmd) => !(cmd && cmd.adsControlFlowOpportunityReceivedCommand)
        );
        const diff = before - node.onResponseReceivedCommands.length;
        if (diff > 0) delta.feedAds += diff;
      }
      if (Array.isArray(node.engagementPanels)) {
        const before = node.engagementPanels.length;
        node.engagementPanels = node.engagementPanels.filter((p) => !isAdEngagementPanel(p));
        const diff = before - node.engagementPanels.length;
        if (diff > 0) delta.feedAds += diff;
      }
    }

    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (cfg.blockFeedAds && AD_RENDERER_KEYS.has(k)) {
        delete node[k];
        delta.feedAds += 1;
        continue;
      }
      const val = node[k];
      if (val && typeof val === 'object') {
        pruneNode(val, seen, depth + 1, delta);
      }
    }
  }

  function prunePayload(root) {
    if (!cfg.enabled || !root || typeof root !== 'object') return root;
    const delta = { videoAds: 0, feedAds: 0, shortsAds: 0, antiAdblock: 0 };
    try {
      applyAntiAdblockGlobals();
      pruneNode(root, new WeakSet(), 0, delta);
      if (delta.videoAds > 0) reportBlocked(delta.videoAds, 'videoAds');
      if (delta.feedAds > 0) reportBlocked(delta.feedAds, 'feedAds');
      if (delta.shortsAds > 0) reportBlocked(delta.shortsAds, 'shortsAds');
      if (delta.antiAdblock > 0) reportBlocked(delta.antiAdblock, 'antiAdblock');
    } catch (_) {}
    return root;
  }

  function hasTopIndicator(obj) {
    if (!obj || typeof obj !== 'object') return false;
    for (let i = 0; i < TOP_INDICATOR_KEYS.length; i++) {
      if (Object.prototype.hasOwnProperty.call(obj, TOP_INDICATOR_KEYS[i])) return true;
    }
    return false;
  }

  function shouldPruneParsed(val) {
    if (!val || typeof val !== 'object') return false;
    if (!Array.isArray(val)) return hasTopIndicator(val);
    if (val.length === 0 || val.length > 25) return false;
    for (let i = 0; i < val.length; i++) {
      if (val[i] && typeof val[i] === 'object' && hasTopIndicator(val[i])) return true;
    }
    return false;
  }

  function trapWindowObjectProperty(propName) {
    try {
      let current = window[propName];
      if (current && typeof current === 'object') {
        prunePayload(current);
      }
      const desc = Object.getOwnPropertyDescriptor(window, propName);
      if (desc && desc.configurable === false) return;
      Object.defineProperty(window, propName, {
        configurable: true,
        enumerable: true,
        get() {
          return current;
        },
        set(val) {
          if (val && typeof val === 'object') {
            current = prunePayload(val);
          } else {
            current = val;
          }
        }
      });
    } catch (_) {}
  }

  function patchExperimentFlags(dataObj) {
    if (!cfg.enabled || !cfg.blockVideoAds || !dataObj || typeof dataObj !== 'object') return;
    const flags = dataObj.EXPERIMENT_FLAGS || (dataObj.data_ && dataObj.data_.EXPERIMENT_FLAGS);
    if (flags && typeof flags === 'object') {
      for (let i = 0; i < DAI_FLAGS.length; i++) {
        if (DAI_FLAGS[i] in flags) {
          flags[DAI_FLAGS[i]] = false;
        }
      }
    }
  }

  function wrapYtcfg(ytcfgObj) {
    if (!ytcfgObj || typeof ytcfgObj !== 'object') return ytcfgObj;
    try {
      patchExperimentFlags(ytcfgObj);
      if (typeof ytcfgObj.set === 'function' && !ytcfgObj.set.__adsenguisherWrapped) {
        const origSet = ytcfgObj.set;
        const wrappedSet = function (...args) {
          try {
            if (args.length === 1 && args[0] && typeof args[0] === 'object') {
              patchExperimentFlags(args[0]);
            } else if (args[0] === 'EXPERIMENT_FLAGS' && args[1] && typeof args[1] === 'object') {
              for (let i = 0; i < DAI_FLAGS.length; i++) {
                if (DAI_FLAGS[i] in args[1]) args[1][DAI_FLAGS[i]] = false;
              }
            }
          } catch (_) {}
          const res = origSet.apply(this, args);
          try {
            patchExperimentFlags(ytcfgObj);
          } catch (_) {}
          return res;
        };
        wrappedSet.__adsenguisherWrapped = true;
        ytcfgObj.set = wrappedSet;
      }
    } catch (_) {}
    return ytcfgObj;
  }

  function trapYtcfg() {
    try {
      let current = window.ytcfg;
      if (current) wrapYtcfg(current);
      const desc = Object.getOwnPropertyDescriptor(window, 'ytcfg');
      if (desc && desc.configurable === false) return;
      Object.defineProperty(window, 'ytcfg', {
        configurable: true,
        enumerable: true,
        get() {
          return current;
        },
        set(val) {
          current = wrapYtcfg(val);
        }
      });
    } catch (_) {}
  }

  trapWindowObjectProperty('ytInitialPlayerResponse');
  trapWindowObjectProperty('ytInitialData');
  trapYtcfg();

  // JSON.parse wrapper
  try {
    const origParse = JSON.parse;
    if (typeof origParse === 'function' && !origParse.__adsenguisherWrapped) {
      const wrappedParse = function (text, reviver) {
        const parsed = origParse.call(this, text, reviver);
        try {
          if (cfg.enabled && shouldPruneParsed(parsed)) {
            prunePayload(parsed);
          }
        } catch (_) {}
        return parsed;
      };
      wrappedParse.__adsenguisherWrapped = true;
      JSON.parse = wrappedParse;
    }
  } catch (_) {}

  // fetch wrapper
  try {
    const origFetch = window.fetch;
    if (typeof origFetch === 'function' && !origFetch.__adsenguisherWrapped) {
      const wrappedFetch = async function (input, init) {
        const urlStr = typeof input === 'string'
          ? input
          : (input && typeof input.url === 'string' ? input.url : '');

        if (cfg.enabled && cfg.blockVideoAds && urlStr && AD_SHORT_CIRCUIT_RE.test(urlStr)) {
          recordEndpoint(urlStr);
          reportBlocked(1, 'videoAds');
          return new Response('{}', {
            status: 200,
            statusText: 'OK',
            headers: { 'Content-Type': 'application/json; charset=UTF-8' }
          });
        }

        const res = await origFetch.apply(this, arguments);
        if (!cfg.enabled || !urlStr || !API_URL_RE.test(urlStr)) {
          return res;
        }

        recordEndpoint(urlStr);

        try {
          const clone = res.clone();
          const text = await clone.text();
          if (!text) return res;
          const cleanText = text.startsWith(")]}'") ? text.slice(text.indexOf('\n') + 1) : text;
          const data = JSON.parse(cleanText);
          if (!data || typeof data !== 'object') return res;

          prunePayload(data);
          const headers = new Headers(res.headers);
          headers.delete('content-length');
          headers.delete('content-encoding');
          if (!headers.has('content-type')) {
            headers.set('content-type', 'application/json; charset=UTF-8');
          }
          return new Response(JSON.stringify(data), {
            status: res.status,
            statusText: res.statusText,
            headers
          });
        } catch (_) {
          return res;
        }
      };
      wrappedFetch.__adsenguisherWrapped = true;
      window.fetch = wrappedFetch;
    }
  } catch (_) {}

  // Response.prototype.json wrapper
  try {
    const ResProto = window.Response && window.Response.prototype;
    if (ResProto && typeof ResProto.json === 'function' && !ResProto.json.__adsenguisherWrapped) {
      const origResJson = ResProto.json;
      const wrappedResJson = async function () {
        const val = await origResJson.apply(this, arguments);
        try {
          if (cfg.enabled && shouldPruneParsed(val)) {
            prunePayload(val);
          }
        } catch (_) {}
        return val;
      };
      wrappedResJson.__adsenguisherWrapped = true;
      ResProto.json = wrappedResJson;
    }
  } catch (_) {}

  // XMLHttpRequest wrapper
  try {
    const XHRProto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (XHRProto && !XHRProto.open.__adsenguisherWrapped) {
      const origOpen = XHRProto.open;
      const origSend = XHRProto.send;
      const respTextDesc = Object.getOwnPropertyDescriptor(XHRProto, 'responseText');
      const respDesc = Object.getOwnPropertyDescriptor(XHRProto, 'response');

      XHRProto.open = function (method, url) {
        try {
          this.__adsenguisherUrl = typeof url === 'string' ? url : String(url || '');
        } catch (_) {}
        return origOpen.apply(this, arguments);
      };
      XHRProto.open.__adsenguisherWrapped = true;

      XHRProto.send = function () {
        const xhrUrl = this.__adsenguisherUrl || '';
        if (cfg.enabled && xhrUrl && API_URL_RE.test(xhrUrl)) {
          recordEndpoint(xhrUrl);
          if (!this.__adsenguisherHooked && respTextDesc && respDesc) {
            this.__adsenguisherHooked = true;
            let cachedText = null;
            let cachedObj = null;
            let processed = false;

            const processXhr = (instance) => {
              if (processed || instance.readyState !== 4) return;
              processed = true;
              try {
                const rawText = respTextDesc.get.call(instance);
                if (!rawText || typeof rawText !== 'string') return;
                const clean = rawText.startsWith(")]}'") ? rawText.slice(rawText.indexOf('\n') + 1) : rawText;
                const parsed = JSON.parse(clean);
                if (parsed && typeof parsed === 'object') {
                  prunePayload(parsed);
                  cachedObj = parsed;
                  cachedText = JSON.stringify(parsed);
                }
              } catch (_) {}
            };

            Object.defineProperty(this, 'responseText', {
              configurable: true,
              get() {
                processXhr(this);
                return cachedText !== null ? cachedText : respTextDesc.get.call(this);
              }
            });

            Object.defineProperty(this, 'response', {
              configurable: true,
              get() {
                processXhr(this);
                if (this.responseType === 'json' && cachedObj !== null) return cachedObj;
                if ((!this.responseType || this.responseType === 'text') && cachedText !== null) return cachedText;
                return respDesc.get.call(this);
              }
            });
          }
        }
        return origSend.apply(this, arguments);
      };
    }
  } catch (_) {}
})();
