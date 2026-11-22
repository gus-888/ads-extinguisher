(() => {
  'use strict';

  const RULESET_ID = 'youtube_ads';
  const DEFAULT_SETTINGS = {
    enabled: true,
    blockVideoAds: true,
    blockFeedAds: true,
    blockShortsAds: true,
    antiAdblock: true
  };

  let memoryTabCounts = {};
  let opQueue = Promise.resolve();

  function serialized(fn) {
    const next = opQueue.then(fn, fn);
    opQueue = next.catch(() => {});
    return next;
  }

  function isYouTubeUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return /^https?:\/\/([^/]+\.)?(youtube\.com|youtube-nocookie\.com)\//i.test(url);
  }

  function formatBadgeCount(n) {
    if (!n || n <= 0) return '';
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    if (n > 99) return '99+';
    return String(n);
  }

  async function getTabCounts() {
    if (chrome.storage.session) {
      try {
        const res = await chrome.storage.session.get(['tabCounts']);
        return res.tabCounts || {};
      } catch (_) {}
    }
    return memoryTabCounts;
  }

  async function saveTabCounts(tabCounts) {
    memoryTabCounts = tabCounts;
    if (chrome.storage.session) {
      try {
        await chrome.storage.session.set({ tabCounts });
      } catch (_) {}
    }
  }

  async function getSettings() {
    const res = await chrome.storage.local.get(['settings']);
    return { ...DEFAULT_SETTINGS, ...(res.settings || {}) };
  }

  async function syncRuleset(enabled) {
    try {
      if (enabled) {
        await chrome.declarativeNetRequest.updateEnabledRulesets({
          enableRulesetIds: [RULESET_ID]
        });
      } else {
        await chrome.declarativeNetRequest.updateEnabledRulesets({
          disableRulesetIds: [RULESET_ID]
        });
      }
    } catch (_) {}
  }

  async function updateBadge(tabId, count, enabled) {
    if (typeof tabId !== 'number' || tabId < 0) return;
    try {
      if (!enabled) {
        await chrome.action.setBadgeText({ tabId, text: 'OFF' });
        await chrome.action.setBadgeBackgroundColor({ tabId, color: '#64748b' });
      } else {
        await chrome.action.setBadgeText({ tabId, text: formatBadgeCount(count) });
        await chrome.action.setBadgeBackgroundColor({ tabId, color: '#e11d48' });
      }
    } catch (_) {}
  }

  async function refreshAllYouTubeBadges(enabled) {
    try {
      const tabs = await chrome.tabs.query({});
      const counts = await getTabCounts();
      for (const tab of tabs) {
        if (tab.id != null && isYouTubeUrl(tab.url)) {
          await updateBadge(tab.id, counts[String(tab.id)] || 0, enabled);
        }
      }
    } catch (_) {}
  }

  async function ensureDefaults() {
    const res = await chrome.storage.local.get(['settings', 'totalBlocked']);
    const settings = { ...DEFAULT_SETTINGS, ...(res.settings || {}) };
    const updates = {};
    if (!res.settings) updates.settings = settings;
    if (typeof res.totalBlocked !== 'number') updates.totalBlocked = 0;
    if (Object.keys(updates).length > 0) {
      await chrome.storage.local.set(updates);
    }
    await syncRuleset(settings.enabled);
    await refreshAllYouTubeBadges(settings.enabled);
  }

  chrome.runtime.onInstalled.addListener(() => {
    void serialized(ensureDefaults);
  });

  chrome.runtime.onStartup.addListener(() => {
    void serialized(ensureDefaults);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'loading') return;
    void serialized(async () => {
      const counts = await getTabCounts();
      counts[String(tabId)] = 0;
      await saveTabCounts(counts);
      const settings = await getSettings();
      if (isYouTubeUrl(tab?.url || changeInfo.url)) {
        await updateBadge(tabId, 0, settings.enabled);
      } else {
        await updateBadge(tabId, 0, true);
      }
    });
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void serialized(async () => {
      const counts = await getTabCounts();
      if (Object.prototype.hasOwnProperty.call(counts, String(tabId))) {
        delete counts[String(tabId)];
        await saveTabCounts(counts);
      }
    });
  });

  async function handleMessage(msg, sender) {
    if (!msg || typeof msg !== 'object') return { ok: false };

    if (msg.type === 'REPORT_BLOCKED') {
      return serialized(async () => {
        const count = Math.max(1, Number(msg.count) || 1);
        const tabId = sender?.tab?.id;
        const settings = await getSettings();
        const localRes = await chrome.storage.local.get(['totalBlocked']);
        const nextTotal = (Number(localRes.totalBlocked) || 0) + count;
        await chrome.storage.local.set({ totalBlocked: nextTotal });

        let tabCount = 0;
        if (typeof tabId === 'number' && tabId >= 0) {
          const counts = await getTabCounts();
          tabCount = (Number(counts[String(tabId)]) || 0) + count;
          counts[String(tabId)] = tabCount;
          await saveTabCounts(counts);
          await updateBadge(tabId, tabCount, settings.enabled);
        }
        return { ok: true, tabBlocked: tabCount, totalBlocked: nextTotal };
      });
    }

    if (msg.type === 'GET_STATE') {
      const settings = await getSettings();
      const localRes = await chrome.storage.local.get(['totalBlocked']);
      const totalBlocked = Number(localRes.totalBlocked) || 0;
      let tabId = typeof msg.tabId === 'number' ? msg.tabId : null;
      let tabUrl = '';
      if (tabId === null) {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = activeTab?.id ?? null;
        tabUrl = activeTab?.url || '';
      } else {
        try {
          const t = await chrome.tabs.get(tabId);
          tabUrl = t?.url || '';
        } catch (_) {}
      }
      const counts = await getTabCounts();
      const tabBlocked = tabId !== null ? (Number(counts[String(tabId)]) || 0) : 0;
      return {
        ok: true,
        settings,
        tabBlocked,
        totalBlocked,
        tabId,
        isYouTubeTab: isYouTubeUrl(tabUrl)
      };
    }

    if (msg.type === 'UPDATE_SETTINGS') {
      return serialized(async () => {
        const current = await getSettings();
        const next = { ...current, ...(msg.settings || {}) };
        await chrome.storage.local.set({ settings: next });
        await syncRuleset(next.enabled);
        await refreshAllYouTubeBadges(next.enabled);
        return { ok: true, settings: next };
      });
    }

    if (msg.type === 'RESET_STATS') {
      return serialized(async () => {
        await chrome.storage.local.set({ totalBlocked: 0 });
        const counts = await getTabCounts();
        const tabId = typeof msg.tabId === 'number' ? msg.tabId : null;
        if (tabId !== null) {
          counts[String(tabId)] = 0;
          await saveTabCounts(counts);
          const settings = await getSettings();
          await updateBadge(tabId, 0, settings.enabled);
        } else {
          await saveTabCounts({});
          const settings = await getSettings();
          await refreshAllYouTubeBadges(settings.enabled);
        }
        return { ok: true, tabBlocked: 0, totalBlocked: 0 };
      });
    }

    return { ok: false };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    handleMessage(msg, sender)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  });
})();
