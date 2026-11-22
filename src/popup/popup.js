(() => {
  'use strict';

  const elEnabled = document.getElementById('toggle-enabled');
  const elVideo = document.getElementById('toggle-video');
  const elFeed = document.getElementById('toggle-feed');
  const elShorts = document.getElementById('toggle-shorts');
  const elAnti = document.getElementById('toggle-anti');
  const elStatusPill = document.getElementById('status-pill');
  const elTabBlocked = document.getElementById('tab-blocked');
  const elTotalBlocked = document.getElementById('total-blocked');
  const elFeaturesPanel = document.getElementById('features-panel');
  const elBtnReset = document.getElementById('btn-reset');
  const elBtnReload = document.getElementById('btn-reload');

  let currentTabId = null;

  function formatNumber(n) {
    return Number(n || 0).toLocaleString('pt-BR');
  }

  function renderState(state) {
    if (!state || !state.ok) return;
    const s = state.settings || {};
    currentTabId = state.tabId ?? null;

    const enabled = s.enabled !== false;
    elEnabled.checked = enabled;
    elVideo.checked = s.blockVideoAds !== false;
    elFeed.checked = s.blockFeedAds !== false;
    elShorts.checked = s.blockShortsAds !== false;
    elAnti.checked = s.antiAdblock !== false;

    elStatusPill.textContent = enabled ? 'Ativo' : 'Pausado';
    elStatusPill.className = `pill ${enabled ? 'pill-active' : 'pill-paused'}`;
    elFeaturesPanel.classList.toggle('dimmed', !enabled);

    elTabBlocked.textContent = formatNumber(state.tabBlocked);
    elTotalBlocked.textContent = formatNumber(state.totalBlocked);
    elBtnReload.disabled = !state.isYouTubeTab || currentTabId === null;
  }

  function sendMsg(payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(payload, (res) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(res);
      });
    });
  }

  async function syncSettings() {
    const settings = {
      enabled: elEnabled.checked,
      blockVideoAds: elVideo.checked,
      blockFeedAds: elFeed.checked,
      blockShortsAds: elShorts.checked,
      antiAdblock: elAnti.checked
    };
    elStatusPill.textContent = settings.enabled ? 'Ativo' : 'Pausado';
    elStatusPill.className = `pill ${settings.enabled ? 'pill-active' : 'pill-paused'}`;
    elFeaturesPanel.classList.toggle('dimmed', !settings.enabled);
    await sendMsg({ type: 'UPDATE_SETTINGS', settings });
  }

  [elEnabled, elVideo, elFeed, elShorts, elAnti].forEach((input) => {
    input.addEventListener('change', () => {
      void syncSettings();
    });
  });

  elBtnReset.addEventListener('click', async () => {
    const res = await sendMsg({ type: 'RESET_STATS', tabId: currentTabId });
    if (res && res.ok) {
      elTabBlocked.textContent = '0';
      elTotalBlocked.textContent = '0';
    }
  });

  elBtnReload.addEventListener('click', () => {
    if (currentTabId === null) return;
    chrome.tabs.reload(currentTabId, () => {
      window.close();
    });
  });

  document.addEventListener('DOMContentLoaded', async () => {
    const state = await sendMsg({ type: 'GET_STATE' });
    renderState(state);
  });
})();
