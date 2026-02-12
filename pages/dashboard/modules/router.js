// @ts-check
import { el } from './el.js';
import { state, VIEW_TITLES, timers, CONFIG } from './state.js';

/** @type {(() => void) | null} */
let onFeedStart = null;
/** @type {(() => void) | null} */
let onFeedStop = null;
/** @type {(() => void) | null} */
let onDetailLeave = null;

/**
 * Register callbacks for feed polling lifecycle.
 * Called once from init to break the circular dependency
 * (router doesn't import feed.js directly).
 */
export function registerFeedCallbacks(start, stop) {
  onFeedStart = start;
  onFeedStop = stop;
}

/** Register callback for when user navigates away from detail view. */
export function registerDetailLeaveCallback(fn) {
  onDetailLeave = fn;
}

export function showView(viewName) {
  if (state.currentView !== viewName) {
    state.previousView = state.currentView;
  }
  state.currentView = viewName;

  el.overviewView.classList.toggle('hidden', viewName !== 'overview');
  el.requestsView.classList.toggle('hidden', viewName !== 'requests');
  el.detailView.classList.toggle('hidden', viewName !== 'detail');
  el.infraView.classList.toggle('hidden', viewName !== 'infra');
  el.feedView.classList.toggle('hidden', viewName !== 'feed');
  el.errorsView.classList.toggle('hidden', viewName !== 'errors');
  el.backfillView.classList.toggle('hidden', viewName !== 'backfill');
  el.articlesView.classList.toggle('hidden', viewName !== 'articles');
  el.articleDetailView.classList.toggle('hidden', viewName !== 'articleDetail');

  el.navItems.forEach(item => {
    item.classList.toggle('active', item.dataset.view === viewName);
  });

  el.pageTitle.textContent = VIEW_TITLES[viewName] || viewName;

  // Stop detail polling when leaving detail view
  if (viewName !== 'detail') {
    onDetailLeave?.();
  }

  // Start/stop feed polling based on active view
  if (viewName === 'feed') {
    state.feed.newCount = 0;
    updateFeedBadge();
    onFeedStart?.();
  } else {
    onFeedStop?.();
  }
}

export function updateFeedBadge() {
  if (state.feed.newCount > 0 && state.currentView !== 'feed') {
    el.feedBadge.textContent = state.feed.newCount > 99 ? '99+' : state.feed.newCount;
    el.feedBadge.classList.remove('hidden');
  } else {
    el.feedBadge.classList.add('hidden');
  }
}
