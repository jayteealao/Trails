// @ts-check
import { el } from '../el.js';
import { state, CONFIG, timers } from '../state.js';
import { fetchRequests } from '../api.js';
import { escapeHtml, truncateUrl, formatTimeFeedLine, getDomain } from '../utils.js';
import { statusBadgeHtml } from '../components.js';
import { updateFeedBadge } from '../router.js';

export function renderFeed() {
  if (state.feed.items.length === 0) {
    el.feedContainer.innerHTML = '<div class="empty-state">Waiting for requests</div>';
    return;
  }

  el.feedContainer.innerHTML = state.feed.items.map(item => {
    const stage = item.stage || 'queued';
    const domain = item.domain || getDomain(item.url);
    const isNew = item._new;
    return `
      <div class="feed-line ${isNew ? 'feed-new' : ''}" data-id="${escapeHtml(item.requestId)}">
        <span class="feed-time">${formatTimeFeedLine(item.createdAt)}</span>
        <span class="feed-id">${escapeHtml(item.requestId.slice(0, 8))}</span>
        <span class="feed-status">${statusBadgeHtml(stage)}</span>
        <span class="feed-domain">${escapeHtml(domain)}</span>
        <span class="feed-url">${escapeHtml(truncateUrl(item.url, 80))}</span>
      </div>
    `;
  }).join('');

  el.feedContainer.querySelectorAll('.feed-line').forEach(line => {
    line.addEventListener('click', () => {
      import('./detail.js').then(m => m.loadRequestDetail(line.dataset.id));
    });
  });

  el.feedCount.textContent = `${state.feed.items.length} requests`;
}

async function pollFeed() {
  try {
    const data = await fetchRequests({ domain: '', status: '' }, { offset: 0 });
    const requests = data.requests || [];

    let newItems = 0;
    for (const req of requests) {
      if (!state.feed.knownIds.has(req.requestId)) {
        state.feed.knownIds.add(req.requestId);
        state.feed.items.unshift({ ...req, _new: true });
        newItems++;
      } else {
        const existing = state.feed.items.find(i => i.requestId === req.requestId);
        if (existing) {
          existing.stage = req.stage;
          existing.errorCount = req.errorCount;
        }
      }
    }

    if (state.feed.items.length > CONFIG.feedMaxItems) {
      const removed = state.feed.items.splice(CONFIG.feedMaxItems);
      for (const r of removed) {
        state.feed.knownIds.delete(r.requestId);
      }
    }

    if (newItems > 0) {
      state.feed.newCount += newItems;
      updateFeedBadge();
      if (state.currentView === 'feed') {
        state.feed.newCount = 0;
        updateFeedBadge();
        renderFeed();
      }
    } else if (state.currentView === 'feed') {
      renderFeed();
    }

    setTimeout(() => {
      for (const item of state.feed.items) {
        item._new = false;
      }
    }, 1200);

    el.connDot.classList.remove('disconnected');
    el.connLabel.textContent = 'Connected';
  } catch {
    el.connDot.classList.add('disconnected');
    el.connLabel.textContent = 'Disconnected';
  }
}

export function startFeedPolling() {
  if (timers.feed) return;
  state.feed.polling = true;
  pollFeed();
  timers.feed = setInterval(pollFeed, CONFIG.feedPollInterval);
}

export function stopFeedPolling() {
  if (timers.feed) {
    clearInterval(timers.feed);
    timers.feed = null;
  }
  state.feed.polling = false;
}
