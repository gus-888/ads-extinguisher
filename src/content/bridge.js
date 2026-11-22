(() => {
  'use strict';

  if (window.__ADSENGUISHER_BRIDGE__) return;
  window.__ADSENGUISHER_BRIDGE__ = true;

  const DEFAULT_SETTINGS = {
    enabled: true,
    blockVideoAds: true,
    blockFeedAds: true,
    blockShortsAds: true,
    antiAdblock: true
  };

  let cfg = { ...DEFAULT_SETTINGS };
  let pendingQueue = [];
  let flushTimer = null;

  let savedPlayerState = null;
  let inAdBreak = false;

  const SKIP_SELECTOR = [
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.videoAdUiSkipButton',
    '.ytp-ad-overlay-close-button',
    '.ytp-skip-ad',
    'button[id^="skip-button"]',
    '.ytp-ad-skip-button-container',
    '.ytp-ad-skip-button-slot'
  ].join(', ');

  const COSMETIC_COUNT_SELECTOR = [
    'ytd-ad-slot-renderer',
    'ytd-in-feed-ad-layout-renderer',
    'ytd-search-pyv-renderer',
    'ytd-promoted-sparkles-web-renderer',
    'ytd-banner-promo-renderer'
  ].join(', ');

  function applyConfigToDomAndMain(nextCfg) {
    cfg = { ...DEFAULT_SETTINGS, ...(nextCfg || {}) };
    const root = document.documentElement;
    if (root) {
      root.dataset.adsenguisherDisabled = cfg.enabled ? '0' : '1';
      root.dataset.adsenguisherVideo = cfg.blockVideoAds ? '1' : '0';
      root.dataset.adsenguisherFeed = cfg.blockFeedAds ? '1' : '0';
      root.dataset.adsenguisherShorts = cfg.blockShortsAds ? '1' : '0';
      root.dataset.adsenguisherAnti = cfg.antiAdblock ? '1' : '0';
    }
    try {
      window.localStorage.setItem('__adsenguisher_cfg__', JSON.stringify(cfg));
    } catch (_) {}
    try {
      window.postMessage({ __adsenguisher: 'config', payload: cfg }, '*');
    } catch (_) {}
  }

  function flushBlockedQueue() {
    flushTimer = null;
    if (!pendingQueue.length) return;
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
      pendingQueue = [];
      return;
    }

    let totalCount = 0;
    for (let i = 0; i < pendingQueue.length; i++) {
      totalCount += pendingQueue[i].count;
    }
    pendingQueue = [];

    if (totalCount > 0) {
      try {
        chrome.runtime.sendMessage({ type: 'REPORT_BLOCKED', count: totalCount }, () => {
          void chrome.runtime?.lastError;
        });
      } catch (_) {}
    }
  }

  function queueBlocked(count, category) {
    if (!count || count <= 0) return;
    pendingQueue.push({ count, category: category || 'general' });
    if (!flushTimer) {
      flushTimer = window.setTimeout(flushBlockedQueue, 250);
    }
  }

  // Receive MAIN world events via postMessage
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || typeof ev.data !== 'object') return;
    if (ev.data.__adsenguisher !== 'blocked') return;
    queueBlocked(Number(ev.data.count) || 1, ev.data.category || 'general');
  });
  try {
    window.postMessage({ __adsenguisher: 'bridge_ready' }, '*');
  } catch (_) {}

  // Ensure dataset attributes exist if documentElement appeared slightly later
  document.addEventListener('DOMContentLoaded', () => {
    applyConfigToDomAndMain(cfg);
  }, { once: true });

  // Load initial settings
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try {
      chrome.storage.local.get(['settings'], (res) => {
        if (chrome.runtime?.lastError) return;
        applyConfigToDomAndMain(res && res.settings ? res.settings : DEFAULT_SETTINGS);
      });

      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes.settings) return;
        applyConfigToDomAndMain(changes.settings.newValue);
        scheduleSweep();
      });
    } catch (_) {
      applyConfigToDomAndMain(DEFAULT_SETTINGS);
    }
  } else {
    applyConfigToDomAndMain(DEFAULT_SETTINGS);
  }

  function clickSkipButtons(player) {
    const buttons = player.querySelectorAll(SKIP_SELECTOR);
    for (let i = 0; i < buttons.length; i++) {
      try {
        buttons[i].click();
      } catch (_) {}
    }
  }

  let adSkipActive = false;
  let adSkipTimer = null;

  function runInstantAdSkip() {
    const player = document.querySelector('#movie_player');
    if (!player) return false;
    const isAdShowing = cfg.enabled && cfg.blockVideoAds &&
      (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'));

    const video = player.querySelector('video');
    if (isAdShowing) {
      if (!inAdBreak) {
        inAdBreak = true;
        savedPlayerState = video
          ? { muted: video.muted, playbackRate: video.playbackRate }
          : null;
      }

      if (video) {
        try {
          video.muted = true;
          video.playbackRate = 16;
          if (Number.isFinite(video.duration) && video.duration > 0) {
            video.currentTime = video.duration;
          } else {
            video.currentTime = 99999;
          }
        } catch (_) {}
      }
      clickSkipButtons(player);
      return true;
    }

    if (inAdBreak) {
      inAdBreak = false;
      if (video && savedPlayerState) {
        try {
          video.muted = savedPlayerState.muted;
          video.playbackRate = savedPlayerState.playbackRate || 1;
        } catch (_) {}
      }
      savedPlayerState = null;
      queueBlocked(1, 'videoAds');
    }
    return false;
  }

  function handlePlayerAdFallback() {
    const inAd = runInstantAdSkip();
    if (inAd && !adSkipActive) {
      adSkipActive = true;
      const poll = () => {
        const stillInAd = runInstantAdSkip();
        if (stillInAd) {
          adSkipTimer = setTimeout(poll, 25);
        } else {
          adSkipActive = false;
          adSkipTimer = null;
        }
      };
      adSkipTimer = setTimeout(poll, 25);
    }
  }

  function handleAntiAdblockFallback() {
    if (!cfg.enabled || !cfg.antiAdblock) return;
    const dialogs = document.querySelectorAll('tp-yt-paper-dialog');
    for (let i = 0; i < dialogs.length; i++) {
      const dialog = dialogs[i];
      if (!dialog.querySelector('ytd-enforcement-message-view-model')) continue;

      try {
        dialog.remove();
        const backdrops = document.querySelectorAll('tp-yt-iron-overlay-backdrop');
        for (let j = 0; j < backdrops.length; j++) {
          backdrops[j].remove();
        }
        if (document.documentElement.style.overflow === 'hidden') {
          document.documentElement.style.overflow = '';
        }
        if (document.body && document.body.style.overflow === 'hidden') {
          document.body.style.overflow = '';
        }
        const video = document.querySelector('#movie_player video');
        if (video && video.paused) {
          video.play().catch(() => {});
        }
        queueBlocked(1, 'antiAdblock');
      } catch (_) {}
    }
  }

  function handleShortsAdFallback() {
    if (!cfg.enabled || !cfg.blockShortsAds) return;
    if (!window.location.pathname.startsWith('/shorts')) return;

    const activeRenderer = document.querySelector('ytd-reel-video-renderer[is-active]');
    if (!activeRenderer || activeRenderer.dataset.adsenguisherSkipped === '1') return;

    const isAd = activeRenderer.hasAttribute('is-ads-overlay') ||
      !!activeRenderer.querySelector('ytd-ad-slot-renderer, ad-badge-view-model, ad-button-view-model');

    if (isAd) {
      activeRenderer.dataset.adsenguisherSkipped = '1';
      const downBtn = document.querySelector('#navigation-button-down button');
      if (downBtn) {
        try {
          downBtn.click();
          queueBlocked(1, 'shortsAds');
        } catch (_) {}
      }
    }
  }

  function countCosmeticAdNodes() {
    if (!cfg.enabled || !cfg.blockFeedAds) return;
    const nodes = document.querySelectorAll(COSMETIC_COUNT_SELECTOR);
    let newlyHidden = 0;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.dataset.adsenguisherCounted !== '1') {
        node.dataset.adsenguisherCounted = '1';
        newlyHidden++;
      }
    }
    if (newlyHidden > 0) {
      queueBlocked(newlyHidden, 'feedAds');
    }
  }

  function runSweep() {
    sweepScheduled = false;
    handlePlayerAdFallback();
    handleAntiAdblockFallback();
    handleShortsAdFallback();
    countCosmeticAdNodes();
  }

  let sweepScheduled = false;
  function scheduleSweep() {
    if (sweepScheduled) return;
    sweepScheduled = true;
    window.requestAnimationFrame(runSweep);
  }

  const observer = new MutationObserver((mutations) => {
    for (let i = 0; i < mutations.length; i++) {
      const m = mutations[i];
      if (m.type === 'attributes') {
        if (m.target && m.target.id === 'movie_player') {
          scheduleSweep();
          return;
        }
        if (m.target && m.target.tagName && m.target.tagName.toLowerCase() === 'ytd-reel-video-renderer') {
          scheduleSweep();
          return;
        }
      } else if (m.addedNodes && m.addedNodes.length > 0) {
        scheduleSweep();
        return;
      }
    }
  });

  function startObserver() {
    const target = document.documentElement || document.body;
    if (!target) return;
    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'is-active', 'is-ads-overlay']
    });
    scheduleSweep();
  }

  if (document.documentElement) {
    startObserver();
  } else {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  }

  window.addEventListener('yt-navigate-finish', scheduleSweep);
})();
